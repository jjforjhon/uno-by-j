-- 0001_init: Phase 3 authentication schema.
-- Live game state intentionally NOT here (lives in RoomDO storage); this is durable identity.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,            -- 'u_' + 21-char url-safe random
  handle        TEXT NOT NULL UNIQUE,        -- public, unique, user-visible tag
  display_name  TEXT NOT NULL,               -- shown in UI (2-24 chars)
  avatar_id     INTEGER NOT NULL DEFAULT 0,
  is_guest      INTEGER NOT NULL DEFAULT 1,  -- guests first; upgradeable later
  state         TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | BANNED
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);

CREATE TABLE auth_credentials (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL,                 -- 'PASSKEY' | 'PASSWORD' (reserved; Phase 3b)
  secret      BLOB NOT NULL,                 -- passkey pubkey / PBKDF2 hash
  salt        BLOB,
  iterations  INTEGER,
  sign_count  INTEGER NOT NULL DEFAULT 0,
  transports  TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_credentials_user ON auth_credentials(user_id);

CREATE TABLE refresh_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  token_hash  TEXT NOT NULL UNIQUE,          -- SHA-256 of the opaque token; raw never stored
  family_id   TEXT NOT NULL,                 -- rotation family; reuse detection revokes family
  expires_at  INTEGER NOT NULL,
  revoked_at  INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_refresh_user  ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_family ON refresh_tokens(family_id);

CREATE TABLE auth_attempts (
  id        TEXT PRIMARY KEY,
  handle    TEXT NOT NULL,                   -- attempted handle (may not exist)
  ip_hash   TEXT NOT NULL,                   -- salted hash, never raw IP
  ok        INTEGER NOT NULL,
  at        INTEGER NOT NULL
);
CREATE INDEX idx_attempts_handle ON auth_attempts(handle, at);
CREATE INDEX idx_attempts_ip     ON auth_attempts(ip_hash, at);

CREATE TABLE security_events (
  id        TEXT PRIMARY KEY,
  kind      TEXT NOT NULL,                   -- e.g. 'AUTH_GUEST_CREATED', 'REFRESH_REUSE'
  user_id   TEXT,
  detail    TEXT,                            -- non-sensitive context only
  at        INTEGER NOT NULL
);
CREATE INDEX idx_events_kind ON security_events(kind, at);
