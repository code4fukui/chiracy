ALTER TABLE sites ADD COLUMN deleted_at TEXT;
ALTER TABLE flyers ADD COLUMN deleted_at TEXT;
ALTER TABLE plans ADD COLUMN deleted_at TEXT;

CREATE INDEX sites_user_deleted_idx ON sites(user_id, deleted_at, updated_at DESC);
CREATE INDEX flyers_user_deleted_idx ON flyers(user_id, deleted_at, updated_at DESC);
CREATE INDEX plans_user_deleted_idx ON plans(user_id, deleted_at, updated_at DESC);
