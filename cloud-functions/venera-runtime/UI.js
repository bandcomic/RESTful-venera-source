/**
 * UI API - 用户界面交互（服务器端模拟实现）
 * 在服务器环境中，这些功能会被记录到日志中，但不会实际显示 UI
 */
class UI {
    static loadingIdCounter = 0;
    static activeLoadings = new Map();

    /**
     * 显示消息
     * @param {string} message
     */
    static showMessage(message) {
        console.log('[UI Message]:', message);
    }

    /**
     * 显示对话框
     * @param {string} title
     * @param {string} content
     * @param {Array} actions - {text, callback, style}
     */
    static showDialog(title, content, actions) {
        console.log('[UI Dialog]:', title, '-', content);
        if (actions && actions.length > 0) {
            console.log('[UI Dialog Actions]:', actions.map(a => a.text).join(', '));
        }
    }

    /**
     * 在外部浏览器中打开 URL
     * @param {string} url
     */
    static launchUrl(url) {
        console.log('[UI Launch URL]:', url);
    }

    /**
     * 显示加载对话框
     * @param {Function} onCancel
     * @returns {number} 加载对话框 ID
     */
    static showLoading(onCancel) {
        const id = ++this.loadingIdCounter;
        this.activeLoadings.set(id, { onCancel, startTime: Date.now() });
        console.log('[UI Loading]: Show loading dialog #' + id);
        return id;
    }

    /**
     * 取消加载对话框
     * @param {number} id
     */
    static cancelLoading(id) {
        const loading = this.activeLoadings.get(id);
        if (loading) {
            this.activeLoadings.delete(id);
            console.log('[UI Loading]: Cancel loading dialog #' + id);
        }
    }

    /**
     * 显示输入对话框
     * @param {string} title
     * @param {Function} validator
     * @returns {string | null}
     */
    static showInputDialog(title, validator) {
        console.log('[UI Input Dialog]:', title);
        // 在服务器环境中返回 null
        return null;
    }

    /**
     * 显示选择对话框
     * @param {string} title
     * @param {string[]} options
     * @param {number} initialIndex
     * @returns {number | null}
     */
    static showSelectDialog(title, options, initialIndex = 0) {
        console.log('[UI Select Dialog]:', title, '- Options:', options.join(', '));
        // 在服务器环境中返回初始索引
        return initialIndex;
    }
}

module.exports = { UI };
