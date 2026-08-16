const vm = require('vm');
const fs = require('fs');

const iq = require('image-q');
const { PointContainer } = iq.utils;

const LVGL_MAX_DIM = 2047; // LVGL 头部宽高各占 11 bit

// ---------------------------------------------------------------------------
// WASM codec 初始化
// jsquash 的 emscripten glue 在 Node 下默认用 fetch(file://) 加载 wasm（不支持），
// 需要显式注入 WebAssembly.Module
// ---------------------------------------------------------------------------

let codecsInitPromise = null;

async function loadWasmModule(wasmPath) {
    return new WebAssembly.Module(fs.readFileSync(require.resolve(wasmPath)));
}

async function initCodecs() {
    if (codecsInitPromise) return codecsInitPromise;
    codecsInitPromise = (async () => {
        const webpDec = await import('@jsquash/webp/decode.js');
        const jpegDec = await import('@jsquash/jpeg/decode.js');
        const jpegEnc = await import('@jsquash/jpeg/encode.js');
        const pngDec = await import('@jsquash/png/decode.js');
        const pngEnc = await import('@jsquash/png/encode.js');
        const avifDec = await import('@jsquash/avif/decode.js');
        const resizeMod = await import('@jsquash/resize/index.js');

        await webpDec.init(await loadWasmModule('@jsquash/webp/codec/dec/webp_dec.wasm'));
        await jpegDec.init(await loadWasmModule('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'));
        await jpegEnc.init(await loadWasmModule('@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm'));
        await pngDec.init(await loadWasmModule('@jsquash/png/codec/pkg/squoosh_png_bg.wasm'));
        await pngEnc.init(await loadWasmModule('@jsquash/png/codec/pkg/squoosh_png_bg.wasm'));
        await avifDec.init(await loadWasmModule('@jsquash/avif/codec/dec/avif_dec.wasm'));
        await resizeMod.initResize(await loadWasmModule('@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm'));
    })().catch((err) => {
        codecsInitPromise = null;
        throw err;
    });
    return codecsInitPromise;
}

// ---------------------------------------------------------------------------
// 解码
// ---------------------------------------------------------------------------

function detectFormat(buffer) {
    if (!buffer || buffer.length < 12) return null;
    // webp: RIFF....WEBP
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
        return 'webp';
    }
    // png
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
        return 'png';
    }
    // jpeg
    if (buffer[0] === 0xff && buffer[1] === 0xd8) {
        return 'jpeg';
    }
    // avif: ISO BMFF (ftyp box)
    if (buffer.length > 12 && buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70 &&
        buffer[8] === 0x61 && buffer[9] === 0x76 && buffer[10] === 0x69 && buffer[11] === 0x66) {
        return 'avif';
    }
    // gif
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
        return 'gif';
    }
    return null;
}

/**
 * 解码图片为 RGBA ImageData
 * @param {Buffer} buffer
 * @returns {Promise<{width: number, height: number, data: Uint8ClampedArray}>}
 */
async function decodeImage(buffer) {
    await initCodecs();
    const format = detectFormat(buffer);
    if (!format) {
        throw new Error(`Unsupported image format`);
    }
    if (format === 'gif') {
        throw new Error('GIF decoding is not supported');
    }
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    if (format === 'webp') {
        const webp = await import('@jsquash/webp/decode.js');
        return await webp.default(arrayBuffer);
    }
    if (format === 'png') {
        const png = await import('@jsquash/png/decode.js');
        return await png.default(arrayBuffer);
    }
    if (format === 'avif') {
        const avif = await import('@jsquash/avif/decode.js');
        return await avif.default(arrayBuffer);
    }
    const jpeg = await import('@jsquash/jpeg/decode.js');
    return await jpeg.default(arrayBuffer);
}

// ---------------------------------------------------------------------------
// 缩放（仅缩小，保持纵横比）
// ---------------------------------------------------------------------------

/**
 * @param {{width: number, height: number, data: Uint8ClampedArray}} imageData
 * @param {number} targetWidth 目标宽度，0 表示不缩放
 */
async function resizeImage(imageData, targetWidth) {
    await initCodecs();
    if (!targetWidth || targetWidth <= 0 || imageData.width <= targetWidth) {
        return imageData;
    }
    const height = Math.max(1, Math.round(imageData.height * targetWidth / imageData.width));
    const resizeMod = await import('@jsquash/resize/index.js');
    const resizeFn = resizeMod.default;
    const out = await resizeFn(
        { data: imageData.data, width: imageData.width, height: imageData.height },
        { width: targetWidth, height, fitMethod: 'stretch' },
    );
    return { data: out.data, width: out.width, height: out.height };
}

// ---------------------------------------------------------------------------
// 编码
// ---------------------------------------------------------------------------

/**
 * 编码为 JPEG
 * @param {{width: number, height: number, data: Uint8ClampedArray}} imageData
 * @param {number} quality 1-100
 */
async function encodeJpeg(imageData, quality) {
    await initCodecs();
    const jpeg = await import('@jsquash/jpeg/encode.js');
    const buf = await jpeg.default(
        { data: imageData.data, width: imageData.width, height: imageData.height },
        { quality: Math.max(1, Math.min(100, quality)) },
    );
    return Buffer.from(buf);
}

/**
 * 编码为 PNG（去透明通道铺白底，quality 复用做颜色量化以减小体积）
 */
async function encodePng(imageData, quality = 50) {
    await initCodecs();
    let data = flattenAlpha(imageData);
    let { width, height } = imageData;
    if (quality > 0) {
        const colors = Math.max(16, Math.min(256, Math.round(16 + quality * 2.4)));
        const quantized = quantizePixels(data, width, height, colors);
        if (quantized) {
            data = quantized.data;
            width = quantized.width;
            height = quantized.height;
        }
    }
    const png = await import('@jsquash/png/encode.js');
    const buf = await png.default(
        { data, width, height },
        {},
    );
    return Buffer.from(buf);
}

/**
 * 颜色量化（image-q 中位切分），返回量化后的 RGBA 数据
 */
function quantizePixels(rgba, width, height, colors) {
    if (width * height <= 0) return null;
    try {
        const pc = PointContainer.fromUint8Array(rgba, width, height);
        const palette = iq.buildPaletteSync([pc], {
            paletteQuantization: 'wuquant',
            colors,
        });
        const out = iq.applyPaletteSync(pc, palette, { imageQuantization: 'nearest' });
        return {
            width,
            height,
            data: new Uint8ClampedArray(out.toUint8Array()),
        };
    } catch (e) {
        return null;
    }
}

function flattenAlpha(imageData) {
    const { width, height, data } = imageData;
    if (width * height * 4 !== data.length) {
        return data;
    }
    const out = new Uint8ClampedArray(data.length);
    for (let i = 0; i < width * height; i++) {
        const r = data[i * 4];
        const g = data[i * 4 + 1];
        const b = data[i * 4 + 2];
        const a = data[i * 4 + 3];
        const bg = 255;
        const alpha = a / 255;
        out[i * 4] = Math.round(r * alpha + bg * (1 - alpha));
        out[i * 4 + 1] = Math.round(g * alpha + bg * (1 - alpha));
        out[i * 4 + 2] = Math.round(b * alpha + bg * (1 - alpha));
        out[i * 4 + 3] = 255;
    }
    return out;
}

// ---------------------------------------------------------------------------
// LVGL 预解码二进制（indexed-8）
// 格式：4 字节头 + 256 项 BGRA 调色板 + 每像素 1 字节索引
// ---------------------------------------------------------------------------

/**
 * @param {{width: number, height: number, data: Uint8ClampedArray}} imageData
 * @returns {Buffer}
 */
function encodeLvgl(imageData) {
    const { width, height } = imageData;
    if (width > LVGL_MAX_DIM || height > LVGL_MAX_DIM) {
        throw new Error(`Image size exceeds LVGL limit: ${width}x${height}`);
    }

    const rgb = flattenAlpha(imageData);
    const pc = PointContainer.fromUint8Array(rgb, width, height);
    const palette = iq.buildPaletteSync([pc], {
        paletteQuantization: 'wuquant',
        colors: 256,
    });
    const out = iq.applyPaletteSync(pc, palette, { imageQuantization: 'nearest' });

    const palPts = palette.getPointContainer().getPointArray();
    const indexMap = new Map();
    for (let i = 0; i < palPts.length; i++) {
        indexMap.set(palPts[i].uint32 >>> 0, i);
    }

    const outPts = out.getPointArray();
    const indices = Buffer.alloc(width * height);
    for (let i = 0; i < outPts.length; i++) {
        const idx = indexMap.get(outPts[i].uint32 >>> 0);
        indices[i] = idx === undefined ? 0 : idx;
    }

    const header = Buffer.alloc(4);
    header.writeUInt32LE(10 | (width << 10) | (height << 21), 0);

    const paletteBytes = Buffer.alloc(256 * 4);
    for (let i = 0; i < palPts.length; i++) {
        const p = palPts[i];
        paletteBytes[i * 4] = p.b;
        paletteBytes[i * 4 + 1] = p.g;
        paletteBytes[i * 4 + 2] = p.r;
        paletteBytes[i * 4 + 3] = 0xff;
    }

    return Buffer.concat([header, paletteBytes, indices]);
}

// ---------------------------------------------------------------------------
// modifyImage 沙箱执行
// 在隔离 vm 中运行源的 modifyImage 脚本（定义 modifyImage 函数并调用），
// 传入/返回基于 RGBA 缓冲的 Image 对象
// ---------------------------------------------------------------------------

/**
 * 执行 modifyImage 脚本
 * @param {string} script - JS 脚本字符串，需定义 modifyImage(image) 函数
 * @param {{width: number, height: number, data: Uint8ClampedArray}} imageData
 * @returns {Promise<{width: number, height: number, data: Uint8ClampedArray}>}
 */
async function runModifyImage(script, imageData) {
    if (!script || typeof script !== 'string') {
        return imageData;
    }

    const pool = new Map();
    let nextKey = 1;

    const alloc = (width, height, fill = 0) => {
        const key = nextKey++;
        const data = new Uint8ClampedArray(width * height * 4).fill(fill);
        pool.set(key, { width, height, data });
        return key;
    };

    const sandbox = {
        console,
        inputImage: null, // 下面赋值
        Image: {
            empty: (width, height) => {
                return new SandboxImage(alloc(width, height));
            },
        },
    };

    // 沙箱内的 Image 类
    function SandboxImage(key) {
        this.key = key;
    }
    SandboxImage.prototype = {
        get width() {
            const img = pool.get(this.key);
            return img ? img.width : 0;
        },
        get height() {
            const img = pool.get(this.key);
            return img ? img.height : 0;
        },
        copyRange(x, y, width, height) {
            const src = pool.get(this.key);
            if (!src) return null;
            const dst = pool.get(alloc(width, height));
            const srcW = src.width;
            for (let py = 0; py < height; py++) {
                for (let px = 0; px < width; px++) {
                    const sx = x + px;
                    const sy = y + py;
                    if (sx < 0 || sy < 0 || sx >= srcW || sy >= src.height) continue;
                    const si = (sy * srcW + sx) * 4;
                    const di = (py * width + px) * 4;
                    dst.data.set(src.data.subarray(si, si + 4), di);
                }
            }
            return new SandboxImage(dst.key);
        },
        copyAndRotate90() {
            const src = pool.get(this.key);
            if (!src) return null;
            const dst = pool.get(alloc(src.height, src.width));
            const sw = src.width, sh = src.height;
            for (let py = 0; py < sh; py++) {
                for (let px = 0; px < sw; px++) {
                    const si = (py * sw + px) * 4;
                    const di = (px * sh + (sh - 1 - py)) * 4;
                    dst.data.set(src.data.subarray(si, si + 4), di);
                }
            }
            return new SandboxImage(dst.key);
        },
        fillImageAt(x, y, image) {
            this.fillImageRangeAt(x, y, image, 0, 0, image.width, image.height);
        },
        fillImageRangeAt(x, y, image, srcX, srcY, width, height) {
            const dst = pool.get(this.key);
            const src = pool.get(image.key);
            if (!dst || !src) return;
            const dstW = dst.width;
            const srcW = src.width;
            for (let py = 0; py < height; py++) {
                for (let px = 0; px < width; px++) {
                    const sx = srcX + px;
                    const sy = srcY + py;
                    const dx = x + px;
                    const dy = y + py;
                    if (sx < 0 || sy < 0 || sx >= srcW || sy >= src.height) continue;
                    if (dx < 0 || dy < 0 || dx >= dstW || dy >= dst.height) continue;
                    const si = (sy * srcW + sx) * 4;
                    const di = (dy * dstW + dx) * 4;
                    dst.data.set(src.data.subarray(si, si + 4), di);
                }
            }
        },
    };
    sandbox.ImageClass = SandboxImage;

    const context = vm.createContext(sandbox, { name: 'modifyImage' });

    // 初始 image 对象
    const inputKey = alloc(imageData.width, imageData.height);
    pool.get(inputKey).data.set(imageData.data);
    const inputImage = new SandboxImage(inputKey);
    sandbox.inputImage = inputImage;

    try {
        const result = vm.runInContext(
            `${script}\nmodifyImage(inputImage)`,
            context,
            { timeout: 10000, filename: 'modifyImage.js' },
        );
        if (!result || !result.key) {
            throw new Error('modifyImage did not return an Image');
        }
        const out = pool.get(result.key);
        if (!out) {
            throw new Error('modifyImage returned an invalid Image');
        }
        return { width: out.width, height: out.height, data: out.data };
    } finally {
        pool.clear();
    }
}

module.exports = {
    detectFormat,
    decodeImage,
    resizeImage,
    encodeJpeg,
    encodePng,
    encodeLvgl,
    runModifyImage,
    LVGL_MAX_DIM,
};
