-- Users signed in with Google, their sessions and their renders.

CREATE TABLE users (
  id TEXT PRIMARY KEY,                -- random id
  google_sub TEXT NOT NULL UNIQUE,    -- Google's stable account id
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  picture TEXT NOT NULL DEFAULT '',
  locale TEXT NOT NULL DEFAULT 'en',  -- 'en' or 'es'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                -- SHA-256 of the cookie value, never the value itself
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE renders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  brief TEXT NOT NULL,                -- JSON: room, style, lighting, materials, details
  sketch_key TEXT NOT NULL,           -- R2 keys
  mask_key TEXT,
  result_key TEXT,
  width INTEGER NOT NULL,             -- render size, from the sketch's aspect ratio
  height INTEGER NOT NULL,
  seed INTEGER NOT NULL,              -- kept so a render can be repeated or varied
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX renders_user ON renders(user_id, created_at DESC);
