ALTER TABLE posts
  ADD COLUMN featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1));

CREATE VIRTUAL TABLE posts_fts USING fts5(
  title,
  description,
  content,
  tags,
  tokenize = 'trigram'
);
