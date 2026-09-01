CREATE TABLE flyers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  image BLOB,
  mime_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE INDEX flyers_user_updated_idx ON flyers(user_id, updated_at DESC);

CREATE TABLE flyer_messages (
  id INTEGER PRIMARY KEY,
  flyer_id TEXT NOT NULL REFERENCES flyers(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE INDEX flyer_messages_flyer_id_idx ON flyer_messages(flyer_id, id);
