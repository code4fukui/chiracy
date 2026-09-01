CREATE TABLE contents_new (
  id TEXT PRIMARY KEY,
  site_id TEXT REFERENCES sites(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  data BLOB NOT NULL,
  source_content_id TEXT REFERENCES contents_new(id) ON DELETE SET NULL,
  prompt TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  description TEXT
) STRICT;

INSERT INTO contents_new(
  id, site_id, user_id, name, mime_type, size, data, source_content_id,
  prompt, created_at, description
)
SELECT id, site_id, user_id, name, mime_type, size, data, source_content_id,
  prompt, created_at, description
FROM contents;

DROP TABLE contents;
ALTER TABLE contents_new RENAME TO contents;

CREATE INDEX contents_user_created_idx ON contents(user_id, created_at DESC);

UPDATE sites
SET html = replace(
  html,
  '/' || user_id || '/' || id || '/content/',
  '/' || user_id || '/content/'
);

UPDATE site_versions
SET html = replace(
  html,
  (
    SELECT '/' || sites.user_id || '/' || sites.id || '/content/'
    FROM sites WHERE sites.id = site_versions.site_id
  ),
  (
    SELECT '/' || sites.user_id || '/content/'
    FROM sites WHERE sites.id = site_versions.site_id
  )
);
