ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0 CHECK (is_banned IN (0, 1));

CREATE TABLE admin_sessions (
  id TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

INSERT INTO settings(key, value) VALUES ('initial_points', '1000');
