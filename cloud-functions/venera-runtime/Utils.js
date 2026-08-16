const crypto = require('crypto');

// 数据存储（内存中）
const dataStore = new Map();
const settingsStore = new Map();

/**
 * 创建基于时间的 UUID
 * @returns {string}
 */
function createUuid() {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    return `${timestamp}-${random}`;
}

/**
 * 生成指定范围内的随机整数
 * @param {number} min - 最小值（包含）
 * @param {number} max - 最大值（包含）
 * @returns {number}
 */
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 生成指定范围内的随机浮点数
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {number}
 */
function randomDouble(min, max) {
    return Math.random() * (max - min) + min;
}

/**
 * 数据持久化工具类
 */
class DataStorage {
    constructor(sourceKey) {
        this.sourceKey = sourceKey;
        if (!dataStore.has(sourceKey)) {
            dataStore.set(sourceKey, new Map());
        }
        this.store = dataStore.get(sourceKey);
    }

    /**
     * 加载数据
     * @param {string} key
     * @returns {any}
     */
    loadData(key) {
        return this.store.get(key) || null;
    }

    /**
     * 保存数据
     * @param {string} key
     * @param {any} value
     */
    saveData(key, value) {
        this.store.set(key, value);
    }

    /**
     * 加载设置
     * @param {string} key
     * @returns {any}
     */
    loadSetting(key) {
        const settings = settingsStore.get(this.sourceKey) || {};
        return settings[key] || null;
    }

    /**
     * 保存设置
     * @param {string} key
     * @param {any} value
     */
    saveSetting(key, value) {
        if (!settingsStore.has(this.sourceKey)) {
            settingsStore.set(this.sourceKey, {});
        }
        const settings = settingsStore.get(this.sourceKey);
        settings[key] = value;
    }

    /**
     * 删除数据
     * @param {string} key
     */
    deleteData(key) {
        this.store.delete(key);
    }
}

module.exports = {
    createUuid,
    randomInt,
    randomDouble,
    DataStorage,
    dataStore,
    settingsStore
};
