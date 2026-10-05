# Venera Source Converter

**Venera Source Converter** 是一个中间层服务，将 **Venera** 漫画阅读器的 JavaScript 漫画源无缝转换为 REST API 格式。支持双部署架构：Vercel 一键部署 和 自有服务器 PM2 部署。

## 核心特点

- **无缝兼容 Venera 源**：直接加载 Venera 的 `.js` 漫画源文件，无需修改。在 Node.js vm 中模拟 Venera 运行时环境（`Network`, `HtmlDocument`, `Crypto`, `Convert` 等）。
- **双部署架构**：
  - **Vercel**：Serverless 部署，全球 CDN 加速，零服务器维护成本。
  - **PM2/Fastify**：自有服务器部署，适合长期运行、大流量或需要本地图片缓存的场景。
- **标准化 REST API**：统一的 JSON 格式接口：
  - **搜索**：`GET /api/:source/search/:text/:page`
  - **详情**：`GET /api/:source/album/:id`
  - **章节图片**：`GET /api/:source/photo/:id/chapter/:chapter`
  - **源配置**：`GET /config`
  - **图片代理**：`GET /api/image/proxy?url=...&source=...`
- **智能图片代理**：支持图片压缩、格式转换（WebP → JPEG/PNG）、LVGL 预解码、防盗链处理。
- **高度容错**：全局异常捕获，未处理 Promise 拒绝防护，防止源网络错误导致服务崩溃。

## 技术栈

- **TypeScript** — 类型安全
- **Next.js (Vercel)** — Serverless API Routes
- **Fastify (PM2)** — 高性能服务器
- **sharp** — 图片处理
- **Node.js vm** — 安全隔离的 JS 源运行时

## 部署方式

### 方式一：Vercel 一键部署

1. Fork 本仓库到 GitHub。
2. 登录 [Vercel](https://vercel.com)，导入 Fork 的仓库。
3. 使用默认设置部署，无需额外配置。
4. 部署完成后访问 `https://<your-project>.vercel.app/config` 查看源配置。

> **注意**：Vercel 为 Serverless 环境，图片处理（sharp）可能受内存限制，建议配合外部 CDN 使用。
>
> 默认情况下，Vercel 只启用 `copy_manga,manga_dex`。`nhentai` 经常受 Cloudflare/地区访问限制影响，`picacg` 需要登录态且 API 对 Serverless 出口较敏感。如果你确认自己的部署环境可访问，可在 Vercel 环境变量中设置：
>
> ```
> ENABLED_SOURCES=copy_manga,manga_dex,nhentai,picacg
> ```
>
> `nhentai` 如遇 403 Cloudflare 挑战页，可把已通过浏览器验证的 Cookie 配到环境变量：
>
> ```
> NHENTAI_COOKIE=cf_clearance=...; csrftoken=...
> NHENTAI_USER_AGENT=你的浏览器 User-Agent
> ```

### 方式二：PM2 服务器部署

```bash
# 安装依赖
npm install

# 构建生产版本
npm run build:server

# 使用 PM2 启动
pm2 start ecosystem.config.cjs

# 查看日志
pm2 logs venera-converter
```

> **环境变量**：`PORT`（默认 3000），`DEPLOY_TARGET`（`vercel` 或 `server`）。

## 开发调试

```bash
# 安装依赖
npm install

# 启动 Fastify 开发服务器（热重载）
npm run server:dev

# 启动 Next.js 开发服务器（Vercel 模式）
npm run dev
```

## API 使用示例

假设服务运行在 `http://localhost:3000`：

- **获取源配置**（所有可用源及其接口地址）：
  ```
  GET /config
  ```
- **搜索漫画**（以 `manga_dex` 为例）：
  ```
  GET /api/manga_dex/search/test/1
  ```
- **获取漫画详情**：
  ```
  GET /api/manga_dex/album/f9c33607-9180-4ba6-b85c-e4b5faee7192
  ```
- **获取章节图片**：
  ```
  GET /api/manga_dex/photo/f9c33607-9180-4ba6-b85c-e4b5faee7192/chapter/1
  ```
- **代理图片**（自动压缩、转码）：
  ```
  GET /api/image/proxy?source=manga_dex&url=https://...&w=256
  ```

## 源文件配置

将 Venera 的 `.js` 漫画源文件放入 `sources/` 目录中。源文件会自动被加载和注册。

支持的源示例：
- `manga_dex.js` — MangaDex（英文漫画）
- `copy_manga.js` — 拷贝漫画（中文漫画）
- `nhentai.js` — nhentai（同人志）
- `picacg.js` — 哔咔漫画（中文漫画）

## 腕上漫画同步器集成

本项目输出的 `/config` 接口可直接被腕上漫画同步器使用，实现 Venera 源的无缝迁移：

```json
{
  "manga_dex": {
    "name": "MangaDex",
    "apiUrl": "http://your-server.com",
    "detailPath": "/api/manga_dex/album/<id>",
    "photoPath": "/api/manga_dex/photo/<id>/chapter/<chapter>",
    "searchPath": "/api/manga_dex/search/<text>/<page>",
    "type": "venera"
  }
}
```

## 热重载

部署后如需加载新源文件，可调用：

```bash
POST /reload
```

> 需在服务器部署模式下开启 `enableReload` 配置。

## 致谢 Venera

本项目基于 [**Venera**](https://github.com/venera-app) 开源生态构建，感谢 Venera 项目组设计的灵活漫画源插件系统。

---
*本项目仅供学习交流使用，请勿用于非法用途。*
# 三平台部署更新

当前统一使用 TypeScript 业务核心。部署入口、原生依赖打包、图片/缓存预算与
本地验证步骤见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。
