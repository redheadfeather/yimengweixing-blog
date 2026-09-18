# 一梦未醒写作工作台

私有在线文章编辑器。它由独立 Cloudflare Worker 托管，使用密码换取短期、HttpOnly 的签名会话，并通过 Cloudflare Service Binding 在服务端调用博客管理 API。`BLOG_ADMIN_TOKEN`、`STUDIO_PASSWORD` 和 `SESSION_SIGNING_KEY` 只存在于 Worker Secret，不会发送到浏览器。

## 功能

- 列出并筛选 D1 中已发布、已归档文章
- 新建和编辑 Markdown，安全实时预览
- 上传 PNG、JPEG、WebP、GIF 图片并插入正文
- 发布、重新发布、归档和删除文章
- 离开页面前提示未发布修改，支持 `Ctrl/Cmd + S`

## 本地开发

运行前向本地 Wrangler 提供 `BLOG_ADMIN_TOKEN`、`STUDIO_PASSWORD` 和 `SESSION_SIGNING_KEY`，然后执行：

```powershell
npm run studio:dev
```

## 生产认证

1. 部署 `yimengweixing-studio` Worker。
2. 将 `BLOG_ADMIN_TOKEN`、`STUDIO_PASSWORD` 和随机生成的 `SESSION_SIGNING_KEY` 配置为该 Worker 的 Secret。
3. 浏览器提交密码后，Worker 签发 12 小时有效的 `HttpOnly; Secure; SameSite=Strict` Cookie。
4. 连续失败 5 次后，同一来源将被锁定 10 分钟；状态保存在 KV 中。

文章管理接口还要求同源请求和自定义请求头，以降低 CSRF 风险。静态登录壳可以公开访问，但没有有效会话时管理代理始终返回 401。
