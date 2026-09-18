# 一梦未醒 API

这是博客的 Cloudflare Worker 内容后端。D1 是文章正文、元信息和标签的唯一真实
数据源；Astro 前端只发布 UI、交互脚本与静态素材，不再包含 Markdown 文章。

生产地址：

```text
https://yimengweixing-api.yimengweixing-api.workers.dev
```

## 组件

- Worker：HTTP API
- D1：文章、标签和小型文章图片
- Workers KV：只读查询缓存（最终一致，不作为真实数据源）
- `packages/shared`：前后端共享响应类型

当前远程 D1 与 KV 已创建并绑定。文章内的 PNG、JPEG、WebP 与 GIF 可通过管理接口
上传到 D1，单张上限为 1.5 MB；公开图片接口使用内容哈希 URL 和长期不可变缓存。
站点 UI 自身的装饰素材仍跟随 Astro 静态构建。

Pages 使用内部读取壳保留 `/blog/:slug/` 和 `/tags/:slug/` URL，浏览器再从 Worker
加载 D1 内容。RSS 与 Sitemap 也由 Worker 实时生成。

## 本地运行

在仓库根目录执行：

```bash
npm install
npm run api:migrate:local
npm run api:dev
```

本地 API 默认运行在 Wrangler 输出的地址，常用接口如下：

```text
GET /api/v1/health
GET /api/v1/ready
GET /api/v1/posts?limit=20&cursor=...
GET /api/v1/posts?q=关键词&tag=标签-slug
GET /api/v1/posts/:slug
GET /api/v1/tags
GET /api/v1/assets/:id/:fileName
GET /rss.xml
GET /sitemap.xml
```

## 管理写入接口

管理接口统一使用 `Authorization: Bearer <token>`，令牌只保存在 Worker Secret
`BLOG_ADMIN_TOKEN` 和本机环境变量中，禁止提交到仓库：

```text
POST   /api/v1/admin/posts
GET    /api/v1/admin/posts?status=all|published|archived
PUT    /api/v1/admin/posts/:slug
GET    /api/v1/admin/posts/:slug/revisions
POST   /api/v1/admin/posts/:slug/archive
DELETE /api/v1/admin/posts/:slug
POST   /api/v1/admin/assets
POST   /api/v1/admin/assets/cleanup
DELETE /api/v1/admin/assets/:id
```

文章写入会同步标签、关联关系与全文检索表，并通过内容版本号立即淘汰 KV 旧缓存。
图片上传请求体是原始二进制，`Content-Type` 必须是受支持的图片类型，
`X-File-Name` 使用 URL 编码后的文件名。

更新、归档和永久删除前会保存文章修订快照。文章与托管图片通过 `post_assets` 建立引用；
更新或删除文章时，只清理已失去全部引用的图片。手动孤儿清理仅影响上传超过一天且没有
文章引用的文件，仍被文章使用的图片不能直接删除。

运行完整检查：

```bash
npm run api:check
```

## 首次创建 Cloudflare 资源

以下操作会创建远程资源，执行前先确认 Wrangler 已登录：

```bash
npx wrangler whoami
cd apps/api
npx wrangler d1 create yimengweixing-blog
npx wrangler kv namespace create CACHE
```

创建 D1 和 KV 后，把命令返回的 ID 写入 `wrangler.jsonc`。

然后执行远程迁移与部署：

```bash
npm run db:migrate:remote
npm run deploy
```

生产环境使用 `ENVIRONMENT=production`，并按最终域名收紧 `CORS_ORIGINS`。本地开发
命令会覆盖为 `development`。公开 API 保持只读；新增文章通过受认证的管理接口写入
D1，不能再把 Markdown 放回 Astro 前端。
