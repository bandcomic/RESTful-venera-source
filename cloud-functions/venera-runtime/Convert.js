const crypto = require('crypto');

/**
 * Convert API - 数据转换工具类
 * 实现 Venera 的所有 Convert 功能
 */
class Convert {
    /**
     * 将字符串转换为 Uint8Array (UTF-8 编码)
     * @param {string} str
     * @returns {Uint8Array}
     */
    static encodeUtf8(str) {
        return new TextEncoder().encode(str);
    }

    /**
     * 将 Uint8Array 转换为字符串 (UTF-8 解码)
     * @param {Uint8Array} value
     * @returns {string}
     */
    static decodeUtf8(value) {
        return new TextDecoder().decode(value);
    }

    /**
     * 将 Uint8Array 转换为 Base64 字符串
     * @param {Uint8Array} value
     * @returns {string}
     */
    static encodeBase64(value) {
        return Buffer.from(value).toString('base64');
    }

    /**
     * 将 Base64 字符串转换为 Uint8Array
     * @param {string} value
     * @returns {Uint8Array}
     */
    static decodeBase64(value) {
        return new Uint8Array(Buffer.from(value, 'base64'));
    }

    /**
     * 计算 MD5 哈希
     * @param {Uint8Array} value
     * @returns {Uint8Array}
     */
    static md5(value) {
        const hash = crypto.createHash('md5');
        hash.update(Buffer.from(value));
        return new Uint8Array(hash.digest());
    }

    /**
     * 计算 SHA1 哈希
     * @param {Uint8Array} value
     * @returns {Uint8Array}
     */
    static sha1(value) {
        const hash = crypto.createHash('sha1');
        hash.update(Buffer.from(value));
        return new Uint8Array(hash.digest());
    }

    /**
     * 计算 SHA256 哈希
     * @param {Uint8Array} value
     * @returns {Uint8Array}
     */
    static sha256(value) {
        const hash = crypto.createHash('sha256');
        hash.update(Buffer.from(value));
        return new Uint8Array(hash.digest());
    }

    /**
     * 计算 SHA512 哈希
     * @param {Uint8Array} value
     * @returns {Uint8Array}
     */
    static sha512(value) {
        const hash = crypto.createHash('sha512');
        hash.update(Buffer.from(value));
        return new Uint8Array(hash.digest());
    }

    /**
     * 计算 HMAC 哈希
     * @param {Uint8Array} key
     * @param {Uint8Array} value
     * @param {string} hash - 哈希算法名称 (md5, sha1, sha256, sha512)
     * @returns {Uint8Array}
     */
    static hmac(key, value, hash) {
        const hmac = crypto.createHmac(hash, Buffer.from(key));
        hmac.update(Buffer.from(value));
        return new Uint8Array(hmac.digest());
    }

    /**
     * 计算 HMAC 哈希并返回十六进制字符串
     * @param {Uint8Array} key
     * @param {Uint8Array} value
     * @param {string} hash - 哈希算法名称
     * @returns {string}
     */
    static hmacString(key, value, hash) {
        const hmac = crypto.createHmac(hash, Buffer.from(key));
        hmac.update(Buffer.from(value));
        return hmac.digest('hex');
    }

    /**
     * 根据 key 长度选择 AES 算法（16/24/32 字节 → 128/192/256）
     */
    static _aesKeyAlgo(key) {
        const len = Buffer.from(key).length;
        if (len <= 16) return 'aes-128';
        if (len <= 24) return 'aes-192';
        return 'aes-256';
    }

    /**
     * AES ECB 解密
     * @param {Uint8Array} value
     * @param {Uint8Array} key
     * @returns {Uint8Array}
     */
    static decryptAesEcb(value, key) {
        const algo = this._aesKeyAlgo(key);
        const keyBuf = Buffer.from(key).slice(0, 32);
        const decipher = crypto.createDecipheriv(`${algo}-ecb`, keyBuf, Buffer.alloc(0));
        decipher.setAutoPadding(true);
        const decrypted = Buffer.concat([decipher.update(Buffer.from(value)), decipher.final()]);
        return new Uint8Array(decrypted);
    }

    /**
     * AES CBC 解密
     * @param {Uint8Array} value
     * @param {Uint8Array} key
     * @param {Uint8Array} iv
     * @returns {Uint8Array}
     */
    static decryptAesCbc(value, key, iv) {
        const algo = this._aesKeyAlgo(key);
        const keyBuf = Buffer.from(key).slice(0, 32);
        const decipher = crypto.createDecipheriv(`${algo}-cbc`, keyBuf, Buffer.from(iv).slice(0, 16));
        decipher.setAutoPadding(true);
        const decrypted = Buffer.concat([decipher.update(Buffer.from(value)), decipher.final()]);
        return new Uint8Array(decrypted);
    }

    /**
     * AES CFB 解密
     * @param {Uint8Array} value
     * @param {Uint8Array} key
     * @param {Uint8Array} iv
     * @returns {Uint8Array}
     */
    static decryptAesCfb(value, key, iv) {
        const algo = this._aesKeyAlgo(key);
        const keyBuf = Buffer.from(key).slice(0, 32);
        const decipher = crypto.createDecipheriv(`${algo}-cfb`, keyBuf, Buffer.from(iv).slice(0, 16));
        decipher.setAutoPadding(false);
        const decrypted = Buffer.concat([decipher.update(Buffer.from(value)), decipher.final()]);
        return new Uint8Array(decrypted);
    }

    /**
     * AES OFB 解密
     * @param {Uint8Array} value
     * @param {Uint8Array} key
     * @param {Uint8Array} iv
     * @returns {Uint8Array}
     */
    static decryptAesOfb(value, key, iv) {
        const algo = this._aesKeyAlgo(key);
        const keyBuf = Buffer.from(key).slice(0, 32);
        const decipher = crypto.createDecipheriv(`${algo}-ofb`, keyBuf, Buffer.from(iv).slice(0, 16));
        decipher.setAutoPadding(false);
        const decrypted = Buffer.concat([decipher.update(Buffer.from(value)), decipher.final()]);
        return new Uint8Array(decrypted);
    }

    /**
     * RSA 解密（简化实现，使用私钥）
     * @param {Uint8Array} value
     * @param {Uint8Array} key - PEM 格式的私钥
     * @returns {Uint8Array}
     */
    static decryptRsa(value, key) {
        const privateKey = Buffer.from(key).toString();
        const decrypted = crypto.privateDecrypt(privateKey, Buffer.from(value));
        return new Uint8Array(decrypted);
    }

    /**
     * 将 Uint8Array 转换为十六进制字符串
     * @param {Uint8Array} value
     * @returns {string}
     */
    static hexEncode(value) {
        return Buffer.from(value).toString('hex');
    }

    /**
     * 将十六进制字符串转换为 Uint8Array
     * @param {string} hex
     * @returns {Uint8Array}
     */
    static hexDecode(hex) {
        return new Uint8Array(Buffer.from(hex, 'hex'));
    }
}

module.exports = { Convert };
