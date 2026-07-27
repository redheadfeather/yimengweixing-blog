# 一梦未醒 · 个人博客

基于 Astro 的中文静态博客，可免费部署到 Cloudflare Pages。

## 修改个人信息

编辑 `src/consts.ts`，替换网站标题、简介和作者名字。

当前部署地址：`https://yimengweixing.pages.dev`

如果以后绑定自定义域名，请把 `astro.config.mjs` 中的 `site` 改成新域名，例如：

```js
site: 'https://your-project.pages.dev'
```

## 写一篇新文章

在 `src/content/blog/` 新建 Markdown 文件：

```md
---
title: '文章标题'
description: '一句话摘要'
pubDate: '2026-07-27'
tags: ['随笔']
---

从这里开始写正文。
```

## 本地运行

```sh
npm install
npm run dev -- --background
```

打开 `http://localhost:4321`。

## 自动发布

项目通过 GitHub Actions 自动发布到 Cloudflare Pages。向 `main` 分支提交修改后，工作流会自动安装依赖、构建网站并部署到 `yimengweixing.pages.dev`。

GitHub 仓库需要配置两个 Actions Secrets：

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

工作流文件位于 `.github/workflows/deploy-pages.yml`。

## Cloudflare Pages 设置

- 构建命令：`npm run build`
- 输出目录：`dist`
- Node.js：22 或更高版本

连接 GitHub 仓库后，每次推送都会自动更新网站。
