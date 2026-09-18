# 一梦未醒写作工作台

私有在线文章编辑器。它由独立 Cloudflare Worker 托管，通过 Cloudflare Access 验证作者身份，并在服务端代理博客管理 API。`BLOG_ADMIN_TOKEN` 只存在于 Worker Secret，不会发送到浏览器。

## 功能

- 列出并筛选 D1 中已发布、已归档文章
- 新建和编辑 Markdown，安全实时预览
- 上传 PNG、JPEG、WebP、GIF 图片并插入正文
- 发布、重新发布、归档和删除文章
- 离开页面前提示未发布修改，支持 `Ctrl/Cmd + S`

## 本地开发

`wrangler.jsonc` 的 `access.dev` 会模拟已通过 Access 的作者。运行前向本地 Wrangler 提供 `BLOG_ADMIN_TOKEN`，然后执行：

```powershell
npm run studio:dev
```

## 生产保护

1. 部署 `yimengweixing-studio` Worker。
2. 将 `BLOG_ADMIN_TOKEN` 配置为该 Worker 的 Secret。
3. 在 Workers & Pages 的 Access 页面，为整个 Worker 启用生产环境保护。
4. 仅允许 `STUDIO_ALLOWED_EMAIL` 对应的邮箱登录。

Worker 自身仍会检查 `ctx.access` 和登录邮箱；Access 未运行时所有页面与代理接口都会返回 401。
