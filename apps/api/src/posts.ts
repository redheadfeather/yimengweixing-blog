import type {
  ApiSuccess,
  PostDetail,
  PostListData,
  PostSummary,
  TagSummary,
} from "@yimengweixing/shared";
import type { Context } from "hono";
import type { AppEnv } from "./bindings";
import { decodeCursor, encodeCursor, fail, ok, parseLimit } from "./http";

interface PostRow {
  id: number;
  slug: string;
  title: string;
  description: string;
  content?: string;
  featured: number;
  published_at: string;
  updated_at: string;
  tags: string | null;
  total_count?: number;
}

interface TagRow {
  name: string;
  slug: string;
  count: number;
}

const TAG_SEPARATOR = "\u001f";
const CACHE_TTL_SECONDS = 300;

function mapSummary(row: PostRow): PostSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    tags: row.tags ? row.tags.split(TAG_SEPARATOR).filter(Boolean) : [],
    featured: row.featured === 1,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
  };
}

function setCacheHeaders(c: Context<AppEnv>) {
  c.header("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=60");
}

function toFtsQuery(query: string): string {
  return query
    .split(/\s+/u)
    .filter(Boolean)
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(" AND ");
}

function buildFilters(query: string, tag: string, featuredOnly: boolean) {
  const clauses = ["p.status = 'published'"];
  const bindings: unknown[] = [];

  if (query) {
    if (Array.from(query).length >= 3) {
      clauses.push("p.id IN (SELECT rowid FROM posts_fts WHERE posts_fts MATCH ?)");
      bindings.push(toFtsQuery(query));
    } else {
      const pattern = `%${query}%`;
      clauses.push(`(
        p.title LIKE ? OR p.description LIKE ? OR p.content LIKE ? OR
        EXISTS (
          SELECT 1 FROM post_tags AS search_pt
          JOIN tags AS search_t ON search_t.id = search_pt.tag_id
          WHERE search_pt.post_id = p.id AND search_t.name LIKE ?
        )
      )`);
      bindings.push(pattern, pattern, pattern, pattern);
    }
  }

  if (tag) {
    clauses.push(`EXISTS (
      SELECT 1 FROM post_tags AS filter_pt
      JOIN tags AS filter_t ON filter_t.id = filter_pt.tag_id
      WHERE filter_pt.post_id = p.id AND filter_t.slug = ?
    )`);
    bindings.push(tag);
  }

  if (featuredOnly) clauses.push("p.featured = 1");

  return { sql: clauses.join(" AND "), bindings };
}

const summaryColumns = `
  p.id,
  p.slug,
  p.title,
  p.description,
  p.featured,
  p.published_at,
  p.updated_at,
  (
    SELECT GROUP_CONCAT(tag_list.name, '${TAG_SEPARATOR}')
    FROM post_tags AS tag_link
    JOIN tags AS tag_list ON tag_list.id = tag_link.tag_id
    WHERE tag_link.post_id = p.id
  ) AS tags`;

export async function listPosts(c: Context<AppEnv>) {
  const limit = parseLimit(c.req.query("limit"));
  const offset = decodeCursor(c.req.query("cursor"));
  const query = (c.req.query("q") ?? "").trim().slice(0, 100);
  const tag = (c.req.query("tag") ?? "").trim().slice(0, 100);
  const featuredOnly = c.req.query("featured") === "true";
  const cacheKey = `v2:posts:list:${limit}:${offset}:${encodeURIComponent(query)}:${encodeURIComponent(tag)}:${featuredOnly}`;
  const cached = await c.env.CACHE.get<ApiSuccess<PostListData>>(cacheKey, "json");

  if (cached) {
    setCacheHeaders(c);
    c.header("X-Cache", "HIT");
    return c.json({ ...cached, meta: { requestId: c.get("requestId") } });
  }

  const filters = buildFilters(query, tag, featuredOnly);
  const { results } = await c.env.DB.prepare(
    `SELECT ${summaryColumns}, COUNT(*) OVER() AS total_count
    FROM posts AS p
    WHERE ${filters.sql}
    ORDER BY p.published_at DESC, p.id DESC
    LIMIT ? OFFSET ?`,
  )
    .bind(...filters.bindings, limit + 1, offset)
    .all<PostRow>();

  const hasMore = results.length > limit;
  const items = results.slice(0, limit).map(mapSummary);
  const data: PostListData = {
    items,
    nextCursor: hasMore ? encodeCursor(offset + limit) : null,
    total: Number(results[0]?.total_count ?? 0),
  };
  const cachedBody: ApiSuccess<PostListData> = {
    data,
    meta: { requestId: c.get("requestId") },
  };

  c.executionCtx.waitUntil(
    c.env.CACHE.put(cacheKey, JSON.stringify(cachedBody), {
      expirationTtl: CACHE_TTL_SECONDS,
    }),
  );
  setCacheHeaders(c);
  c.header("X-Cache", "MISS");
  return ok(c, data);
}

export async function getPost(c: Context<AppEnv>) {
  const slug = c.req.param("slug");
  const cacheKey = `v2:posts:detail:${slug}`;
  const cached = await c.env.CACHE.get<ApiSuccess<PostDetail>>(cacheKey, "json");

  if (cached) {
    setCacheHeaders(c);
    c.header("X-Cache", "HIT");
    return c.json({ ...cached, meta: { requestId: c.get("requestId") } });
  }

  const row = await c.env.DB.prepare(
    `SELECT ${summaryColumns}, p.content
    FROM posts AS p
    WHERE p.status = 'published' AND p.slug = ?
    LIMIT 1`,
  )
    .bind(slug)
    .first<PostRow>();

  if (!row || row.content === undefined) {
    return fail(c, 404, "POST_NOT_FOUND", "文章不存在或尚未发布");
  }

  const { results: relatedRows } = await c.env.DB.prepare(
    `SELECT ${summaryColumns}, COUNT(shared_pt.tag_id) AS shared_tags
    FROM posts AS p
    JOIN post_tags AS shared_pt ON shared_pt.post_id = p.id
    WHERE
      p.status = 'published'
      AND p.id != ?
      AND shared_pt.tag_id IN (SELECT tag_id FROM post_tags WHERE post_id = ?)
    GROUP BY p.id
    ORDER BY shared_tags DESC, p.published_at DESC
    LIMIT 3`,
  )
    .bind(row.id, row.id)
    .all<PostRow>();

  const data: PostDetail = {
    ...mapSummary(row),
    content: row.content,
    relatedPosts: relatedRows.map(mapSummary),
  };
  const cachedBody: ApiSuccess<PostDetail> = {
    data,
    meta: { requestId: c.get("requestId") },
  };

  c.executionCtx.waitUntil(
    c.env.CACHE.put(cacheKey, JSON.stringify(cachedBody), {
      expirationTtl: CACHE_TTL_SECONDS,
    }),
  );
  setCacheHeaders(c);
  c.header("X-Cache", "MISS");
  return ok(c, data);
}

export async function listTags(c: Context<AppEnv>) {
  const cacheKey = "v2:tags:list";
  const cached = await c.env.CACHE.get<ApiSuccess<TagSummary[]>>(cacheKey, "json");

  if (cached) {
    setCacheHeaders(c);
    c.header("X-Cache", "HIT");
    return c.json({ ...cached, meta: { requestId: c.get("requestId") } });
  }

  const { results } = await c.env.DB.prepare(
    `SELECT t.name, t.slug, COUNT(*) AS count
    FROM tags AS t
    JOIN post_tags AS pt ON pt.tag_id = t.id
    JOIN posts AS p ON p.id = pt.post_id AND p.status = 'published'
    GROUP BY t.id
    ORDER BY count DESC, t.name ASC`,
  ).all<TagRow>();
  const data = results.map((row) => ({ ...row, count: Number(row.count) }));
  const cachedBody: ApiSuccess<TagSummary[]> = {
    data,
    meta: { requestId: c.get("requestId") },
  };

  c.executionCtx.waitUntil(
    c.env.CACHE.put(cacheKey, JSON.stringify(cachedBody), {
      expirationTtl: CACHE_TTL_SECONDS,
    }),
  );
  setCacheHeaders(c);
  c.header("X-Cache", "MISS");
  return ok(c, data);
}
