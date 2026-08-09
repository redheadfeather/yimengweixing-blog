# Blog repository contract

- GitHub: `https://github.com/redheadfeather/yimengweixing-blog`
- Local default: `D:\vibe-coding-proj\my-website`
- Article directory: `src/content/blog`
- Production site: `https://yimengweixing.pages.dev`
- Deployment: a push to `main` triggers `.github/workflows/deploy-pages.yml`, builds Astro, and deploys `dist` to Cloudflare Pages.

Required frontmatter:

```yaml
---
title: "文章标题"
description: "一句具体、可独立理解的内容摘要。"
pubDate: "YYYY-MM-DD"
tags: ["Tag 1", "Tag 2"]
featured: false
---
```

Optional update field:

```yaml
updatedDate: "YYYY-MM-DD"
```

The content collection accepts `.md` and `.mdx`. Prefer `.md` for imported technical documents. Blog routes use the content filename as the article ID. Tag index and category routes are generated automatically from `tags`.

Before choosing tags, inspect existing values with:

```powershell
rg -n "^tags:" src/content/blog
```
