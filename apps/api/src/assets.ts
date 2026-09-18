import type { Context } from "hono";
import type { AppEnv } from "./bindings";
import { fail, ok } from "./http";

const MAX_ASSET_BYTES = 1_500_000;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

interface AssetRow {
  id: string;
  file_name: string;
  content_type: string;
  byte_size: number;
  data: ArrayBuffer | number[];
}

function hex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeFileName(header: string | undefined) {
  if (!header) return null;
  try {
    const decoded = decodeURIComponent(header).normalize("NFKC");
    const name = decoded.split(/[\\/]/u).pop()?.replace(/[\u0000-\u001f\u007f]/gu, "").trim();
    return name && name.length <= 180 ? name : null;
  } catch {
    return null;
  }
}

export async function uploadAsset(c: Context<AppEnv>) {
  const contentType = ((c.req.header("Content-Type") ?? "").split(";", 1)[0] ?? "").toLowerCase();
  if (!ALLOWED_TYPES.has(contentType)) return fail(c, 415, "UNSUPPORTED_ASSET", "仅支持 PNG、JPEG、WebP 和 GIF 图片");
  const statedLength = Number(c.req.header("Content-Length") ?? "0");
  if (statedLength > MAX_ASSET_BYTES) return fail(c, 413, "ASSET_TOO_LARGE", "单张图片不能超过 1.5 MB");
  const fileName = safeFileName(c.req.header("X-File-Name"));
  if (!fileName) return fail(c, 422, "INVALID_FILE_NAME", "缺少有效的 X-File-Name 请求头");
  const data = await c.req.arrayBuffer();
  if (!data.byteLength || data.byteLength > MAX_ASSET_BYTES) return fail(c, 413, "ASSET_TOO_LARGE", "图片不能为空且不能超过 1.5 MB");
  const id = hex(await crypto.subtle.digest("SHA-256", data));
  await c.env.DB.prepare("INSERT OR IGNORE INTO assets (id,file_name,content_type,byte_size,data) VALUES (?,?,?,?,?)")
    .bind(id, fileName, contentType, data.byteLength, data)
    .run();
  return ok(c, { id, fileName, contentType, byteSize: data.byteLength, url: `${new URL(c.req.url).origin}/api/v1/assets/${id}/${encodeURIComponent(fileName)}` }, 201);
}

export async function getAsset(c: Context<AppEnv>) {
  const id = c.req.param("id");
  const etag = `"${id}"`;
  if (c.req.header("If-None-Match") === etag) return c.body(null, 304);
  const row = await c.env.DB.prepare("SELECT id,file_name,content_type,byte_size,data FROM assets WHERE id=?").bind(id).first<AssetRow>();
  if (!row) return fail(c, 404, "ASSET_NOT_FOUND", "图片不存在");
  const body = row.data instanceof ArrayBuffer ? row.data : Uint8Array.from(row.data).buffer;
  return new Response(body, { headers: { "Content-Type": row.content_type, "Content-Length": String(row.byte_size), "Cache-Control": "public, max-age=31536000, immutable", ETag: etag, "X-Content-Type-Options": "nosniff" } });
}

export async function deleteAsset(c: Context<AppEnv>) {
  const id = c.req.param("id");
  const reference = await c.env.DB.prepare("SELECT post_id FROM post_assets WHERE asset_id=? LIMIT 1").bind(id).first();
  if (reference) return fail(c, 409, "ASSET_IN_USE", "图片仍被文章引用，不能删除");
  const result = await c.env.DB.prepare("DELETE FROM assets WHERE id=?").bind(id).run();
  if (!result.meta.changes) return fail(c, 404, "ASSET_NOT_FOUND", "图片不存在");
  return ok(c, { id, deleted: true });
}

export async function cleanupAssets(c: Context<AppEnv>) {
  const result = await c.env.DB.prepare(
    "DELETE FROM assets WHERE created_at < datetime('now', '-1 day') AND NOT EXISTS (SELECT 1 FROM post_assets WHERE post_assets.asset_id=assets.id)",
  ).run();
  return ok(c, { deleted: result.meta.changes ?? 0 });
}
