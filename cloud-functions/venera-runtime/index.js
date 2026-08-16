const { Convert } = require('./Convert');
const { Network, Cookie, fetch, registerClientCookieDomain } = require('./Network');
const { HtmlDocument, HtmlElement, HtmlNode } = require('./HtmlDocument');
const { UI } = require('./UI');
const { createUuid, randomInt, randomDouble, DataStorage } = require('./Utils');
const { Comic, ComicDetails, Comment } = require('./ComicTypes');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 引擎全局版本（对齐真实引擎的 appVersion 全局变量）
const ENGINE_VERSION = '2.1.0';
const ENGINE_LOCALE = 'zh_CN';

// 预加载所有运行时模块：esbuild 打包时这些静态 require 会被 bundle 进产物，
// vm 沙箱的 require 从预加载 Map 查表返回，避免打包后动态 require 文件系统路径失效
const RUNTIME_MODULES = new Map([
    ['Convert', require('./Convert')],
    ['Network', require('./Network')],
    ['HtmlDocument', require('./HtmlDocument')],
    ['UI', require('./UI')],
    ['Utils', require('./Utils')],
    ['ComicTypes', require('./ComicTypes')],
]);

function runtimeRequire(id) {
    const base = path.basename(id);
    if (RUNTIME_MODULES.has(base)) {
        return RUNTIME_MODULES.get(base);
    }
    throw new Error(`Runtime module not found: ${id}`);
}

class VeneraRuntime {
    constructor() {
        this.sources = new Map();
    }

    // 从源代码中提取简单字段（字符串、数字、布尔值）
    extractSimpleFields(code) {
        const fields = {};
        const lines = code.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            const match = trimmed.match(/^(\w+)\s*=\s*(.+?);?$/);
            if (match) {
                const fieldName = match[1];
                let fieldValue = match[2].trim();

                if (fieldValue.includes('=>') || fieldValue.includes('function')) {
                    continue;
                }
                if (fieldValue === '{' || fieldValue === '[' ||
                    fieldValue.endsWith('{') || fieldValue.endsWith('[')) {
                    continue;
                }

                try {
                    if ((fieldValue.startsWith('"') && fieldValue.endsWith('"')) ||
                        (fieldValue.startsWith("'") && fieldValue.endsWith("'"))) {
                        fields[fieldName] = fieldValue.slice(1, -1);
                    }
                    else if (fieldValue === 'true') {
                        fields[fieldName] = true;
                    }
                    else if (fieldValue === 'false') {
                        fields[fieldName] = false;
                    }
                    else if (!isNaN(fieldValue) && fieldValue !== '' && !fieldValue.includes(' ')) {
                        fields[fieldName] = Number(fieldValue);
                    }
                } catch (e) {
                    // 忽略解析错误
                }
            }
        }

        return fields;
    }

    // 加载漫画源（vm 内存编译，无临时文件）
    loadSource(filePath) {
        const fullPath = path.resolve(filePath);
        if (!fs.existsSync(fullPath)) {
            throw new Error(`Source file not found: ${fullPath}`);
        }

        const code = fs.readFileSync(fullPath, 'utf-8');
        return this.loadSourceFromCode(code, path.basename(filePath));
    }

    // 从源码字符串加载漫画源
    loadSourceFromCode(code, filename = 'source.js') {
        const simpleFields = this.extractSimpleFields(code);

        const classNameMatch = code.match(/class\s+(\w+)\s+extends/);
        if (!classNameMatch) {
            throw new Error('Could not find class definition in source file');
        }
        const sourceClassName = classNameMatch[1];

        const runtimeDir = __dirname;
        const header = `
const { Convert } = require(${JSON.stringify(path.join(runtimeDir, 'Convert'))});
const { Network, Cookie, fetch } = require(${JSON.stringify(path.join(runtimeDir, 'Network'))});
const { HtmlDocument, HtmlElement, HtmlNode } = require(${JSON.stringify(path.join(runtimeDir, 'HtmlDocument'))});
const { UI } = require(${JSON.stringify(path.join(runtimeDir, 'UI'))});
const { createUuid, randomInt, randomDouble } = require(${JSON.stringify(path.join(runtimeDir, 'Utils'))});
const { Comic, ComicDetails, Comment } = require(${JSON.stringify(path.join(runtimeDir, 'ComicTypes'))});

// APP 全局对象模拟
const APP = {
    get version() { return appVersion },
    get locale() { return appLocale },
    get platform() { return 'server' }
};

// 模拟 sendMessage 全局函数
globalThis.sendMessage = (msg) => {
    return null;
};

// 引擎 log 全局函数（映射到 console）
globalThis.log = (level, title, content) => {
    const text = title ? ('[' + title + '] ' + (content ?? '')) : String(content ?? '');
    if (level === 'warning') console.warn(text);
    else if (level === 'error') console.error(text);
    else console.log(text);
};

class ComicSource {
    constructor() {
        // 不预置属性值：子类可能定义同名只读 getter（如 baseUrl），
        // 父类赋值会抛 "Cannot set property which has only a getter"
    }

    // 数据持久化方法
    loadData(key) {
        if (!this._dataStorage) {
            const { DataStorage } = require(${JSON.stringify(path.join(runtimeDir, 'Utils'))});
            this._dataStorage = new DataStorage(this.key || this.name);
        }
        return this._dataStorage.loadData(key);
    }

    saveData(key, value) {
        if (!this._dataStorage) {
            const { DataStorage } = require(${JSON.stringify(path.join(runtimeDir, 'Utils'))});
            this._dataStorage = new DataStorage(this.key || this.name);
        }
        return this._dataStorage.saveData(key, value);
    }

    loadSetting(key) {
        if (!this._dataStorage) {
            const { DataStorage } = require(${JSON.stringify(path.join(runtimeDir, 'Utils'))});
            this._dataStorage = new DataStorage(this.key || this.name);
        }
        return this._dataStorage.loadSetting(key);
    }

    saveSetting(key, value) {
        if (!this._dataStorage) {
            const { DataStorage } = require(${JSON.stringify(path.join(runtimeDir, 'Utils'))});
            this._dataStorage = new DataStorage(this.key || this.name);
        }
        return this._dataStorage.saveSetting(key, value);
    }

    deleteData(key) {
        if (!this._dataStorage) {
            const { DataStorage } = require(${JSON.stringify(path.join(runtimeDir, 'Utils'))});
            this._dataStorage = new DataStorage(this.key || this.name);
        }
        return this._dataStorage.deleteData(key);
    }

    get isLogged() {
        return false;
    }

    translate(key) {
        const t = this.translation || {};
        const localized = t[appLocale];
        if (localized && localized[key] !== undefined) return localized[key];
        const en = t['en'];
        if (en && en[key] !== undefined) return en[key];
        return key;
    }
}

`;

        const footer = `

module.exports = ${sourceClassName};
`;

        const moduleCode = header + code + footer;

        // 创建 vm 沙箱（require 指向预加载模块查表，打包后无需文件系统）
        const sandbox = {
            require: runtimeRequire,
            module: { exports: {} },
            exports: {},
            console,
            setTimeout,
            clearTimeout,
            setInterval,
            clearInterval,
            URL,
            URLSearchParams,
            TextEncoder,
            TextDecoder,
            Buffer,
            atob,
            btoa,
            globalThis: null, // 下面修正
            appVersion: ENGINE_VERSION,
            appLocale: ENGINE_LOCALE,
            // venera 引擎全局桩
            setClipboard: async () => {},
            getClipboard: async () => '',
            compute: async (func, ...args) => {
                try {
                    // 简单的同线程执行（真实引擎在引擎池执行）
                    const fn = vm.runInNewContext(`(${func})`, sandbox, { timeout: 10000 });
                    return await fn(args);
                } catch (e) {
                    console.warn('[compute] failed:', e.message);
                    return null;
                }
            },
        };
        sandbox.globalThis = sandbox;

        const context = vm.createContext(sandbox);
        vm.runInContext(moduleCode, context, {
            filename,
            timeout: 30000,
        });

        const SourceClass = sandbox.module.exports;
        if (!SourceClass) {
            throw new Error('Could not find comic source class in file');
        }

        const source = new SourceClass();

        // 合并简单字段（如果实例中没有的话）
        for (const [key, value] of Object.entries(simpleFields)) {
            if (!source[key] || source[key] === '' || source[key] === null) {
                source[key] = value;
            }
        }

        // 存储漫画源（同时支持 name 与 key 查找）
        const sourceKey = source.name || source.key || sourceClassName;
        this.sources.set(sourceKey, source);
        if (source.key && source.key !== sourceKey) {
            this.sources.set(source.key, source);
        }

        // 注册客户端 Cookie 可附加的目标域名
        this.registerSourceDomains(source);

        return source;
    }

    // 注册源的已知域名（客户端上传的 Cookie 只附加到这些域）
    registerSourceDomains(source) {
        const raws = [];
        for (const key of ['url', 'baseUrl']) {
            try {
                const v = source[key];
                if (typeof v === 'string' && v) raws.push(v);
            } catch (e) {
                // 部分源的 baseUrl 是 getter，可能在 init 前抛错，忽略
            }
        }
        for (const raw of raws) {
            try {
                const hostname = new URL(raw).hostname;
                if (hostname) registerClientCookieDomain(hostname);
            } catch (e) {
                // 忽略非法 URL
            }
        }
    }

    // 同步部分源的 settings 属性包怪癖（如 copy_manga 把发现的域名写入 this.settings.base_url，
    // 而读取走 loadSetting('base_url')，两个存储互不相通）
    syncSettingsShim(source) {
        const settings = source.settings;
        if (!settings || typeof settings !== 'object') return;
        for (const [key, value] of Object.entries(settings)) {
            if (value && typeof value === 'object' && 'default' in value) {
                // settings 是 schema 声明：default 灌入 DataStorage 作为默认值
                if (!source.loadSetting(key)) {
                    source.saveSetting(key, value.default);
                }
            } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                // settings 被源当属性包直接写入
                if (value !== '' && !source.loadSetting(key)) {
                    source.saveSetting(key, value);
                }
            }
        }
    }

    // 获取已加载的漫画源
    getSource(name) {
        return this.sources.get(name);
    }

    // 获取所有已加载的漫画源
    getAllSources() {
        return Array.from(this.sources.values());
    }
}

module.exports = VeneraRuntime;
