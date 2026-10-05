# 三平台部署与图片管线

业务核心为 `src/core`。VPS 使用 `src/server.ts` 的 Fastify 服务；Vercel 使用
Next route 薄入口；EdgeOne 的两条 `cloud-functions` 入口调用同一 Fastify app。
`server.js` 只是已编译 TypeScript 核心的兼容启动器，启动前执行 `npm run server:build`。
该兼容启动器默认 `LEGACY_SOURCE_KEYS=1` 保留旧显示名 key，旧 `/comic`、`/photo`、
`/search` 查询源路由也继续支持。直接 TypeScript/PM2 启动沿用当前 canonical key；
迁移时保持原启动模式或显式设置该变量，以保持 Cookie/历史/离线身份。

- VPS：`npm ci && npm run server:build`，加载 `.env`，`DEPLOY_TARGET=server`，
  `IMAGE_CACHE_DRIVER=file`，然后 `npm run server:start` 或现有 PM2 配置。
- Vercel：`npm ci && npm run build`，Node 22，`DEPLOY_TARGET=vercel`，
  默认内存成品缓存可设置 `IMAGE_CACHE_DRIVER=memory`；无持久文件缓存。
- EdgeOne Makers：Node 云函数，`edgeone.json` 将 `sharp` 标为原生外部模块，
  显式包含 `sources/**`。部署环境需验证 Linux sharp 及其平台依赖进入产物。
  云函数构建配置不要把整个项目作为静态站点导出。

对外地址优先使用 `PUBLIC_URL`（可含路径前缀），其次 EdgeOne `Eo-Pages-Host`
和代理头。`/config` 在 Next 中映射 `/api/config`，各平台均可直接获取目录。
`ENABLED_SOURCES` 控制目录及访问，禁用源返回 JSON 404。

图片参数为 `width/w`、`quality/q`、`ifLVGL > ifPNG > JPEG`。
LVGL 为真正 indexed-8：4 字节头、256 项 BGRA 调色板、逐像素索引。
采用确定性 RGB332 量化，宽高均 ≤2047；透明图片铺白底。
封面使用 `onThumbnailLoad`，正文使用 `onImageLoad`，保留 URL、请求头与响应 hook。

网络总超时、下载字节、解码像素、响应字节、源实例 TTL/数量和源状态字节可配置。
相同图片在暖实例内合并；成品内存按字节限制，文件缓存异步读取、临时文件原子
rename、TTL/容量淘汰。Cookie 内容不进入成品公共缓存，HTTP 输出 `private, no-store`。
默认 VPS 单 Node 进程；多进程/多实例的请求合并和源登录态尚不共享，部署扩容前
需使用外部状态服务补充协调，此项保持在总计划的待办中。

Nginx：将 `/` 转发 `http://127.0.0.1:3000`，设置 Host、X-Forwarded-Host、
X-Forwarded-Proto，读超时 25 秒。公共图片按 24 小时缓存，保留全部图片/源/章节/
规格查询参数；Cookie/Authorization 请求在 EdgeOne CDN 跳过缓存读写。

验证：`npm test`、`npm run typecheck`、`npm run build`。健康接口 `/health`。
本地构建通过不等于真实 Vercel/EdgeOne 已部署；真实平台与手表链路需另行验收。
