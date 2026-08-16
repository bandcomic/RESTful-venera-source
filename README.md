# Venera Source Converter

**Venera Source Converter** 是一个中间件服务，将 **Venera** 漫画阅读器的 JavaScript 漫画源转换为通用 REST API 格式，可接入任意支持 HTTP 自定义漫画源协议的客户端。

支持 **双部署**：VPS/本地（Express 直跑）与腾讯云 **EdgeOne Pages 云函数**（Node.js v20，无需 sharp 等原生依赖，全 WASM 图片管线）。

## ✨ 核心特点

- **无缝兼容 Venera 源**：直接加载 `.js` 漫画源文件，在 `node:vm` 沙箱中模拟完整 Venera 运行时（`Network` / `HtmlDocument` / `Convert` / `UI` / `APP` / Cookie jar / `isLogged` / `translate` 等）。
- **标准化 REST API**（sourceKey 在路径中，RESTful 风格）：
  - `GET /config` —— 源配置（sourceKey 使用源内部 `key`）
  - `GET /<key>/search/<text>/<page>` —— 搜索
  - `GET /<key>/comic/<id>` —— 详情
  - `GET /<key>/comic/<id>/cover` —— 封面（TTL 缓存）
  - `GET /<key>/photo/<id>/chapter/<n>` —— 章节图片列表
  - `GET /<key>/photo/<id>/chapter/<n>/<page>.jpg` —— 单页图片
- **完整图片管线**（纯 WASM，无原生依赖）：
  - 解码：webp / jpeg / png / **avif**
  - 输出：JPEG（质量可调）、PNG（颜色量化）、**LVGL 预解码二进制**（4 字节头 + BGRA 调色板 + 1 字节索引）
  - 参数：`width`、`quality`、`ifPNG=1`、`ifLVGL=1`（`ifLVGL` 优先于 `ifPNG`）
  - 支持源的 `onImageLoad` / `onThumbnailLoad` / `onLoadFailed` 钩子与 **`modifyImage`** 图片解混淆脚本（如 jm 的竖向条带重排）
- **Cookie 透传**：客户端请求携带的 Cookie 头会注入源的请求上下文（仅限源声明的域名），`Network.getCookies` 可读取，支持付费/登录内容。
- **TTL 缓存**：详情 30 分钟 / 章节列表 60 分钟 / 章节图片 2 小时 / 封面 60 分钟；带 Cookie 的请求不读写缓存（防止付费内容泄露与用户串扰）。
- **容错**：图片下载失败自动刷新章节数据重试一次；网络错误指数退避重试；请求级信号量并发控制（5 并发）。

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 添加漫画源

将 Venera 的 `.js` 漫画源文件放入 `cloud-functions/sources` 目录（或通过 `SOURCES_DIR` 环境变量指定其他目录）。

### 3. 本地启动

```bash
npm start          # 默认 3000 端口
npm start -- 8080  # 指定端口
```

### 4. API 使用示例

```bash
# 获取源配置
curl http://localhost:3000/config

# 搜索
curl 'http://localhost:3000/manga_dex/search/%E6%B5%B7%E8%B4%BC%E7%8E%8B/1'

# 详情 / 封面 / 章节列表 / 单页图片
curl 'http://localhost:3000/manga_dex/comic/<id>'
curl 'http://localhost:3000/manga_dex/comic/<id>/cover?width=80'
curl 'http://localhost:3000/manga_dex/photo/<id>/chapter/1'
curl 'http://localhost:3000/manga_dex/photo/<id>/chapter/1/1.jpg?width=600&quality=50&ifPNG=1&ifLVGL=1'
```

## ☁️ EdgeOne Pages 部署

项目根目录的 `cloud-functions/` 为 EdgeOne Pages 云函数（Node.js v20，Express 框架模式）。

**入口约定**（构建器通过 AST 静态识别）：
- `cloud-functions/[[default]].js` 为框架模式入口，必须显式包含 `import express from "express"` + `const app = express()` + `export default app`（仅 `export default createApp()` 不会被识别为云函数）；
- 框架模式的函数文件名必须是 `[[xxx]]` 格式，`index.js` 这类普通文件名不会被注册；
- 根级 `[[default]].js` 生成 catch-all 路由 `^/(.*)$`，接管全部 API 路径。

**edgeone.json 关键配置**：

```json
{
  "cloudFunctions": {
    "maxDuration": 120,
    "includeFiles": ["cloud-functions/sources/**"],
    "externalNodeModules": ["@jsquash/webp", "@jsquash/jpeg", "@jsquash/png", "@jsquash/avif", "@jsquash/resize", "jsdom", "image-q"],
    "regions": { "overseas": ["ap-singapore"] }
  }
}
```

- `includeFiles`：把漫画源目录复制进函数包（构建产物中位于 `included_files/cloud-functions/sources/`，代码已做路径回退兼容）；
- `externalNodeModules`：jsquash 的 `.wasm` 与 jsdom 等含静态文件的包必须声明，构建器会单独安装而非 bundle；
- `regions.overseas`：上游多为海外站点，部署到海外地域。

**本地验证部署产物**（与 EdgeOne 构建产物一致）：

```bash
npm run build:edgeone
node .edgeone/cloud-functions/api-node/index.mjs   # http://localhost:9000
```

**部署**：将仓库导入 EdgeOne Makers（导入 Git 仓库），框架预设选择"自定义"（纯云函数项目，无前端构建）。公网地址经 `Eo-Pages-Host` 请求头自动识别；若有异常可配置环境变量 `PUBLIC_URL=https://your-domain` 强制指定。

可选环境变量：

| 变量 | 说明 |
| --- | --- |
| `PUBLIC_URL` | 强制指定对外基础地址（EdgeOne 上通常不需要） |
| `SOURCES_DIR` | 漫画源目录（默认自动探测 `cloud-functions/sources` 或构建产物内 `included_files/`） |

## 🧪 全量源测试

```bash
# 拉取 venera-configs 官方 33 个源并逐个验证（搜索→详情→章节→图片）
npm run test:sources

# 测试单个源
node scripts/test-all-sources.js jm
```

测试脚本会输出四档结果：端到端可用 / 部分可用 / 搜索失败（登录/验证码/地区/上游变更）。详细结果写入 `/tmp/vsc-test-results.json`。

## ❤️ 致谢

- [Venera](https://github.com/venera-app) 及其社区：JS 漫画源生态与运行时 API 定义
- [@jsquash](https://github.com/jamsinclair/jsquash)：纯 WASM 图片编解码
- [image-q](https://github.com/igor-bezkrovnyi/image-quantization)：颜色量化

---

*本项目仅供学习交流使用，请勿用于非法用途。*
