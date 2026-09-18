# 一梦未醒 API

这是博客的 Cloudflare Worker 内容后端。D1 是文章正文、元信息和标签的唯一真实
数据源；Astro 前端只发布 UI、交互脚本与静态素材，不再包含 Markdown 文章。

生产地址：

```text
https://yimengweixing-api.yimengweixing-api.workers.dev
```

## 组件

- Worker：HTTP API
- D1：文章和标签的关系数据
- Workers KV：只读查询缓存（最终一致，不作为真实数据源）
- `packages/shared`：前后端共享响应类型

当前远程 D1 与 KV 已创建并绑定。图片、封面和其他静态文件暂时继续保存在 Astro
项目的 `public/` 或源码资源目录中，随 Cloudflare Pages 一起构建和发布；正文只保存
图片 URL，不会把图片二进制写入 D1。

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
GET /rss.xml
GET /sitemap.xml
```

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
命令会覆盖为 `development`。当前公开 API 仍为只读；后续新增文章应通过受认证的管理
接口或受控导入任务写入 D1，不能再把 Markdown 放回 Astro 前端。
