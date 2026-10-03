-- 0002_rooms: room registry + durable membership.
-- Live seats/presence live in RoomDO (Phase 6); this is the durable source of membership.

CREATE TABLE rooms (
  code          TEXT PRIMARY KEY,            -- 6 chars, unambiguous alphabet
  host_user_id  TEXT NOT NULL,
  is_public     INTEGER NOT NULL DEFAULT 0,  -- private by default: code is the invite
  is_quickplay  INTEGER NOT NULL DEFAULT 0,  -- quickplay-flagged rooms are matchmaking targets
  status        TEXT NOT NULL DEFAULT 'WAITING', -- WAITING | PLAYING | CLOSED
  max_players   INTEGER NOT NULL DEFAULT 4,
  settings_json TEXT NOT NULL,               -- canonical rule toggles (see RoomSettings)
  created_at    INTEGER NOT NULL,
  closed_at     INTEGER
);
CREATE INDEX idx_rooms_quickplay ON rooms(is_quickplay, status, closed_at, created_at);

CREATE TABLE room_members (
  room_code TEXT NOT NULL REFERENCES rooms(code),
  user_id   TEXT NOT NULL REFERENCES users(id),
  role      TEXT NOT NULL DEFAULT 'MEMBER',  -- HOST | MEMBER
  joined_at INTEGER NOT NULL,
  left_at   INTEGER,                          -- NULL = active member
  PRIMARY KEY (room_code, user_id)
);
CREATE INDEX idx_members_user ON room_members(user_id, left_at);
