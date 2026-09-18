import type { Context, Next } from "hono";
import type { AppEnv } from "./bindings";
import { fail, ok } from "./http";

interface PostInput {
  slug?: unknown;
  title?: unknown;
  description?: unknown;
  content?: unknown;
  tags?: unknown;
  featured?: unknown;
  publishedAt?: unknown;
  updatedAt?: unknown;
}

interface ValidPost {
  slug: string;
  title: string;
  description: string;
  content: string;
  tags: Array<{ name: string; slug: string }>;
  featured: number;
  publishedAt: string;
  updatedAt: string;
}

const encoder = new TextEncoder();

async function secureEqual(actual: string, expected: string) {
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index]! ^ b[index]!;
  return difference === 0;
}

export async function requireAdmin(c: Context<AppEnv>, next: Next) {
  const expected = c.env.BLOG_ADMIN_TOKEN;
  if (!expected) return fail(c, 503, "ADMIN_NOT_CONFIGURED", "管理接口尚未配置");
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !(await secureEqual(token, expected))) {
    return fail(c, 401, "UNAUTHORIZED", "管理凭据无效");
  }
  await next();
}

function tagSlug(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/gu, "-")
    .replace(/[/?#%]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");
}

function parseDate(value: unknown, fallback?: string) {
  if (typeof value !== "string" || !value.trim()) return fallback ?? null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function validatePost(input: PostInput, routeSlug?: string): ValidPost | string {
  const slug = (routeSlug ?? (typeof input.slug === "string" ? input.slug : ""))
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("zh-CN");
  if (!slug || slug.length > 100 || !/^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u.test(slug)) {
    return "slug 只能包含文字、数字和连字符，长度不超过 100";
  }
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const content = typeof input.content === "string" ? input.content.trim() : "";
  if (!title || title.length > 200) return "标题不能为空且不能超过 200 个字符";
  if (!description || description.length > 500) return "描述不能为空且不能超过 500 个字符";
  if (!content || encoder.encode(content).byteLength > 1_500_000) return "正文不能为空且不能超过 1.5 MB";
  if (!Array.isArray(input.tags)) return "tags 必须是数组";
  const names = [...new Set(input.tags.map((tag) => (typeof tag === "string" ? tag.trim() : "")))].filter(Boolean);
  if (names.length < 1 || names.length > 8 || names.some((tag) => tag.length > 50)) {
    return "请提供 1 到 8 个不超过 50 字符的标签";
  }
  const tags = names.map((name) => ({ name, slug: tagSlug(name) }));
  if (tags.some((tag) => !tag.slug)) return "标签无法生成有效 slug";
  const publishedAt = parseDate(input.publishedAt);
  if (!publishedAt) return "publishedAt 必须是有效日期";
  const updatedAt = parseDate(input.updatedAt, publishedAt);
  if (!updatedAt) return "updatedAt 必须是有效日期";
  return { slug, title, description, content, tags, featured: input.featured === true ? 1 : 0, publishedAt, updatedAt };
}

async function readJson(c: Context<AppEnv>) {
  try {
    return (await c.req.json()) as PostInput;
  } catch {
    return null;
  }
}

async function invalidateContent(c: Context<AppEnv>) {
  await c.env.CACHE.put("content:version", crypto.randomUUID());
}

async function savePost(c: Context<AppEnv>, updating: boolean) {
  const input = await readJson(c);
  if (!input) return fail(c, 400, "INVALID_JSON", "请求体必须是 JSON");
  const parsed = validatePost(input, updating ? c.req.param("slug") : undefined);
  if (typeof parsed === "string") return fail(c, 422, "INVALID_POST", parsed);
  const existing = await c.env.DB.prepare("SELECT id FROM posts WHERE slug = ?").bind(parsed.slug).first<{ id: number }>();
  if (!updating && existing) return fail(c, 409, "POST_EXISTS", "该 slug 已存在");
  if (updating && !existing) return fail(c, 404, "POST_NOT_FOUND", "要更新的文章不存在");

  const statements: D1PreparedStatement[] = [];
  if (updating) {
    statements.push(c.env.DB.prepare(`UPDATE posts SET title=?, description=?, content=?, status='published', featured=?, published_at=?, updated_at=? WHERE slug=?`).bind(parsed.title, parsed.description, parsed.content, parsed.featured, parsed.publishedAt, parsed.updatedAt, parsed.slug));
  } else {
    statements.push(c.env.DB.prepare(`INSERT INTO posts (slug,title,description,content,status,featured,published_at,created_at,updated_at) VALUES (?,?,?,?,'published',?,?,?,?)`).bind(parsed.slug, parsed.title, parsed.description, parsed.content, parsed.featured, parsed.publishedAt, parsed.publishedAt, parsed.updatedAt));
  }
  for (const tag of parsed.tags) {
    statements.push(c.env.DB.prepare("INSERT INTO tags (name,slug) VALUES (?,?) ON CONFLICT(slug) DO UPDATE SET name=excluded.name").bind(tag.name, tag.slug));
  }
  statements.push(c.env.DB.prepare("DELETE FROM post_tags WHERE post_id=(SELECT id FROM posts WHERE slug=?)").bind(parsed.slug));
  for (const tag of parsed.tags) {
    statements.push(c.env.DB.prepare("INSERT INTO post_tags (post_id,tag_id) SELECT p.id,t.id FROM posts p,tags t WHERE p.slug=? AND t.slug=?").bind(parsed.slug, tag.slug));
  }
  statements.push(
    c.env.DB.prepare("DELETE FROM posts_fts WHERE rowid=(SELECT id FROM posts WHERE slug=?)").bind(parsed.slug),
    c.env.DB.prepare("INSERT INTO posts_fts (rowid,title,description,content,tags) SELECT id,?,?,?,? FROM posts WHERE slug=?").bind(parsed.title, parsed.description, parsed.content, parsed.tags.map((tag) => tag.name).join(" "), parsed.slug),
    c.env.DB.prepare("DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM post_tags WHERE post_tags.tag_id=tags.id)"),
  );
  await c.env.DB.batch(statements);
  await invalidateContent(c);
  return ok(c, { slug: parsed.slug, url: `${c.env.SITE_URL}/blog/${encodeURIComponent(parsed.slug)}/` }, updating ? 200 : 201);
}

export function createPost(c: Context<AppEnv>) { return savePost(c, false); }
export function updatePost(c: Context<AppEnv>) { return savePost(c, true); }

export async function deletePost(c: Context<AppEnv>) {
  const slug = c.req.param("slug");
  const existing = await c.env.DB.prepare("SELECT id FROM posts WHERE slug=?").bind(slug).first<{ id: number }>();
  if (!existing) return fail(c, 404, "POST_NOT_FOUND", "文章不存在");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM posts_fts WHERE rowid=?").bind(existing.id),
    c.env.DB.prepare("DELETE FROM posts WHERE id=?").bind(existing.id),
    c.env.DB.prepare("DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM post_tags WHERE post_tags.tag_id=tags.id)"),
  ]);
  await invalidateContent(c);
  return ok(c, { slug, deleted: true });
}
