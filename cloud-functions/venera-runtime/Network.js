const axios = require('axios');
const { AsyncLocalStorage } = require('async_hooks');

/**
 * Cookie 存储（按域名）
 */
const cookieStore = new Map();

/**
 * 客户端 Cookie 透传相关
 * - clientCookieDomains: 源声明的可信任域名集合，客户端上传的 Cookie 只附加到这些域
 * - requestContext: AsyncLocalStorage，承载单次请求的客户端 Cookie 头
 */
const clientCookieDomains = new Set();
const requestContext = new AsyncLocalStorage();

/**
 * 在请求上下文中执行 fn，context.cookie 为客户端上传的原始 Cookie 头
 * context.cookiePairs 为解析后的 [{name, value}]（由中间件填充）
 */
function runWithRequestContext(context, fn) {
  return requestContext.run(context || {}, fn);
}

function getRequestContext() {
  return requestContext.getStore() || {};
}

/**
 * 解析 Cookie 头为 {name, value} 对
 */
function parseCookieHeader(header) {
  if (!header) return [];
  const pairs = [];
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) pairs.push({ name, value });
  }
  return pairs;
}

/**
 * 注册客户端 Cookie 可附加的目标域名
 */
function registerClientCookieDomain(domain) {
  clientCookieDomains.add(domain);
}

function isRegisteredClientCookieDomain(domain) {
  return clientCookieDomains.has(domain);
}

/**
 * 组装最终请求头：合并 Cookie
 * 优先级：显式 Cookie 头 > Cookie jar > 客户端透传 Cookie
 */
function buildHeadersWithCookies(url, headers) {
  const finalHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0',
    'Connection': 'close',
    ...headers,
  };

  if (finalHeaders.cookie || finalHeaders.Cookie) {
    return finalHeaders;
  }

  let hostname = null;
  try {
    hostname = new URL(url).hostname;
  } catch (e) {
    return finalHeaders;
  }

  const jarCookies = cookieStore.get(hostname);
  if (jarCookies && jarCookies.length > 0) {
    finalHeaders.Cookie = jarCookies.map((c) => `${c.name}=${c.value}`).join('; ');
    return finalHeaders;
  }

  const ctx = getRequestContext();
  if (ctx.cookie && isRegisteredClientCookieDomain(hostname)) {
    finalHeaders.Cookie = ctx.cookie;
  }

  return finalHeaders;
}

/**
 * Cookie 类
 */
class Cookie {
  constructor({ name, value, domain }) {
    this.name = name;
    this.value = value;
    this.domain = domain;
  }
}

/**
 * Network API - 网络请求工具
 * 实现 Venera 的所有 Network 功能
 */
class Network {
  /**
   * 发送请求并返回二进制数据
   * @param {string} method - HTTP 方法
   * @param {string} url - 请求 URL
   * @param {object} headers - 请求头
   * @param {ArrayBuffer} data - 请求体数据
   * @returns {Promise<{status: number, headers: object, body: ArrayBuffer}>}
   */
  static async fetchBytes(method, url, headers = {}, data = null) {
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const response = await axios({
          method: method.toLowerCase(),
          url,
          headers: buildHeadersWithCookies(url, headers),
          httpAgent: new (require('http').Agent)({ keepAlive: false }),
          httpsAgent: new (require('https').Agent)({ keepAlive: false }),
          data: data ? Buffer.from(data) : undefined,
          responseType: 'arraybuffer',
          timeout: 30000,
          maxRedirects: 5,
          validateStatus: () => true
        });

        return {
          status: response.status,
          headers: response.headers,
          body: response.data
        };
      } catch (error) {
        if (attempts < maxAttempts && (error.code === 'ECONNRESET' || error.message.includes('socket hang up') || error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED')) {
          console.warn(`Network error (${error.message}) for ${url}. Retrying attempt ${attempts + 1}...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
          continue;
        }
        throw new Error(`Network error: ${error.message}`);
      }
    }
  }

  /**
   * 发送请求并返回字符串
   * @param {string} method - HTTP 方法
   * @param {string} url - 请求 URL
   * @param {object} headers - 请求头
   * @param {ArrayBuffer} data - 请求体数据
   * @returns {Promise<{status: number, headers: object, body: string}>}
   */
  static async sendRequest(method, url, headers = {}, data = null) {
    const result = await this.fetchBytes(method, url, headers, data);
    return {
      status: result.status,
      headers: result.headers,
      body: Buffer.from(result.body).toString('utf-8')
    };
  }

  /**
   * 发送 GET 请求
   * @param {string} url
   * @param {object} headers
   * @returns {Promise<{status: number, headers: object, body: string}>}
   */
  static async get(url, headers = {}) {
    return this.sendRequest('GET', url, headers);
  }

  /**
   * 发送 POST 请求
   * @param {string} url
   * @param {object} headers
   * @param {ArrayBuffer|string|object} data
   * @returns {Promise<{status: number, headers: object, body: string}>}
   */
  static async post(url, headers = {}, data = null) {
    let bodyData = data;
    if (typeof data === 'string') {
      bodyData = Buffer.from(data);
    } else if (data && typeof data === 'object' && !Buffer.isBuffer(data) && !ArrayBuffer.isView(data)) {
      // 部分源（如 ccc）直接传对象，序列化为 JSON
      bodyData = Buffer.from(JSON.stringify(data));
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers = { ...headers, 'Content-Type': 'application/json' };
      }
    }
    return this.sendRequest('POST', url, headers, bodyData);
  }

  /**
   * 发送 PUT 请求
   * @param {string} url
   * @param {object} headers
   * @param {ArrayBuffer} data
   * @returns {Promise<{status: number, headers: object, body: string}>}
   */
  static async put(url, headers = {}, data = null) {
    return this.sendRequest('PUT', url, headers, data);
  }

  /**
   * 发送 DELETE 请求
   * @param {string} url
   * @param {object} headers
   * @returns {Promise<{status: number, headers: object, body: string}>}
   */
  static async delete(url, headers = {}) {
    return this.sendRequest('DELETE', url, headers);
  }

  /**
   * 发送 PATCH 请求
   * @param {string} url
   * @param {object} headers
   * @param {ArrayBuffer} data
   * @returns {Promise<{status: number, headers: object, body: string}>}
   */
  static async patch(url, headers = {}, data = null) {
    return this.sendRequest('PATCH', url, headers, data);
  }

  /**
   * 设置 Cookies
   * @param {string} url
   * @param {Cookie[]} cookies
   */
  static setCookies(url, cookies) {
    const domain = new URL(url).hostname;
    if (!cookieStore.has(domain)) {
      cookieStore.set(domain, []);
    }
    const domainCookies = cookieStore.get(domain);
    for (const cookie of cookies) {
      const existingIndex = domainCookies.findIndex(c => c.name === cookie.name);
      if (existingIndex >= 0) {
        domainCookies[existingIndex] = cookie;
      } else {
        domainCookies.push(cookie);
      }
    }
  }

  /**
   * 获取 Cookies
   * 返回 cookie jar 中的值 + 请求上下文中客户端透传的 Cookie（仅注册域）
   * @param {string} url
   * @returns {Cookie[]}
   */
  static getCookies(url) {
    const domain = new URL(url).hostname;
    const jarCookies = cookieStore.get(domain) || [];
    const ctx = getRequestContext();
    if (ctx.cookiePairs && isRegisteredClientCookieDomain(domain)) {
      const ctxCookies = ctx.cookiePairs
        .filter((c) => c && c.name)
        .map((c) => new Cookie({ name: c.name, value: c.value, domain }));
      return [...jarCookies, ...ctxCookies];
    }
    return jarCookies;
  }

  /**
   * 删除 Cookies
   * @param {string} url
   */
  static deleteCookies(url) {
    const domain = new URL(url).hostname;
    cookieStore.delete(domain);
  }
}

/**
 * Headers shim - 提供浏览器 Headers 风格的 .get()/.has()
 */
class HeadersShim {
  constructor(headers = {}) {
    this._headers = {};
    for (const [key, value] of Object.entries(headers)) {
      this._headers[key.toLowerCase()] = String(value);
    }
  }

  get(name) {
    return this._headers[String(name).toLowerCase()] || null;
  }

  has(name) {
    return this._headers[String(name).toLowerCase()] !== undefined;
  }

  entries() {
    return Object.entries(this._headers);
  }

  keys() {
    return Object.keys(this._headers);
  }

  values() {
    return Object.values(this._headers);
  }

  forEach(callback) {
    for (const [key, value] of this.entries()) {
      callback(value, key, this);
    }
  }
}

/**
 * fetch API - 浏览器风格的 fetch
 * @param {string} url
 * @param {object} options
 * @returns {Promise<Response>}
 */
async function fetch(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = options.headers || {};
  const body = options.body;

  try {
    const response = await axios({
      method: method.toLowerCase(),
      url,
      headers: buildHeadersWithCookies(url, headers),
      data: body,
      responseType: 'arraybuffer',
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: () => true
    });

    if (response.status < 200 || response.status >= 300) {
      console.warn(`HTTP ${response.status} for ${url}`);
      const responseText = Buffer.from(response.data).toString('utf-8').substring(0, 200);
      console.warn('Response:', responseText);
    }

    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      headers: new HeadersShim(response.headers),
      arrayBuffer: async () => response.data,
      text: async () => Buffer.from(response.data).toString('utf-8'),
      json: async () => JSON.parse(Buffer.from(response.data).toString('utf-8'))
    };
  } catch (error) {
    console.warn('Fetch error for ' + url + ':', error.message);
    return {
      status: 0,
      ok: false,
      headers: new HeadersShim(),
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => '',
      json: async () => ({})
    };
  }
}

module.exports = {
  Network,
  Cookie,
  fetch,
  cookieStore,
  requestContext,
  runWithRequestContext,
  getRequestContext,
  registerClientCookieDomain,
  isRegisteredClientCookieDomain,
  HeadersShim,
};
