ALTER TABLE sites ADD COLUMN kind TEXT NOT NULL DEFAULT 'site'
  CHECK (kind IN ('site', 'app'));

CREATE INDEX sites_user_kind_updated_idx
  ON sites(user_id, kind, deleted_at, updated_at DESC);
