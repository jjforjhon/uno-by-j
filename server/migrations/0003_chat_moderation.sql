-- 0003_chat_moderation: Chat messages, user blocks, and moderation reports.

CREATE TABLE chat_messages (
  id              TEXT PRIMARY KEY,
  room_code       TEXT NOT NULL REFERENCES rooms(code),
  sender_user_id  TEXT NOT NULL REFERENCES users(id),
  sender_name     TEXT NOT NULL,
  body            TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_chat_room_time ON chat_messages(room_code, created_at);

CREATE TABLE blocks (
  blocker_user_id TEXT NOT NULL REFERENCES users(id),
  blocked_user_id TEXT NOT NULL REFERENCES users(id),
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (blocker_user_id, blocked_user_id)
);
CREATE INDEX idx_blocks_blocked ON blocks(blocked_user_id);

CREATE TABLE reports (
  id                TEXT PRIMARY KEY,
  reporter_user_id  TEXT NOT NULL REFERENCES users(id),
  target_user_id    TEXT NOT NULL REFERENCES users(id),
  room_code         TEXT REFERENCES rooms(code),
  category          TEXT NOT NULL,
  message_id        TEXT,
  reason            TEXT,
  created_at        INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'PENDING'
);
CREATE INDEX idx_reports_target ON reports(target_user_id, created_at);
CREATE INDEX idx_reports_status ON reports(status, created_at);
