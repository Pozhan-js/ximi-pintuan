CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, salt TEXT NOT NULL, leader INTEGER NOT NULL CHECK(leader IN (0,1))
) STRICT;
CREATE TABLE IF NOT EXISTS sessions (
  hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS login_attempts (
  username TEXT PRIMARY KEY, attempts INTEGER NOT NULL, started_at INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id), request_key TEXT NOT NULL,
  title TEXT NOT NULL, description TEXT NOT NULL, cover_id TEXT NOT NULL, detail_images TEXT NOT NULL,
  minimum TEXT NOT NULL, deadline TEXT NOT NULL, shipping_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','published','deleted')),
  revision INTEGER NOT NULL CHECK(revision > 0), updated_at INTEGER NOT NULL,
  published_at TEXT, preview_token TEXT, preview_at INTEGER,
  UNIQUE(owner_id,request_key), CHECK((status = 'published') = (published_at IS NOT NULL))
) STRICT;
CREATE INDEX IF NOT EXISTS groups_owner_status ON groups(owner_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS groups_public ON groups(status,published_at DESC);
CREATE TABLE IF NOT EXISTS specs (
  group_id TEXT NOT NULL REFERENCES groups(id), position INTEGER NOT NULL,
  name TEXT NOT NULL, price_cents INTEGER CHECK(price_cents BETWEEN 1 AND 9999999),
  stock INTEGER CHECK(stock BETWEEN 1 AND 9999), PRIMARY KEY(group_id,position)
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS specs_unique_name ON specs(group_id,name) WHERE name <> '';
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id),
  mime TEXT NOT NULL CHECK(mime IN ('image/jpeg','image/png')), bytes BLOB NOT NULL,
  CHECK(length(bytes) BETWEEN 1 AND 5242880)
) STRICT;
PRAGMA user_version = 1;
