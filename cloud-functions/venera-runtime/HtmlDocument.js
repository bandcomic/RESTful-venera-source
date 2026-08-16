const { JSDOM } = require('jsdom');

/**
 * HtmlNode 类 - 表示 HTML 节点
 */
class HtmlNode {
    constructor(node) {
        this._node = node;
    }

    /**
     * 获取节点类型
     * @returns {string} - "text", "element", "comment", "document", "unknown"
     */
    get type() {
        if (!this._node) return 'unknown';
        switch (this._node.nodeType) {
            case 1: return 'element';
            case 3: return 'text';
            case 8: return 'comment';
            case 9: return 'document';
            default: return 'unknown';
        }
    }

    /**
     * 将节点转换为元素
     * @returns {HtmlElement | null}
     */
    toElement() {
        if (this.type === 'element') {
            return new HtmlElement(this._node);
        }
        return null;
    }

    /**
     * 获取文本内容
     * @returns {string}
     */
    get text() {
        return this._node ? this._node.textContent || '' : '';
    }
}

/**
 * HtmlElement 类 - 表示 HTML 元素
 */
class HtmlElement {
    constructor(element) {
        this._element = element;
    }

    /**
     * 使用 CSS 选择器查找第一个匹配的元素
     * @param {string} selector
     * @returns {HtmlElement | null}
     */
    querySelector(selector) {
        if (!this._element) return null;
        const el = this._element.querySelector(selector);
        return el ? new HtmlElement(el) : null;
    }

    /**
     * 使用 CSS 选择器查找所有匹配的元素
     * @param {string} selector
     * @returns {HtmlElement[]}
     */
    querySelectorAll(selector) {
        if (!this._element) return [];
        const elements = this._element.querySelectorAll(selector);
        return Array.from(elements).map(el => new HtmlElement(el));
    }

    /**
     * 根据 ID 查找元素
     * @param {string} id
     * @returns {HtmlElement | null}
     */
    getElementById(id) {
        if (!this._element) return null;
        const win = this._element.ownerDocument && this._element.ownerDocument.defaultView;
        const escaped = (win && win.CSS && win.CSS.escape) ? win.CSS.escape(id) : String(id).replace(/["\\\n\r\t\f]/g, '\\$&');
        const el = this._element.querySelector('#' + escaped);
        return el ? new HtmlElement(el) : null;
    }

    /**
     * 获取文本内容
     * @returns {string}
     */
    get text() {
        return this._element ? this._element.textContent || '' : '';
    }

    /**
     * 获取所有属性
     * @returns {object}
     */
    get attributes() {
        if (!this._element || !this._element.attributes) return {};
        const attrs = {};
        for (let i = 0; i < this._element.attributes.length; i++) {
            const attr = this._element.attributes[i];
            attrs[attr.name] = attr.value;
        }
        return attrs;
    }

    /**
     * 获取子元素
     * @returns {HtmlElement[]}
     */
    get children() {
        if (!this._element || !this._element.children) return [];
        return Array.from(this._element.children).map(el => new HtmlElement(el));
    }

    /**
     * 获取子节点
     * @returns {HtmlNode[]}
     */
    get nodes() {
        if (!this._element || !this._element.childNodes) return [];
        return Array.from(this._element.childNodes).map(node => new HtmlNode(node));
    }

    /**
     * 获取父元素
     * @returns {HtmlElement | null}
     */
    get parent() {
        if (!this._element || !this._element.parentElement) return null;
        return new HtmlElement(this._element.parentElement);
    }

    /**
     * 获取内部 HTML
     * @returns {string}
     */
    get innerHtml() {
        return this._element ? this._element.innerHTML || '' : '';
    }

    /**
     * 获取内部 HTML（真实 API 名称为 innerHTML）
     * @returns {string}
     */
    get innerHTML() {
        return this.innerHtml;
    }

    /**
     * 获取类名列表
     * @returns {string[]}
     */
    get classNames() {
        if (!this._element) return [];
        return Array.from(this._element.classList || []);
    }

    /**
     * 获取 ID
     * @returns {string | null}
     */
    get id() {
        return this._element ? this._element.id || null : null;
    }

    /**
     * 获取本地名称（标签名）
     * @returns {string}
     */
    get localName() {
        return this._element ? this._element.localName || this._element.tagName?.toLowerCase() || '' : '';
    }

    /**
     * 获取前一个兄弟元素
     * @returns {HtmlElement | null}
     */
    get previousSibling() {
        if (!this._element || !this._element.previousElementSibling) return null;
        return new HtmlElement(this._element.previousElementSibling);
    }

    /**
     * 获取前一个兄弟元素（真实 API 名称）
     * @returns {HtmlElement | null}
     */
    get previousElementSibling() {
        return this.previousSibling;
    }

    /**
     * 获取后一个兄弟元素
     * @returns {HtmlElement | null}
     */
    get nextSibling() {
        if (!this._element || !this._element.nextElementSibling) return null;
        return new HtmlElement(this._element.nextElementSibling);
    }

    /**
     * 获取后一个兄弟元素（真实 API 名称）
     * @returns {HtmlElement | null}
     */
    get nextElementSibling() {
        return this.nextSibling;
    }

    /**
     * 获取属性值
     * @param {string} name
     * @returns {string | null}
     */
    getAttribute(name) {
        return this._element ? this._element.getAttribute(name) : null;
    }
}

/**
 * HtmlDocument 类 - HTML 文档解析
 */
class HtmlDocument {
    constructor(html) {
        const dom = new JSDOM(html);
        this._document = dom.window.document;
    }

    /**
     * 使用 CSS 选择器查找第一个匹配的元素
     * @param {string} selector
     * @returns {HtmlElement | null}
     */
    querySelector(selector) {
        if (!this._document) return null;
        const el = this._document.querySelector(selector);
        return el ? new HtmlElement(el) : null;
    }

    /**
     * 使用 CSS 选择器查找所有匹配的元素
     * @param {string} selector
     * @returns {HtmlElement[]}
     */
    querySelectorAll(selector) {
        if (!this._document) return [];
        const elements = this._document.querySelectorAll(selector);
        return Array.from(elements).map(el => new HtmlElement(el));
    }

    /**
     * 根据 ID 查找元素
     * @param {string} id
     * @returns {HtmlElement | null}
     */
    getElementById(id) {
        if (!this._document) return null;
        const el = this._document.getElementById(id);
        return el ? new HtmlElement(el) : null;
    }

    /**
     * 释放资源
     */
    dispose() {
        this._document = null;
    }
}

module.exports = { HtmlDocument, HtmlElement, HtmlNode };
