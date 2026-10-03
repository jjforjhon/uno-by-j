import type { ChatMessage, Report, ReportCategory } from "../domain/chat";
import type { ChatRepo, BlockRepo, ReportRepo } from "../domain/repos";

interface ChatMessageRow {
  id: string;
  room_code: string;
  sender_user_id: string;
  sender_name: string;
  body: string;
  created_at: number;
}

function chatMessageFromRow(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    roomCode: row.room_code,
    senderUserId: row.sender_user_id,
    senderName: row.sender_name,
    body: row.body,
    createdAt: row.created_at,
  };
}

export class D1ChatRepo implements ChatRepo {
  constructor(private readonly db: D1Database) {}

  async insert(msg: ChatMessage): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO chat_messages (id, room_code, sender_user_id, sender_name, body, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
      )
      .bind(
        msg.id,
        msg.roomCode,
        msg.senderUserId,
        msg.senderName,
        msg.body,
        msg.createdAt
      )
      .run();
  }

  async listRecentByRoom(roomCode: string, limit = 50): Promise<ChatMessage[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM chat_messages
         WHERE room_code = ?1
         ORDER BY created_at DESC
         LIMIT ?2`
      )
      .bind(roomCode, limit)
      .all<ChatMessageRow>();

    // Return in chronological order
    return (results ?? []).map(chatMessageFromRow).reverse();
  }
}

export class D1BlockRepo implements BlockRepo {
  constructor(private readonly db: D1Database) {}

  async block(blockerUserId: string, blockedUserId: string, at: number): Promise<void> {
    if (blockerUserId === blockedUserId) return; // Cannot block self
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO blocks (blocker_user_id, blocked_user_id, created_at)
         VALUES (?1, ?2, ?3)`
      )
      .bind(blockerUserId, blockedUserId, at)
      .run();
  }

  async unblock(blockerUserId: string, blockedUserId: string): Promise<void> {
    await this.db
      .prepare(
        `DELETE FROM blocks
         WHERE blocker_user_id = ?1 AND blocked_user_id = ?2`
      )
      .bind(blockerUserId, blockedUserId)
      .run();
  }

  async isBlocked(userA: string, userB: string): Promise<boolean> {
    const row = await this.db
      .prepare(
        `SELECT 1 FROM blocks
         WHERE (blocker_user_id = ?1 AND blocked_user_id = ?2)
            OR (blocker_user_id = ?2 AND blocked_user_id = ?1)
         LIMIT 1`
      )
      .bind(userA, userB)
      .first<{ 1: number }>();
    return row !== null;
  }

  async listBlockedByUser(userId: string): Promise<string[]> {
    const { results } = await this.db
      .prepare(
        `SELECT blocked_user_id FROM blocks
         WHERE blocker_user_id = ?1
         ORDER BY created_at DESC`
      )
      .bind(userId)
      .all<{ blocked_user_id: string }>();

    return (results ?? []).map((r) => r.blocked_user_id);
  }
}

interface ReportRow {
  id: string;
  reporter_user_id: string;
  target_user_id: string;
  room_code: string | null;
  category: string;
  message_id: string | null;
  reason: string | null;
  created_at: number;
  status: string;
}

function reportFromRow(r: ReportRow): Report {
  return {
    id: r.id,
    reporterUserId: r.reporter_user_id,
    targetUserId: r.target_user_id,
    roomCode: r.room_code,
    category: r.category as ReportCategory,
    messageId: r.message_id,
    reason: r.reason,
    createdAt: r.created_at,
    status: r.status as Report["status"],
  };
}

export class D1ReportRepo implements ReportRepo {
  constructor(private readonly db: D1Database) {}

  async insert(report: Report): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO reports (id, reporter_user_id, target_user_id, room_code, category, message_id, reason, created_at, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
      )
      .bind(
        report.id,
        report.reporterUserId,
        report.targetUserId,
        report.roomCode,
        report.category,
        report.messageId,
        report.reason,
        report.createdAt,
        report.status
      )
      .run();
  }

  async listByTarget(targetUserId: string): Promise<Report[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM reports
         WHERE target_user_id = ?1
         ORDER BY created_at DESC`
      )
      .bind(targetUserId)
      .all<ReportRow>();

    return (results ?? []).map(reportFromRow);
  }

  async countRecentByReporter(reporterUserId: string, sinceMs: number): Promise<number> {
    const res = await this.db
      .prepare(
        `SELECT COUNT(*) as cnt FROM reports
         WHERE reporter_user_id = ?1 AND created_at >= ?2`
      )
      .bind(reporterUserId, sinceMs)
      .first<{ cnt: number }>();

    return res?.cnt ?? 0;
  }
}
