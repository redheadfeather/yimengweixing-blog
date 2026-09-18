const ASSET_PATH = /\/api\/v1\/assets\/([a-f0-9]{64})(?:\/|$)/giu;

export function assetIdsFromMarkdown(content: string) {
  return [...new Set([...content.matchAll(ASSET_PATH)].map((match) => match[1]!.toLowerCase()))];
}

export async function assertAssetsExist(db: D1Database, ids: string[]) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT id FROM assets WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<{ id: string }>();
  const existing = new Set(results.map((row) => row.id));
  return ids.filter((id) => !existing.has(id));
}

export function cleanupAssetStatements(db: D1Database, ids: string[]) {
  return ids.map((id) =>
    db
      .prepare('DELETE FROM assets WHERE id=? AND NOT EXISTS (SELECT 1 FROM post_assets WHERE asset_id=?)')
      .bind(id, id),
  );
}
