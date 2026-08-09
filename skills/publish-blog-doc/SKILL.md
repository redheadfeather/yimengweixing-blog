---
name: publish-blog-doc
description: Publish a Markdown technical document from any project to the redheadfeather/yimengweixing-blog repository and personal blog. Use when the user asks to upload, publish, sync, or post a technical note or document to their blog, including requests to automatically infer title, description, date, and tags, commit the article to GitHub, and trigger the Cloudflare Pages deployment.
---

# Publish Blog Doc

Turn a local Markdown technical document into a validated blog post and publish it through the existing GitHub Actions workflow.

## Workflow

1. Resolve the source document.
   - Use the path named by the user.
   - If no path is named, inspect Markdown files changed or created in the current project and choose only when the intended document is unambiguous.
   - Read the complete document before generating metadata.

2. Locate the blog repository.
   - Prefer `YIMENG_BLOG_REPO` when set.
   - Otherwise use `D:\vibe-coding-proj\my-website`.
   - Read [references/blog-repository.md](references/blog-repository.md) if the repository schema, paths, or publishing behavior is needed.

3. Generate metadata from the document.
   - Derive a faithful title from the first H1 or central topic.
   - Write a concrete one-sentence description, normally 35–90 Chinese characters. Avoid promotional phrasing.
   - Choose 2–5 concise tags. Reuse existing tag spelling and capitalization when the same concept already exists.
   - Use the user's current local date as `pubDate` for a new article.
   - Preserve the original `pubDate` and add today's `updatedDate` only when explicitly updating an existing post.
   - Set `featured` to `false` unless the user explicitly requests otherwise.

4. Check public-publishing safety.
   - Inspect the document for credentials, API keys, passwords, cookies, private URLs, personal filesystem paths, customer data, and other secrets.
   - Stop and explain the exact risky lines when sensitive content may be exposed. Never silently publish or redact ambiguous technical values.

5. Prepare the post with the bundled script.

   ```powershell
   python <skill-dir>\scripts\prepare_post.py `
     --source <document.md> `
     --repo <blog-repository> `
     --title <title> `
     --description <description> `
     --tags <tag1> <tag2> `
     --date <YYYY-MM-DD>
   ```

   - Let the script generate the filename unless a stable slug is important; then pass `--slug`.
   - The script removes a leading Markdown H1 when it matches the generated title, because the blog layout already renders that title.
   - The script refuses to overwrite an existing article. Use `--force` only when the user explicitly asks to update that article and the diff has been reviewed.
   - Use `--dry-run` when metadata or the destination is uncertain.

6. Validate before publishing.
   - Inspect the generated frontmatter and article diff.
   - Run `npm.cmd run build` from the blog repository on Windows, or `npm run build` elsewhere.
   - Do not publish if the Astro content schema or production build fails.
   - Preserve unrelated user changes and stage only the generated or updated article.

7. Publish through GitHub.
   - Commit with `Publish: <article title>` unless the user supplies a message.
   - Push the current default branch to `origin` only after validation succeeds.
   - Follow the environment's approval rules for network or Git operations.
   - Confirm the matching GitHub Actions run succeeds, then verify the article URL on `https://yimengweixing.pages.dev`.

8. Report the result.
   - Provide the article title, tags, repository file, commit hash, deployment status, and live URL.
   - If publishing stops, identify the failed stage and leave the prepared file uncommitted for review.

## Invocation examples

- “使用 publish-blog-doc 把 `docs/observability.md` 发布到我的博客。”
- “把我刚写的技术总结一键上传到博客，标签和简介你来生成。”
- “更新博客里的 Spring Boot 监控文章并重新发布。”
