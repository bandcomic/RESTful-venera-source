const express = require('express');
const path = require('path');
const fs = require('fs');

const VeneraRuntime = require('./venera-runtime');
const ImagePipeline = require('./venera-runtime/ImagePipeline');
const { Network, runWithRequestContext } = require('./venera-runtime/Network');

// ---------------------------------------------------------------------------
// TTL 缓存
// ---------------------------------------------------------------------------

class TTLCache {
    constructor(ttlMs, maxSize = 1000) {
        this.ttl = ttlMs;
        this.maxSize = maxSize;
        this._data = new Map();
    }

    get(key) {
        const entry = this._data.get(key);
        if (!entry) return undefined;
        if (entry.expire <= Date.now()) {
            this._data.delete(key);
            return undefined;
        }
        return entry.value;
    }

    set(key, value) {
        if (this._data.size >= this.maxSize) {
            const oldest = this._data.keys().next().value;
            this._data.delete(oldest);
        }
        this._data.set(key, { value, expire: Date.now() + this.ttl });
    }

    delete(key) {
        this._data.delete(key);
    }
}

// ---------------------------------------------------------------------------
// 请求参数解析
// ---------------------------------------------------------------------------

function clampInt(raw, fallback, minV, maxV, name) {
    if (raw === undefined || raw === null || raw === '') return fallback;
    const n = parseInt(raw, 10);
    if (isNaN(n)) {
        throw new ApiError(400, `参数 ${name} 非法`);
    }
    return Math.max(minV, Math.min(maxV, n));
}

function isTruthyArg(raw) {
    return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

function parseImageParams(req, defaultWidth) {
    const width = clampInt(req.query.width ?? req.query.w, defaultWidth, 1, 2047, 'width');
    const quality = clampInt(req.query.quality ?? req.query.q, 50, 1, 100, 'quality');
    const ifPng = isTruthyArg(req.query.ifPNG ?? req.query.ifPng);
    const ifLvgl = isTruthyArg(req.query.ifLVGL ?? req.query.ifLvgl);
    return { width, quality, ifPng, ifLvgl };
}

// ---------------------------------------------------------------------------
// 业务错误
// ---------------------------------------------------------------------------

class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

// ---------------------------------------------------------------------------
// App 工厂
// ---------------------------------------------------------------------------

function createApp(options = {}) {
    const app = express();
    app.disable('x-powered-by');

    // sources 目录解析：本地开发用 cloud-functions/sources；
    // EdgeOne 构建后 includeFiles 会被复制到函数包内 included_files/ 下
    const candidates = [
        options.sourcesDir,
        process.env.SOURCES_DIR,
        path.join(__dirname, 'sources'),
        path.join(__dirname, 'included_files', 'cloud-functions', 'sources'),
        path.join(process.cwd(), 'included_files', 'cloud-functions', 'sources'),
    ].filter(Boolean);
    const sourcesDir = candidates.find((d) => fs.existsSync(d)) || candidates[2];
    const runtime = new VeneraRuntime();

    // 缓存
    const infoCache = new TTLCache(30 * 60 * 1000);
    const chaptersCache = new TTLCache(60 * 60 * 1000);
    const epCache = new TTLCache(2 * 60 * 60 * 1000);
    const coverCache = new TTLCache(60 * 60 * 1000);

    let loadedSources = [];
    let loadingPromise = null;
    let sourcesLoaded = false;
    const sourceLastRefresh = new Map();
    const REFRESH_INTERVAL = 60 * 1000;

    // -----------------------------------------------------------------------
    // 源加载与刷新
    // -----------------------------------------------------------------------

    function setDefaultSettings(source) {
        const classDefaults = source.constructor;
        const commonDefaults = {
            base_url: classDefaults.defaultApiUrl,
            region: classDefaults.defaultCopyRegion,
            image_quality: classDefaults.defaultImageQuality,
        };
        for (const [key, value] of Object.entries(commonDefaults)) {
            if (value && !source.loadSetting(key)) {
                source.saveSetting(key, value);
            }
        }
    }

    async function loadAllSources() {
        if (!fs.existsSync(sourcesDir)) {
            try {
                fs.mkdirSync(sourcesDir, { recursive: true });
            } catch (e) {
                // 部署环境（如 EdgeOne）文件系统可能只读，目录不存在时直接返回空
                if (e.code === 'ENOENT' || e.code === 'EROFS' || e.code === 'EPERM') {
                    return [];
                }
                throw e;
            }
            return [];
        }
        const files = fs.readdirSync(sourcesDir);
        const loaded = [];
        for (const file of files) {
            if (!file.endsWith('.js')) continue;
            try {
                const sourcePath = path.join(sourcesDir, file);
                const source = runtime.loadSource(sourcePath);
                setDefaultSettings(source);
                // settings schema 的 default 必须先灌入，部分源的 init 依赖（如 jm 的 refreshDomainsOnStart）
                runtime.syncSettingsShim(source);
                if (typeof source.init === 'function') {
                    try {
                        await Promise.resolve(source.init());
                    } catch (e) {
                        console.warn(`Init error for ${source.name}:`, e.message);
                    }
                }
                runtime.syncSettingsShim(source);
                sourceLastRefresh.set(source.name, Date.now());
                loaded.push({
                    name: source.name,
                    key: source.key || source.name,
                    file,
                });
                console.log(`Loaded source: ${source.name} (${file})`);
            } catch (error) {
                console.error(`Failed to load source ${file}:`, error.message);
            }
        }
        return loaded;
    }

    function ensureSources() {
        if (sourcesLoaded) return Promise.resolve(loadedSources);
        if (!loadingPromise) {
            loadingPromise = loadAllSources()
                .then((sources) => {
                    loadedSources = sources;
                    sourcesLoaded = true;
                    loadingPromise = null;
                    return sources;
                })
                .catch((err) => {
                    loadingPromise = null;
                    throw err;
                });
        }
        return loadingPromise;
    }

    async function refreshSourceIfStale(source) {
        const last = sourceLastRefresh.get(source.name) || 0;
        if (Date.now() - last < REFRESH_INTERVAL) return;
        if (typeof source.init === 'function') {
            try {
                await Promise.resolve(source.init());
                runtime.syncSettingsShim(source);
                sourceLastRefresh.set(source.name, Date.now());
            } catch (e) {
                console.warn(`Failed to refresh source ${source.name}:`, e.message);
            }
        }
    }

    async function getSource(sourceKey) {
        await ensureSources();
        const source = runtime.getSource(sourceKey);
        if (!source) return null;
        await refreshSourceIfStale(source);
        return source;
    }

    // -----------------------------------------------------------------------
    // 域名识别（EdgeOne 会改写 Host，原始域名经 Eo-Pages-Host 透传）
    // -----------------------------------------------------------------------

    function getBaseUrl(req) {
        const publicUrl = process.env.PUBLIC_URL;
        if (publicUrl) return publicUrl.replace(/\/+$/, '');

        const eoHost = req.headers['eo-pages-host'];
        if (eoHost) return `https://${String(eoHost).trim()}`;

        // 多级代理时取第一个值
        let protocol = String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0].trim();
        let host = String(req.get('host') || '').split(',')[0].trim();
        if (host && host.includes(':')) {
            const [hostname, port] = host.split(':');
            if (port === '443') {
                protocol = 'https';
                host = hostname;
            } else if (port === '80') {
                protocol = 'http';
                host = hostname;
            }
        }
        return `${protocol}://${host}`;
    }

    // -----------------------------------------------------------------------
    // 章节结构解析（Map / Object / 嵌套）
    // -----------------------------------------------------------------------

    // 跨 vm 上下文类型判断：源在 vm 沙箱中运行，其 Map 实例的 prototype 属于
    // 沙箱 realm，宿主环境的 instanceof Map 会失败，需用 toStringTag 判断
    function isMap(value) {
        return value instanceof Map || Object.prototype.toString.call(value) === '[object Map]';
    }

    function getClientCookie(req) {
        const cookie = req.headers.cookie || req.headers.Cookie;
        return cookie ? String(cookie) : null;
    }

    function flattenChapters(chapters) {
        const result = [];
        if (!chapters) return result;
        if (isMap(chapters)) {
            for (const [key, value] of chapters) {
                if (isMap(value)) {
                    for (const [chId, chTitle] of value) {
                        result.push({ id: chId, title: chTitle });
                    }
                } else {
                    result.push({ id: key, title: value });
                }
            }
        } else if (typeof chapters === 'object') {
            for (const [key, value] of Object.entries(chapters)) {
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    for (const [chId, chTitle] of Object.entries(value)) {
                        result.push({ id: chId, title: chTitle });
                    }
                } else {
                    result.push({ id: key, title: value });
                }
            }
        }
        return result;
    }

    async function loadComicDetails(source, id, cookie) {
        if (!cookie) {
            const cached = infoCache.get(`${source.key}:${id}`);
            if (cached) return cached;
        }
        const details = await source.comic.loadInfo(id);
        if (!cookie && details) {
            infoCache.set(`${source.key}:${id}`, details);
            if (details.cover) {
                coverCache.set(`${source.key}:${id}`, details.cover);
            }
        }
        return details;
    }

    async function loadChapters(source, id, cookie) {
        if (!cookie) {
            const cached = chaptersCache.get(`${source.key}:${id}`);
            if (cached) return cached;
        }
        const details = await loadComicDetails(source, id, cookie);
        const chapters = flattenChapters(details ? details.chapters : null);
        if (!cookie) {
            chaptersCache.set(`${source.key}:${id}`, chapters);
        }
        return chapters;
    }

    async function loadEpisode(source, id, epId, cookie) {
        const cacheKey = `${source.key}:${id}:${epId}`;
        if (!cookie) {
            const cached = epCache.get(cacheKey);
            if (cached) return cached;
        }
        const epData = await source.comic.loadEp(id, epId);
        if (!cookie && epData) {
            epCache.set(cacheKey, epData);
        }
        return epData;
    }

    // -----------------------------------------------------------------------
    // 图片处理
    // -----------------------------------------------------------------------

    const MAX_OUTPUT_BYTES = 5.5 * 1024 * 1024;
    const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

    async function downloadImage(url, config, cookie) {
        const headers = {};
        if (config && config.headers) {
            Object.assign(headers, config.headers);
        }
        if (cookie && !headers.cookie && !headers.Cookie) {
            headers.Cookie = cookie;
        }
        const result = await Network.fetchBytes(config && config.method ? config.method : 'GET', url, headers);
        if (result.status !== 200) {
            throw new ApiError(502, `图片下载失败: ${result.status}`);
        }
        const body = Buffer.from(result.body);
        if (body.length > MAX_DOWNLOAD_BYTES) {
            throw new ApiError(413, '图片体积过大');
        }
        return body;
    }

    /**
     * 按源配置下载并处理图片（支持 onImageLoad / onLoadFailed / modifyImage）
     * @param {object} source
     * @param {string} imageUrl 上游图片 URL
     * @param {string} comicId
     * @param {string} epId
     * @param {{width:number, quality:number, ifPng:boolean, ifLvgl:boolean}} params
     * @param {string|null} cookie 客户端 Cookie
     * @param {boolean} isCover 是否为封面（封面忽略 modifyImage/onLoadFailed）
     */
    async function fetchAndProcessImage(source, imageUrl, comicId, epId, params, cookie, isCover) {
        let config = null;
        const hook = isCover ? source.comic && source.comic.onThumbnailLoad : source.comic && source.comic.onImageLoad;
        if (hook) {
            try {
                config = await Promise.resolve(hook(imageUrl, comicId, epId));
            } catch (e) {
                console.warn(`onImageLoad failed for ${imageUrl}:`, e.message);
            }
        }
        if (!config || typeof config !== 'object') config = {};

        let url = config.url || imageUrl;
        let body;
        try {
            body = await downloadImage(url, config, cookie);
        } catch (err) {
            // onLoadFailed 重试链（仅正文，封面不支持）
            const onLoadFailed = config.onLoadFailed;
            if (!isCover && onLoadFailed && typeof onLoadFailed === 'function') {
                try {
                    const retryConfig = await Promise.resolve(onLoadFailed());
                    if (retryConfig && typeof retryConfig === 'object') {
                        const retryUrl = retryConfig.url || imageUrl;
                        body = await downloadImage(retryUrl, retryConfig, cookie);
                        config = retryConfig;
                        url = retryUrl;
                    } else {
                        throw err;
                    }
                } catch (retryErr) {
                    if (retryErr instanceof ApiError && retryErr !== err && retryErr.status === 502) {
                        throw retryErr;
                    }
                    throw err;
                }
            } else {
                throw err;
            }
        }

        const format = ImagePipeline.detectFormat(body);
        if (format === 'gif') {
            if (params.ifPng || params.ifLvgl) {
                throw new ApiError(415, 'GIF 图片不支持 PNG/LVGL 处理');
            }
            return { data: body, contentType: 'image/gif' };
        }
        if (!format) {
            throw new ApiError(502, '图片格式不支持');
        }

        let imageData = await ImagePipeline.decodeImage(body);

        // modifyImage（仅正文支持）
        if (!isCover && config.modifyImage) {
            try {
                imageData = await ImagePipeline.runModifyImage(config.modifyImage, imageData);
            } catch (e) {
                console.warn(`modifyImage failed for ${url}:`, e.message);
            }
        }

        // 缩放
        if (params.ifLvgl) {
            let w = Math.min(params.width, imageData.width);
            let h = Math.round(imageData.height * w / imageData.width);
            if (h > ImagePipeline.LVGL_MAX_DIM) {
                h = ImagePipeline.LVGL_MAX_DIM;
                w = Math.max(1, Math.round(imageData.width * h / imageData.height));
            }
            imageData = await ImagePipeline.resizeImage({ ...imageData, width: imageData.width, height: imageData.height }, w);
            // resizeImage 只缩不放大；LVGL 需要精确尺寸，手动调整
            if (imageData.width !== w || imageData.height !== h) {
                imageData = await ImagePipeline.resizeImage(
                    { data: imageData.data, width: imageData.width, height: imageData.height },
                    w,
                );
            }
            const lvgl = ImagePipeline.encodeLvgl(imageData);
            if (lvgl.length > MAX_OUTPUT_BYTES) {
                throw new ApiError(413, '图片处理后体积过大');
            }
            return { data: lvgl, contentType: 'application/octet-stream' };
        }

        imageData = await ImagePipeline.resizeImage(imageData, params.width);

        let out, contentType;
        if (params.ifPng) {
            out = await ImagePipeline.encodePng(imageData, params.quality);
            contentType = 'image/png';
        } else {
            out = await ImagePipeline.encodeJpeg(imageData, params.quality);
            contentType = 'image/jpeg';
        }
        if (out.length > MAX_OUTPUT_BYTES) {
            throw new ApiError(413, '图片处理后体积过大');
        }
        return { data: out, contentType };
    }

    // 并发信号量（图片处理）
    const MAX_CONCURRENT = 5;
    let active = 0;
    const queue = [];

    function acquire() {
        return new Promise((resolve) => {
            if (active < MAX_CONCURRENT) {
                active++;
                resolve();
            } else {
                queue.push(resolve);
            }
        });
    }

    function release() {
        active--;
        const next = queue.shift();
        if (next) {
            active++;
            next();
        }
    }

    // -----------------------------------------------------------------------
    // 中间件
    // -----------------------------------------------------------------------

    app.use(express.json());

    app.use((req, res, next) => {
        res.setTimeout(60000, () => {
            res.status(504).json({ code: 504, message: '请求超时' });
        });
        next();
    });

    app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cookie');
        if (req.method === 'OPTIONS') return res.sendStatus(200);
        next();
    });

    app.use((req, res, next) => {
        const cookie = getClientCookie(req);
        const pairs = [];
        for (const part of String(cookie || '').split(';')) {
            const idx = part.indexOf('=');
            if (idx <= 0) continue;
            const name = part.slice(0, idx).trim();
            const value = part.slice(idx + 1).trim();
            if (name) pairs.push({ name, value });
        }
        runWithRequestContext({ cookie: cookie || null, cookiePairs: pairs }, () => next());
    });

    app.use((err, req, res, next) => {
        if (err instanceof ApiError) {
            return res.status(err.status).json({ code: err.status, message: err.message });
        }
        console.error('Unhandled error:', err);
        res.status(500).json({ code: 500, message: '服务器内部错误' });
    });

    // -----------------------------------------------------------------------
    // 路由
    // -----------------------------------------------------------------------

    app.get('/', async (req, res) => {
        await ensureSources();
        res.json({
            status: 'ok',
            sources: loadedSources.map((s) => s.key),
            message: 'Venera Source Converter is running',
        });
    });

    app.post('/reload', async (req, res) => {
        sourcesLoaded = false;
        loadingPromise = loadAllSources().then((s) => {
            loadedSources = s;
            sourcesLoaded = true;
            loadingPromise = null;
            return s;
        });
        const sources = await loadingPromise;
        res.json({ status: 'ok', sources: sources.map((s) => s.key) });
    });

    app.get('/config', async (req, res) => {
        await ensureSources();
        const apiUrl = getBaseUrl(req);
        const config = {};
        for (const info of loadedSources) {
            const key = info.key || info.name;
            config[key] = {
                name: info.name,
                apiUrl,
                detailPath: `/comic/<id>?source=${encodeURIComponent(key)}`,
                photoPath: `/photo/<id>/chapter/<chapter>?source=${encodeURIComponent(key)}`,
                searchPath: `/search/<text>/<page>?source=${encodeURIComponent(key)}`,
                type: key,
            };
        }
        res.json(config);
    });

    // 漫画详情
    app.get('/comic/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const source = await getSource(req.query.source);
            if (!source) throw new ApiError(404, `Source not found: ${req.query.source}`);
            if (!source.comic || !source.comic.loadInfo) {
                throw new ApiError(501, 'Source does not support comic details');
            }
            const cookie = getClientCookie(req);
            const details = await loadComicDetails(source, id, cookie);
            if (!details || !details.title) {
                throw new ApiError(404, 'Comic not found');
            }

            const chapters = await loadChapters(source, id, cookie);
            const totalChapters = chapters.length;
            const isOneshot = totalChapters <= 1;

            let pageCount = 0;
            if (isOneshot) {
                if (details.thumbnails && details.thumbnails.length > 0) {
                    pageCount = details.thumbnails.length;
                } else if (details.maxPage !== null && details.maxPage !== undefined) {
                    pageCount = details.maxPage;
                }
            }

            const tags = [];
            if (details.tags) {
                if (isMap(details.tags)) {
                    for (const values of details.tags.values()) {
                        if (Array.isArray(values)) tags.push(...values);
                        else if (typeof values === 'string') tags.push(values);
                    }
                } else if (Array.isArray(details.tags)) {
                    tags.push(...details.tags);
                } else if (typeof details.tags === 'object') {
                    for (const values of Object.values(details.tags)) {
                        if (Array.isArray(values)) tags.push(...values);
                        else if (typeof values === 'string') tags.push(values);
                    }
                }
            }

            const baseUrl = getBaseUrl(req);
            const sourceKey = source.key || source.name;
            const cover = details.cover
                ? `${baseUrl}/comic/${encodeURIComponent(id)}/cover?source=${encodeURIComponent(sourceKey)}`
                : '';

            res.json({
                item_id: details.id || id,
                name: details.title,
                page_count: pageCount,
                views: details.views || 0,
                rate: details.stars || 0,
                cover,
                tags,
                total_chapters: isOneshot ? 1 : totalChapters,
            });
        } catch (e) {
            handleError(e, res);
        }
    });

    // 漫画封面
    app.get('/comic/:id/cover', async (req, res) => {
        await acquire();
        try {
            const { id } = req.params;
            const source = await getSource(req.query.source);
            if (!source) throw new ApiError(404, `Source not found: ${req.query.source}`);
            const cookie = getClientCookie(req);

            let coverUrl = null;
            if (!cookie) coverUrl = coverCache.get(`${source.key}:${id}`);
            if (!coverUrl) {
                const details = await loadComicDetails(source, id, cookie);
                coverUrl = details ? details.cover : null;
                if (!coverUrl && !cookie) coverCache.delete(`${source.key}:${id}`);
            }
            if (!coverUrl) throw new ApiError(404, 'No cover found');

            const params = parseImageParams(req, 200);
            const result = await fetchAndProcessImage(source, coverUrl, id, null, params, cookie, true);
            res.set({
                'Content-Type': result.contentType,
                'Cache-Control': 'public, max-age=86400',
            });
            res.send(result.data);
        } catch (e) {
            handleError(e, res);
        } finally {
            release();
        }
    });

    // 章节图片列表
    app.get('/photo/:id/chapter/:chapter', async (req, res) => {
        try {
            const { id, chapter } = req.params;
            const source = await getSource(req.query.source);
            if (!source) throw new ApiError(404, `Source not found: ${req.query.source}`);
            if (!source.comic || !source.comic.loadEp) {
                throw new ApiError(501, 'Source does not support loading episodes');
            }
            const cookie = getClientCookie(req);
            const chapters = await loadChapters(source, id, cookie);

            const chapterNumber = parseInt(chapter, 10);
            if (isNaN(chapterNumber) || chapterNumber < 1) {
                throw new ApiError(400, '章节号必须从 1 开始');
            }

            let epId = null;
            let chapterTitle = null;
            if (chapters.length > 0) {
                if (chapterNumber > chapters.length) {
                    throw new ApiError(404, `未找到第 ${chapterNumber} 章`);
                }
                const target = chapters[chapterNumber - 1];
                epId = target.id;
                chapterTitle = target.title;
            } else {
                // 单章/无章节源：直接使用章节号作为 epId
                epId = chapter;
            }

            const epData = await loadEpisode(source, id, epId, cookie);
            if (!epData || !epData.images || epData.images.length === 0) {
                throw new ApiError(502, '未获取到章节图片');
            }

            if (!chapterTitle) {
                if (chapters.length <= 1) {
                    try {
                        const details = await loadComicDetails(source, id, cookie);
                        if (details && details.title) chapterTitle = details.title;
                    } catch (e) { /* 忽略 */ }
                }
                if (!chapterTitle) chapterTitle = `第 ${chapterNumber} 章`;
            }

            const baseUrl = getBaseUrl(req);
            const sourceKey = source.key || source.name;
            const encodedId = encodeURIComponent(id);
            const images = epData.images.map((_, index) => ({
                url: `${baseUrl}/photo/${encodedId}/chapter/${chapterNumber}/${index + 1}.jpg?source=${encodeURIComponent(sourceKey)}`,
            }));

            res.json({ title: chapterTitle, images });
        } catch (e) {
            handleError(e, res);
        }
    });

    // 章节单页图片
    app.get('/photo/:id/chapter/:chapter/:page', async (req, res) => {
        await acquire();
        try {
            const { id, chapter, page } = req.params;
            const source = await getSource(req.query.source);
            if (!source) throw new ApiError(404, `Source not found: ${req.query.source}`);

            const chapterNumber = parseInt(chapter, 10);
            const pageMatch = String(page).match(/^(\d+)/);
            if (isNaN(chapterNumber) || chapterNumber < 1 || !pageMatch) {
                throw new ApiError(400, '无效的章节或页码');
            }
            const pageNum = parseInt(pageMatch[1], 10);

            const cookie = getClientCookie(req);
            const chapters = await loadChapters(source, id, cookie);

            let epId = chapter;
            if (chapters.length > 0) {
                if (chapterNumber > chapters.length) {
                    throw new ApiError(404, `未找到第 ${chapterNumber} 章`);
                }
                epId = chapters[chapterNumber - 1].id;
            }

            const epData = await loadEpisode(source, id, epId, cookie);
            if (!epData || !epData.images || epData.images.length === 0) {
                throw new ApiError(502, '未获取到章节图片');
            }
            if (pageNum < 1 || pageNum > epData.images.length) {
                throw new ApiError(404, 'Page not found');
            }

            const params = parseImageParams(req, 600);
            const imageUrl = epData.images[pageNum - 1];

            try {
                const result = await fetchAndProcessImage(source, imageUrl, id, epId, params, cookie, false);
                res.set({
                    'Content-Type': result.contentType,
                    'Cache-Control': 'public, max-age=86400',
                });
                res.send(result.data);
            } catch (err) {
                // 图床地址失效时刷新章节数据重试一次
                if (err instanceof ApiError && err.status === 502 && !cookie) {
                    epCache.delete(`${source.key}:${id}:${epId}`);
                    const fresh = await loadEpisode(source, id, epId, cookie);
                    if (fresh && fresh.images && fresh.images.length >= pageNum) {
                        const result = await fetchAndProcessImage(source, fresh.images[pageNum - 1], id, epId, params, cookie, false);
                        res.set({
                            'Content-Type': result.contentType,
                            'Cache-Control': 'public, max-age=86400',
                        });
                        return res.send(result.data);
                    }
                }
                throw err;
            }
        } catch (e) {
            handleError(e, res);
        } finally {
            release();
        }
    });

    // 搜索
    app.get('/search/:text/:page', async (req, res) => {
        try {
            const { text, page } = req.params;
            const source = await getSource(req.query.source);
            if (!source) throw new ApiError(404, `Source not found: ${req.query.source}`);
            if (!source.search || !source.search.load) {
                throw new ApiError(501, 'Source does not support search');
            }

            const pageNum = parseInt(page, 10);
            if (isNaN(pageNum) || pageNum < 1) {
                throw new ApiError(400, '页码必须大于0');
            }

            // 提取默认选项
            const options = [];
            if (source.search.optionList) {
                for (const opt of source.search.optionList) {
                    if (opt.default !== undefined && opt.default !== null) {
                        options.push(opt.default);
                    } else if (opt.options && opt.options.length > 0) {
                        const first = opt.options[0];
                        if (typeof first === 'string' && first.includes('-')) {
                            options.push(first.split('-')[0]);
                        } else {
                            options.push(first);
                        }
                    } else {
                        options.push(null);
                    }
                }
            }

            const searchResult = await source.search.load(text, options, pageNum);
            if (!searchResult || !searchResult.comics) {
                throw new ApiError(502, '搜索失败');
            }

            const baseUrl = getBaseUrl(req);
            const sourceKey = source.key || source.name;
            const results = searchResult.comics
                .filter((c) => c && c.id)
                .map((comic) => ({
                    comic_id: comic.id,
                    title: comic.title || String(comic.id),
                    cover_url: comic.cover
                        ? `${baseUrl}/comic/${encodeURIComponent(comic.id)}/cover?source=${encodeURIComponent(sourceKey)}`
                        : '',
                    pages: comic.maxPage || 0,
                }));

            res.json({
                page: pageNum,
                has_more: searchResult.maxPage ? pageNum < searchResult.maxPage : false,
                results,
            });
        } catch (e) {
            handleError(e, res);
        }
    });

    // 兼容旧版：直接代理上游图片
    app.get('/proxy', async (req, res) => {
        await acquire();
        try {
            const imageUrl = req.query.url;
            if (!imageUrl) throw new ApiError(400, '缺少 url 参数');
            const source = req.query.source ? await getSource(req.query.source) : null;
            const params = parseImageParams(req, 600);
            const cookie = getClientCookie(req);
            const result = await fetchAndProcessImage(source || {}, imageUrl, req.query.comicId, req.query.epId, params, cookie, false);
            res.set({
                'Content-Type': result.contentType,
                'Cache-Control': 'public, max-age=86400',
            });
            res.send(result.data);
        } catch (e) {
            handleError(e, res);
        } finally {
            release();
        }
    });

    function handleError(err, res) {
        if (err instanceof ApiError) {
            return res.status(err.status).json({ code: err.status, message: err.message });
        }
        console.error('Error:', err);
        res.status(500).json({ code: 500, message: err.message || '服务器内部错误' });
    }

    return app;
}

module.exports = { createApp, ApiError };
