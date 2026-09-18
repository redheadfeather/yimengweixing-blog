import type { Context, Next } from 'hono';
import { assetIdsFromMarkdown, assertAssetsExist, cleanupAssetStatements } from './asset-references';
import type { AppEnv } from './bindings';
import { fail, ok, parseLimit } from './http';

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

interface AdminPostRow {
  id: number;
  slug: string;
  title: string;
  description: string;
  status: string;
  featured: number;
  published_at: string;
  updated_at: string;
  tags: string | null;
}

interface AdminPostDetailRow extends AdminPostRow {
  content: string;
}

const encoder = new TextEncoder();
const TAG_SEPARATOR = '\u001f';

async function secureEqual(actual: string, expected: string) {
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(actual)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index]! ^ b[index]!;
  return difference === 0;
}

export async function requireAdmin(c: Context<AppEnv>, next: Next) {
  const expected = c.env.BLOG_ADMIN_TOKEN;
  if (!expected) return fail(c, 503, 'ADMIN_NOT_CONFIGURED', '管理接口尚未配置');
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !(await secureEqual(token, expected))) {
    return fail(c, 401, 'UNAUTHORIZED', '管理凭据无效');
  }
  await next();
}

function tagSlug(value: string) {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('zh-CN')
    .replace(/\s+/gu, '-')
    .replace(/[/?#%]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '');
}

function parseDate(value: unknown, fallback?: string) {
  if (typeof value !== 'string' || !value.trim()) return fallback ?? null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function validatePost(input: PostInput, routeSlug?: string): ValidPost | string {
  const slug = (routeSlug ?? (typeof input.slug === 'string' ? input.slug : ''))
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('zh-CN');
  if (!slug || slug.length > 100 || !/^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u.test(slug)) {
    return 'slug 只能包含文字、数字和连字符，长度不超过 100';
  }
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const content = typeof input.content === 'string' ? input.content.trim() : '';
  if (!title || title.length > 200) return '标题不能为空且不能超过 200 个字符';
  if (!description || description.length > 500) return '描述不能为空且不能超过 500 个字符';
  if (!content || encoder.encode(content).byteLength > 1_500_000) return '正文不能为空且不能超过 1.5 MB';
  if (!Array.isArray(input.tags)) return 'tags 必须是数组';
  const names = [...new Set(input.tags.map((tag) => (typeof tag === 'string' ? tag.trim() : ''))) ]
    .filter(Boolean);
  if (names.length < 1 || names.length > 8 || names.some((tag) => tag.length > 50)) {
    return '请提供 1 到 8 个不超过 50 字符的标签';
  }
  const tags = names.map((name) => ({ name, slug: tagSlug(name) }));
  if (tags.some((tag) => !tag.slug)) return '标签无法生成有效 slug';
  const publishedAt = parseDate(input.publishedAt);
  if (!publishedAt) return 'publishedAt 必须是有效日期';
  const updatedAt = parseDate(input.updatedAt, publishedAt);
  if (!updatedAt) return 'updatedAt 必须是有效日期';
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
  await c.env.CACHE.put('content:version', crypto.randomUUID());
}

function revisionStatement(db: D1Database, slug: string, reason: 'update' | 'archive' | 'delete') {
  return db.prepare(
    `INSERT INTO post_revisions (post_id,slug,title,description,content,tags,status,featured,published_at,updated_at,reason)
     SELECT p.id,p.slug,p.title,p.description,p.content,
       COALESCE((SELECT GROUP_CONCAT(t.name, '${TAG_SEPARATOR}') FROM post_tags pt JOIN tags t ON t.id=pt.tag_id WHERE pt.post_id=p.id), ''),
       p.status,p.featured,p.published_at,p.updated_at,?
     FROM posts p WHERE p.slug=?`,
  ).bind(reason, slug);
}

async function currentAssetIds(db: D1Database, postId: number) {
  const { results } = await db.prepare('SELECT asset_id FROM post_assets WHERE post_id=?').bind(postId).all<{ asset_id: string }>();
  return results.map((row) => row.asset_id);
}

async function savePost(c: Context<AppEnv>, updating: boolean) {
  const input = await readJson(c);
  if (!input) return fail(c, 400, 'INVALID_JSON', '请求体必须是 JSON');
  const parsed = validatePost(input, updating ? c.req.param('slug') : undefined);
  if (typeof parsed === 'string') return fail(c, 422, 'INVALID_POST', parsed);
  const existing = await c.env.DB.prepare('SELECT id FROM posts WHERE slug=?').bind(parsed.slug).first<{ id: number }>();
  if (!updating && existing) return fail(c, 409, 'POST_EXISTS', '该 slug 已存在');
  if (updating && !existing) return fail(c, 404, 'POST_NOT_FOUND', '要更新的文章不存在');

  const assetIds = assetIdsFromMarkdown(parsed.content);
  if (assetIds.length > 100) return fail(c, 422, 'TOO_MANY_ASSETS', '单篇文章最多引用 100 张托管图片');
  const missingAssets = await assertAssetsExist(c.env.DB, assetIds);
  if (missingAssets.length) return fail(c, 422, 'ASSET_NOT_FOUND', `正文引用了不存在的图片：${missingAssets[0]}`);
  const previousAssetIds = existing ? await currentAssetIds(c.env.DB, existing.id) : [];
  const statements: D1PreparedStatement[] = [];
  if (updating) {
    statements.push(
      revisionStatement(c.env.DB, parsed.slug, 'update'),
      c.env.DB.prepare("UPDATE posts SET title=?,description=?,content=?,status='published',featured=?,published_at=?,updated_at=? WHERE slug=?")
        .bind(parsed.title, parsed.description, parsed.content, parsed.featured, parsed.publishedAt, parsed.updatedAt, parsed.slug),
    );
  } else {
    statements.push(c.env.DB.prepare("INSERT INTO posts (slug,title,description,content,status,featured,published_at,created_at,updated_at) VALUES (?,?,?,?,'published',?,?,?,?)")
      .bind(parsed.slug, parsed.title, parsed.description, parsed.content, parsed.featured, parsed.publishedAt, parsed.publishedAt, parsed.updatedAt));
  }
  for (const tag of parsed.tags) {
    statements.push(c.env.DB.prepare('INSERT INTO tags (name,slug) VALUES (?,?) ON CONFLICT(slug) DO UPDATE SET name=excluded.name').bind(tag.name, tag.slug));
  }
  statements.push(c.env.DB.prepare('DELETE FROM post_tags WHERE post_id=(SELECT id FROM posts WHERE slug=?)').bind(parsed.slug));
  for (const tag of parsed.tags) {
    statements.push(c.env.DB.prepare('INSERT INTO post_tags (post_id,tag_id) SELECT p.id,t.id FROM posts p,tags t WHERE p.slug=? AND t.slug=?').bind(parsed.slug, tag.slug));
  }
  statements.push(c.env.DB.prepare('DELETE FROM post_assets WHERE post_id=(SELECT id FROM posts WHERE slug=?)').bind(parsed.slug));
  for (const assetId of assetIds) {
    statements.push(c.env.DB.prepare('INSERT INTO post_assets (post_id,asset_id) SELECT id,? FROM posts WHERE slug=?').bind(assetId, parsed.slug));
  }
  statements.push(
    c.env.DB.prepare('DELETE FROM posts_fts WHERE rowid=(SELECT id FROM posts WHERE slug=?)').bind(parsed.slug),
    c.env.DB.prepare('INSERT INTO posts_fts (rowid,title,description,content,tags) SELECT id,?,?,?,? FROM posts WHERE slug=?')
      .bind(parsed.title, parsed.description, parsed.content, parsed.tags.map((tag) => tag.name).join(' '), parsed.slug),
    c.env.DB.prepare('DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM post_tags WHERE post_tags.tag_id=tags.id)'),
    ...cleanupAssetStatements(c.env.DB, previousAssetIds),
  );
  await c.env.DB.batch(statements);
  await invalidateContent(c);
  return ok(c, { slug: parsed.slug, url: `${c.env.SITE_URL}/blog/${encodeURIComponent(parsed.slug)}/`, assets: assetIds }, updating ? 200 : 201);
}

export function createPost(c: Context<AppEnv>) { return savePost(c, false); }
export function updatePost(c: Context<AppEnv>) { return savePost(c, true); }

export async function listAdminPosts(c: Context<AppEnv>) {
  const status = (c.req.query('status') ?? 'all').trim();
  if (!['all', 'published', 'archived'].includes(status)) return fail(c, 422, 'INVALID_STATUS', 'status 仅支持 all、published 或 archived');
  const limit = parseLimit(c.req.query('limit'));
  const clause = status === 'all' ? '' : 'WHERE p.status=?';
  const statement = c.env.DB.prepare(
    `SELECT p.id,p.slug,p.title,p.description,p.status,p.featured,p.published_at,p.updated_at,
      (SELECT GROUP_CONCAT(t.name, '${TAG_SEPARATOR}') FROM post_tags pt JOIN tags t ON t.id=pt.tag_id WHERE pt.post_id=p.id) AS tags
     FROM posts p ${clause} ORDER BY p.updated_at DESC,p.id DESC LIMIT ?`,
  );
  const { results } = status === 'all'
    ? await statement.bind(limit).all<AdminPostRow>()
    : await statement.bind(status, limit).all<AdminPostRow>();
  return ok(c, results.map((row) => ({
    slug: row.slug,
    title: row.title,
    description: row.description,
    status: row.status,
    featured: row.featured === 1,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    tags: row.tags ? row.tags.split(TAG_SEPARATOR).filter(Boolean) : [],
  })));
}

export async function getAdminPost(c: Context<AppEnv>) {
  const slug = c.req.param('slug') ?? '';
  const row = await c.env.DB.prepare(
    `SELECT p.id,p.slug,p.title,p.description,p.content,p.status,p.featured,p.published_at,p.updated_at,
      (SELECT GROUP_CONCAT(t.name, '${TAG_SEPARATOR}') FROM post_tags pt JOIN tags t ON t.id=pt.tag_id WHERE pt.post_id=p.id) AS tags
     FROM posts p WHERE p.slug=?`,
  ).bind(slug).first<AdminPostDetailRow>();
  if (!row) return fail(c, 404, 'POST_NOT_FOUND', '文章不存在');
  return ok(c, {
    slug: row.slug,
    title: row.title,
    description: row.description,
    content: row.content,
    status: row.status,
    featured: row.featured === 1,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    tags: row.tags ? row.tags.split(TAG_SEPARATOR).filter(Boolean) : [],
  });
}

export async function listPostRevisions(c: Context<AppEnv>) {
  const slug = c.req.param('slug') ?? '';
  const { results } = await c.env.DB.prepare(
    'SELECT id,slug,title,description,content,tags,status,featured,published_at,updated_at,reason,saved_at FROM post_revisions WHERE slug=? ORDER BY saved_at DESC,id DESC LIMIT 20',
  ).bind(slug).all<{
    id: number; slug: string; title: string; description: string; content: string; tags: string;
    status: string; featured: number; published_at: string; updated_at: string; reason: string; saved_at: string;
  }>();
  return ok(c, results.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    content: row.content,
    tags: row.tags ? row.tags.split(TAG_SEPARATOR).filter(Boolean) : [],
    status: row.status,
    featured: row.featured === 1,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    reason: row.reason,
    savedAt: row.saved_at,
  })));
}

export async function archivePost(c: Context<AppEnv>) {
  const slug = c.req.param('slug') ?? '';
  const existing = await c.env.DB.prepare('SELECT id,status FROM posts WHERE slug=?').bind(slug).first<{ id: number; status: string }>();
  if (!existing) return fail(c, 404, 'POST_NOT_FOUND', '文章不存在');
  if (existing.status === 'archived') return ok(c, { slug, status: 'archived' });
  await c.env.DB.batch([
    revisionStatement(c.env.DB, slug, 'archive'),
    c.env.DB.prepare("UPDATE posts SET status='archived',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(existing.id),
    c.env.DB.prepare('DELETE FROM posts_fts WHERE rowid=?').bind(existing.id),
  ]);
  await invalidateContent(c);
  return ok(c, { slug, status: 'archived' });
}

export async function deletePost(c: Context<AppEnv>) {
  const slug = c.req.param('slug') ?? '';
  const existing = await c.env.DB.prepare('SELECT id FROM posts WHERE slug=?').bind(slug).first<{ id: number }>();
  if (!existing) return fail(c, 404, 'POST_NOT_FOUND', '文章不存在');
  const assetIds = await currentAssetIds(c.env.DB, existing.id);
  await c.env.DB.batch([
    revisionStatement(c.env.DB, slug, 'delete'),
    c.env.DB.prepare('DELETE FROM posts_fts WHERE rowid=?').bind(existing.id),
    c.env.DB.prepare('DELETE FROM post_assets WHERE post_id=?').bind(existing.id),
    c.env.DB.prepare('DELETE FROM post_tags WHERE post_id=?').bind(existing.id),
    c.env.DB.prepare('DELETE FROM posts WHERE id=?').bind(existing.id),
    ...cleanupAssetStatements(c.env.DB, assetIds),
    c.env.DB.prepare('DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM post_tags WHERE post_tags.tag_id=tags.id)'),
  ]);
  await invalidateContent(c);
  return ok(c, { slug, deleted: true, assetsChecked: assetIds.length });
}
