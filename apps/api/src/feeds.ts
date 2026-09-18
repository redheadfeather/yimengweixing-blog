import type { Context } from "hono";
import type { AppEnv } from "./bindings";

interface FeedRow {
  slug: string;
  title: string;
  description: string;
  published_at: string;
  updated_at: string;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function getPosts(c: Context<AppEnv>) {
  const { results } = await c.env.DB.prepare(
    `SELECT slug, title, description, published_at, updated_at
    FROM posts
    WHERE status = 'published'
    ORDER BY published_at DESC, id DESC`,
  ).all<FeedRow>();
  return results;
}

export async function rssFeed(c: Context<AppEnv>) {
  const posts = await getPosts(c);
  const siteUrl = c.env.SITE_URL.replace(/\/$/u, "");
  const items = posts
    .map((post) => {
      const link = `${siteUrl}/blog/${encodeURIComponent(post.slug)}/`;
      return `<item><title>${escapeXml(post.title)}</title><link>${link}</link><guid>${link}</guid><description>${escapeXml(post.description)}</description><pubDate>${new Date(post.published_at).toUTCString()}</pubDate></item>`;
    })
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>一梦未醒</title><link>${siteUrl}</link><description>AI时代下的蚂蚁。关于技术、生活与持续学习的个人笔记。</description>${items}</channel></rss>`;
  return c.body(xml, 200, {
    "Content-Type": "application/rss+xml; charset=utf-8",
    "Cache-Control": "public, max-age=300, s-maxage=900",
  });
}

export async function sitemap(c: Context<AppEnv>) {
  const posts = await getPosts(c);
  const siteUrl = c.env.SITE_URL.replace(/\/$/u, "");
  const staticUrls = ["", "/about/", "/blog/", "/tags/"];
  const urls = [
    ...staticUrls.map((path) => ({ loc: `${siteUrl}${path}`, lastmod: null })),
    ...posts.map((post) => ({
      loc: `${siteUrl}/blog/${encodeURIComponent(post.slug)}/`,
      lastmod: post.updated_at || post.published_at,
    })),
  ];
  const body = urls
    .map(({ loc, lastmod }) => `<url><loc>${escapeXml(loc)}</loc>${lastmod ? `<lastmod>${escapeXml(lastmod.slice(0, 10))}</lastmod>` : ""}</url>`)
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;
  return c.body(xml, 200, {
    "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": "public, max-age=300, s-maxage=900",
  });
}
