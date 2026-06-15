# 技术栈与部署架构方案

本文档记录 `venera-source-converter` 后续推荐的技术栈、架构拆分方式，以及同时支持 **Vercel 一键部署** 和 **用户服务器 PM2 部署** 的实现方案。

## 1. 项目定位

本项目的目标不是提供公开高并发漫画 API，而是提供一个可由用户自行部署的中间层服务：

```text
Venera 漫画源 JS 插件
  ↓
Venera 兼容运行时
  ↓
腕上漫画自定义漫画源 HTTP API
  ↓
小米 Vela 快应用 / 手环端
```

主要目标：

1. 复用 Venera 漫画源生态。
2. 将 Venera 源转换为腕上漫画可消费的 REST API。
3. 在服务端完成图片压缩、格式转换、预处理，降低手环端压力。
4. 普通用户可以使用 Vercel 一键部署。
5. 进阶用户可以使用自己的服务器通过 PM2 常驻运行。

## 2. 推荐技术栈

### 2.1 共用核心

| 模块 | 技术选型 |
| --- | --- |
| 语言 | TypeScript |
| Venera 源执行 | Node `vm` 起步，后续可替换为 QuickJS / quickjs-emscripten |
| HTTP 请求 | 原生 `fetch` / undici |
| HTML 解析 | cheerio / linkedom |
| 图片处理 | sharp |
| 缓存抽象 | MemoryCache / FileCache，可选 KV |
| 配置 | 环境变量 |

### 2.2 Vercel 部署

| 模块 | 技术选型 |
| --- | --- |
| 框架 | Next.js App Router |
| 运行时 | Vercel Node.js Runtime |
| API 入口 | `app/api/**/route.ts` |
| 缓存 | 内存缓存 + Vercel CDN Cache-Control |
| 图片缓存 | 默认不持久化，可后续接 Vercel Blob / R2 |

### 2.3 PM2 服务器部署

| 模块 | 技术选型 |
| --- | --- |
| HTTP 服务 | Fastify |
| 进程管理 | PM2 |
| 缓存 | 文件缓存 |
| 图片缓存 | 本地文件缓存 |
| 源加载 | 启动预加载 + 可选 `/reload` 热重载 |

## 3. 为什么不只换 Express

现有实现使用 Express，但本项目的主要瓶颈通常不是 Express 本身，而是：

1. Venera 源 JS 执行。
2. 上游漫画站请求延迟。
3. HTML 解析。
4. 加解密、签名、Cookie 处理。
5. 图片下载、缩放、转码、LVGL 预解码。

因此，后续优化重点应放在：

```text
运行时兼容性
图片处理管线
缓存策略
部署模式适配
源隔离与热重载
```

而不是单纯替换 HTTP 框架。

## 4. 总体架构

推荐使用“核心逻辑无框架，入口适配分离”的结构：

```text
venera-source-converter/
  app/                         # Vercel / Next.js API 入口
    api/
      config/route.ts
      [source]/
        album/[id]/route.ts
        search/[text]/[page]/route.ts
        photo/[id]/chapter/[chapter]/route.ts
      image/
        proxy/route.ts

  src/
    core/                      # 共用核心逻辑
      config.ts
      protocol/
      runtime/
      image/
      cache/
      sources/

    server.ts                  # PM2 / Fastify 服务器入口

  sources/                     # 内置 Venera 漫画源
    copy_manga.js
    manga_dex.js
    nhentai.js

  data/                        # PM2 模式本地缓存目录，加入 .gitignore
    cache/
    images/
    storage/

  ecosystem.config.cjs         # PM2 配置
  next.config.ts
  vercel.json
  package.json
```

## 5. 核心逻辑设计

核心层不应直接依赖 Next.js、Fastify、Express 等框架，而是提供普通函数：

```ts
getConfig(baseUrl, context)
searchComic(sourceKey, keyword, page, context)
getComicDetail(sourceKey, id, context)
getPhotoList(sourceKey, id, chapter, context)
proxyImage(params, context)
```

两个部署入口都调用同一套 core。

### 5.1 Vercel 入口示例

```ts
export async function GET(req: Request) {
  const result = await searchComic(sourceKey, keyword, page, context)
  return Response.json(result)
}
```

### 5.2 PM2 / Fastify 入口示例

```ts
fastify.get('/api/:source/search/:text/:page', async (req, reply) => {
  return searchComic(sourceKey, keyword, page, context)
})
```

## 6. API 路由设计

最终对腕上漫画暴露以下接口：

```text
GET /config
GET /api/:source/album/:id
GET /api/:source/search/:text/:page
GET /api/:source/photo/:id/chapter/:chapter
GET /api/image/proxy
```

其中 `/config` 输出腕上漫画自定义漫画源配置，例如：

```json
{
  "copy_manga": {
    "name": "拷贝漫画",
    "apiUrl": "https://your-domain.vercel.app",
    "detailPath": "/api/copy_manga/album/<id>",
    "photoPath": "/api/copy_manga/photo/<id>/chapter/<chapter>",
    "searchPath": "/api/copy_manga/search/<text>/<page>",
    "type": "venera"
  }
}
```

## 7. Venera Runtime 兼容层

第一版不需要实现完整 Venera App，只需要实现腕上漫画所需能力。

### 7.1 必须支持

| Venera API | 用途 |
| --- | --- |
| `search.load` | 搜索漫画 |
| `comic.loadInfo` | 获取漫画详情 |
| `comic.loadEp` | 获取章节图片列表 |
| `comic.onImageLoad` | 获取图片请求配置、Headers、响应处理 |
| `comic.onThumbnailLoad` | 获取封面图请求配置 |
| `Network.get/post/fetch` | 上游请求 |
| `Convert` | 加解密、hash、base64、编码转换 |
| `HtmlDocument` | HTML 解析 |
| `loadData/saveData` | 源内部状态存储 |
| `loadSetting` | 源默认设置读取 |
| `Cookie` | 登录态和 Cookie 处理 |

### 7.2 暂不需要

| Venera 能力 | 原因 |
| --- | --- |
| `explore` | 腕上漫画当前协议不需要首页发现流 |
| `category` | 当前协议不需要分类页 |
| `favorites` | 当前协议不负责收藏同步 |
| `comments` | 手环端不展示评论 |
| `UI` | 服务端无交互界面，可空实现 |

## 8. 图片处理策略

图片接口需要兼容腕上漫画的参数规则：

```text
width=<目标宽度>
quality=<图片质量>
ifPNG=1
ifLVGL=1
```

处理优先级：

```text
ifLVGL=1 > ifPNG=1 > 默认 JPEG
```

推荐流程：

```text
请求 /api/image/proxy
  ↓
解析 url/source/comicId/epId/width/quality/ifPNG/ifLVGL
  ↓
调用 source.comic.onImageLoad 获取 headers / url / onResponse
  ↓
下载原图
  ↓
必要时执行 onResponse
  ↓
sharp 缩放与格式转换
  ↓
按参数返回 JPEG / PNG / LVGL bin
```

### 8.1 Vercel 模式

默认不使用本地持久缓存，依赖 HTTP 缓存：

```http
Cache-Control: public, max-age=86400, s-maxage=86400
```

后续可选接入：

```text
Vercel Blob
Cloudflare R2
Upstash Redis / Vercel KV
```

### 8.2 PM2 模式

默认启用文件缓存：

```text
IMAGE_CACHE_DRIVER=file
IMAGE_CACHE_DIR=./data/images
```

缓存 key 建议包含：

```text
source + url + width + quality + ifPNG + ifLVGL
```

## 9. 缓存抽象

定义统一缓存接口：

```ts
interface CacheStore {
  get(key: string): Promise<Buffer | string | null>
  set(key: string, value: Buffer | string, ttl?: number): Promise<void>
  delete?(key: string): Promise<void>
}
```

实现：

```text
MemoryCache  # Vercel 默认
FileCache    # PM2 默认
KvCache      # 后续可选
```

通过环境变量切换：

```env
CACHE_DRIVER=memory
IMAGE_CACHE_DRIVER=none
```

或：

```env
CACHE_DRIVER=file
IMAGE_CACHE_DRIVER=file
```

## 10. 部署模式

### 10.1 Vercel 一键部署

适合普通用户、个人低频使用。

特点：

1. 无需服务器。
2. 点击 Deploy with Vercel 即可部署。
3. 默认使用无状态函数。
4. 按请求懒加载源。
5. 不提供 `/reload`。

推荐环境变量：

```env
DEPLOY_TARGET=vercel
ENABLED_SOURCES=copy_manga,manga_dex,nhentai
DEFAULT_IMAGE_WIDTH=600
DEFAULT_IMAGE_QUALITY=50
CACHE_DRIVER=memory
IMAGE_CACHE_DRIVER=none
ENABLE_RELOAD=false
```

### 10.2 PM2 服务器部署

适合拥有服务器、希望长期稳定使用的用户。

特点：

1. 常驻服务。
2. 支持文件缓存。
3. 支持图片本地缓存。
4. 可支持 `/reload` 热重载。
5. 更适合图片预处理和 LVGL 预解码。

推荐环境变量：

```env
DEPLOY_TARGET=server
PORT=3000
ENABLED_SOURCES=copy_manga,manga_dex,nhentai
DEFAULT_IMAGE_WIDTH=600
DEFAULT_IMAGE_QUALITY=50
CACHE_DRIVER=file
IMAGE_CACHE_DRIVER=file
CACHE_DIR=./data/cache
IMAGE_CACHE_DIR=./data/images
STORAGE_DIR=./data/storage
ENABLE_RELOAD=true
```

## 11. PM2 配置建议

`ecosystem.config.cjs` 示例：

```js
module.exports = {
  apps: [
    {
      name: "venera-source-converter",
      script: "dist/server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        DEPLOY_TARGET: "server",
        PORT: "3000",
        CACHE_DRIVER: "file",
        IMAGE_CACHE_DRIVER: "file",
        CACHE_DIR: "./data/cache",
        IMAGE_CACHE_DIR: "./data/images",
        STORAGE_DIR: "./data/storage",
        ENABLED_SOURCES: "copy_manga,manga_dex,nhentai",
        ENABLE_RELOAD: "true"
      }
    }
  ]
}
```

第一版建议使用 `fork` 单进程模式，不建议直接使用 cluster。原因：

1. Venera 源运行时状态更简单。
2. 内存缓存和文件缓存更容易管理。
3. 源热重载更可控。
4. 个人使用场景不需要多进程高并发。

## 12. package.json 脚本建议

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "server:dev": "tsx src/server.ts",
    "server:build": "tsc -p tsconfig.server.json",
    "server:start": "node dist/server.js",
    "pm2:start": "npm run server:build && pm2 start ecosystem.config.cjs",
    "pm2:restart": "npm run server:build && pm2 restart venera-source-converter",
    "pm2:stop": "pm2 stop venera-source-converter",
    "pm2:logs": "pm2 logs venera-source-converter"
  }
}
```

## 13. 源加载策略

### 13.1 Vercel

```text
请求到达
  ↓
读取 sourceKey
  ↓
只加载对应源
  ↓
执行对应方法
  ↓
返回结果
```

这样可以降低冷启动开销。

### 13.2 PM2

```text
服务启动
  ↓
读取 ENABLED_SOURCES
  ↓
预加载所有启用源
  ↓
请求到达后直接调用
```

PM2 模式可额外支持：

```text
POST /reload
```

用于重新加载 `sources` 目录中的源文件。

## 14. Cookie 设计

腕上漫画同步器上传 Cookie 时，以 `/config` 中的 sourceKey 为键。

示例：

```json
{
  "ehentai": "ipb_member_id=xxx; ipb_pass_hash=xxx; igneous=xxx",
  "jm": "xxx=yyy"
}
```

请求某个源时：

```text
/api/ehentai/search/test/1
```

服务端应：

```text
读取请求 Cookie
  ↓
按 sourceKey 提取对应值
  ↓
注入 Venera Runtime 的 Network/Cookie 层
  ↓
上游请求携带 Cookie
```

## 15. 推荐开发阶段

### 阶段 1：最小可用版本

实现：

```text
/config
/api/:source/search/:text/:page
/api/:source/album/:id
/api/:source/photo/:id/chapter/:chapter
/api/image/proxy
```

优先支持：

```text
manga_dex
copy_manga
nhentai
```

### 阶段 2：增强 Venera 兼容性

补齐：

```text
Cookie
loadSetting
loadData/saveData
onImageLoad
onThumbnailLoad
更多 Convert 方法
```

### 阶段 3：图片增强

补齐：

```text
PNG 转换
LVGL 预解码
图片缓存
错误占位图
```

### 阶段 4：部署体验

完善：

```text
Deploy with Vercel 按钮
PM2 部署教程
.env.example
常见问题
接口测试页
```

## 16. 最终结论

推荐最终形态：

```text
共用核心：
TypeScript + Venera Runtime + fetch/undici + cheerio/linkedom + sharp

Vercel：
Next.js App Router + Vercel Functions

服务器：
Fastify + PM2 + FileCache
```

该方案同时满足：

1. 普通用户 Vercel 一键部署。
2. 进阶用户服务器 PM2 常驻部署。
3. 共用一套核心逻辑，避免维护两套项目。
4. 能逐步兼容更多 Venera 源。
5. 能按腕上漫画协议输出搜索、详情、章节和图片接口。
