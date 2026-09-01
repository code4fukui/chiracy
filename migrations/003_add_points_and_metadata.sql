ALTER TABLE users ADD COLUMN points INTEGER NOT NULL DEFAULT 1000 CHECK (points >= 0);
ALTER TABLE contents ADD COLUMN description TEXT;

CREATE TABLE point_usage (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('chat', 'image')),
  points INTEGER NOT NULL CHECK (points > 0),
  cost_usd REAL NOT NULL CHECK (cost_usd >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE INDEX point_usage_user_created_idx ON point_usage(user_id, created_at DESC);
