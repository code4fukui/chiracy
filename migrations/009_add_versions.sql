CREATE TABLE site_versions (
  id INTEGER PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  html TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE INDEX site_versions_site_id_idx ON site_versions(site_id, id DESC);

CREATE TABLE flyer_versions (
  id INTEGER PRIMARY KEY,
  flyer_id TEXT NOT NULL REFERENCES flyers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  image BLOB NOT NULL,
  mime_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE INDEX flyer_versions_flyer_id_idx ON flyer_versions(flyer_id, id DESC);

INSERT INTO site_versions(site_id, title, html)
SELECT id, title, html FROM sites;

INSERT INTO flyer_versions(flyer_id, title, image, mime_type)
SELECT id, title, image, mime_type FROM flyers
WHERE image IS NOT NULL AND mime_type IS NOT NULL;
