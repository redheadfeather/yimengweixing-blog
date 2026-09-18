CREATE TABLE IF NOT EXISTS post_assets (
  post_id INTEGER NOT NULL,
  asset_id TEXT NOT NULL,
  PRIMARY KEY (post_id, asset_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_post_assets_asset_id ON post_assets(asset_id, post_id);

CREATE TABLE IF NOT EXISTS post_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  featured INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  updated_at TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('update', 'archive', 'delete')),
  saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_post_revisions_slug_saved_at
  ON post_revisions(slug, saved_at DESC);
