import type { MemberRole, Room, RoomMember, RoomSettings } from "../domain/rooms";
import { DEFAULT_ROOM_SETTINGS } from "../domain/rooms";
import type { RoomMemberRepo, RoomRepo } from "../domain/repos";

interface RoomRow {
  code: string;
  host_user_id: string;
  is_public: number;
  is_quickplay: number;
  status: string;
  max_players: number;
  settings_json: string;
  created_at: number;
  closed_at: number | null;
}

function settingsFromJson(json: string): RoomSettings {
  try {
    const parsed = JSON.parse(json) as Partial<RoomSettings>;
    return { ...DEFAULT_ROOM_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_ROOM_SETTINGS };
  }
}

function roomFromRow(r: RoomRow): Room {
  return {
    code: r.code,
    hostUserId: r.host_user_id,
    isPublic: r.is_public === 1,
    isQuickplay: r.is_quickplay === 1,
    status: r.status as Room["status"],
    maxPlayers: r.max_players,
    settings: settingsFromJson(r.settings_json),
    createdAt: r.created_at,
    closedAt: r.closed_at,
  };
}

export class D1RoomRepo implements RoomRepo {
  constructor(private readonly db: D1Database) {}

  async insert(room: Room): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO rooms (code, host_user_id, is_public, is_quickplay, status, max_players, settings_json, created_at, closed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
      )
      .bind(
        room.code,
        room.hostUserId,
        room.isPublic ? 1 : 0,
        room.isQuickplay ? 1 : 0,
        room.status,
        room.maxPlayers,
        JSON.stringify(room.settings),
        room.createdAt,
        room.closedAt
      )
      .run();
  }

  async findByCode(code: string): Promise<Room | null> {
    const r = await this.db
      .prepare(`SELECT * FROM rooms WHERE code = ?1`)
      .bind(code)
      .first<RoomRow>();
    return r ? roomFromRow(r) : null;
  }

  async updateHost(code: string, hostUserId: string): Promise<void> {
    await this.db
      .prepare(`UPDATE rooms SET host_user_id = ?2 WHERE code = ?1`)
      .bind(code, hostUserId)
      .run();
  }

  async updateStatus(
    code: string,
    status: Room["status"],
    closedAt: number | null
  ): Promise<void> {
    await this.db
      .prepare(`UPDATE rooms SET status = ?2, closed_at = ?3 WHERE code = ?1`)
      .bind(code, status, closedAt)
      .run();
  }

  async findQuickplayWaiter(
    excludeUserId: string,
    cutoffMs: number
  ): Promise<Room | null> {
    const r = await this.db
      .prepare(
        `SELECT * FROM rooms
         WHERE is_quickplay = 1 AND status = 'WAITING' AND closed_at IS NULL
           AND created_at <= ?1
           AND (SELECT COUNT(*) FROM room_members rm WHERE rm.room_code = rooms.code AND rm.left_at IS NULL) < max_players
           AND host_user_id != ?2
           AND NOT EXISTS (
             SELECT 1 FROM room_members rm
             JOIN blocks b ON (
               (b.blocker_user_id = ?2 AND b.blocked_user_id = rm.user_id) OR
               (b.blocker_user_id = rm.user_id AND b.blocked_user_id = ?2)
             )
             WHERE rm.room_code = rooms.code AND rm.left_at IS NULL
           )
         ORDER BY created_at ASC
         LIMIT 1`
      )
      .bind(cutoffMs, excludeUserId)
      .first<RoomRow>();
    return r ? roomFromRow(r) : null;
  }
}

interface MemberRow {
  room_code: string;
  user_id: string;
  role: string;
  joined_at: number;
  left_at: number | null;
}

function memberFromRow(r: MemberRow): RoomMember {
  return {
    roomCode: r.room_code,
    userId: r.user_id,
    role: r.role as MemberRole,
    joinedAt: r.joined_at,
    leftAt: r.left_at,
  };
}

export class D1RoomMemberRepo implements RoomMemberRepo {
  constructor(private readonly db: D1Database) {}

  /**
   * Atomic guarded seat insert. The INSERT ... SELECT only succeeds when the
   * active member count is below capacity, so two concurrent joins can never
   * both take the last seat. Rejoining while active is reported as DUPLICATE.
   */
  async insertGuarded(
    member: RoomMember,
    maxPlayers: number
  ): Promise<"OK" | "FULL" | "DUPLICATE"> {
    const existing = await this.findActiveByRoomAndUser(
      member.roomCode,
      member.userId
    );
    if (existing) return "DUPLICATE";

    const res = await this.db
      .prepare(
        `INSERT INTO room_members (room_code, user_id, role, joined_at, left_at)
         SELECT ?1, ?2, ?3, ?4, NULL
         WHERE (
           SELECT COUNT(*) FROM room_members rm
           WHERE rm.room_code = ?1 AND rm.left_at IS NULL
         ) < ?5`
      )
      .bind(member.roomCode, member.userId, member.role, member.joinedAt, maxPlayers)
      .run();

    return (res.meta.changes ?? 0) === 1 ? "OK" : "FULL";
  }

  async findActiveByRoomAndUser(
    roomCode: string,
    userId: string
  ): Promise<RoomMember | null> {
    const r = await this.db
      .prepare(
        `SELECT * FROM room_members WHERE room_code = ?1 AND user_id = ?2 AND left_at IS NULL`
      )
      .bind(roomCode, userId)
      .first<MemberRow>();
    return r ? memberFromRow(r) : null;
  }

  async listActiveByRoom(roomCode: string): Promise<RoomMember[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM room_members WHERE room_code = ?1 AND left_at IS NULL ORDER BY joined_at ASC`
      )
      .bind(roomCode)
      .all<MemberRow>();
    return (results ?? []).map(memberFromRow);
  }

  async countActive(roomCode: string): Promise<number> {
    const r = await this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM room_members WHERE room_code = ?1 AND left_at IS NULL`
      )
      .bind(roomCode)
      .first<{ n: number }>();
    return r?.n ?? 0;
  }

  async markLeft(
    roomCode: string,
    userId: string,
    at: number
  ): Promise<{ wasHost: boolean; remaining: number }> {
    const row = await this.findActiveByRoomAndUser(roomCode, userId);
    if (!row) return { wasHost: false, remaining: 0 };
    await this.db
      .prepare(`UPDATE room_members SET left_at = ?3 WHERE room_code = ?1 AND user_id = ?2 AND left_at IS NULL`)
      .bind(roomCode, userId, at)
      .run();
    const remaining = await this.countActive(roomCode);
    return { wasHost: row.role === "HOST", remaining };
  }

  async getRole(roomCode: string, userId: string): Promise<MemberRole | null> {
    const m = await this.findActiveByRoomAndUser(roomCode, userId);
    return m ? m.role : null;
  }

  async updateRole(roomCode: string, userId: string, role: MemberRole): Promise<void> {
    await this.db
      .prepare(
        `UPDATE room_members SET role = ?3 WHERE room_code = ?1 AND user_id = ?2 AND left_at IS NULL`
      )
      .bind(roomCode, userId, role)
      .run();
  }

  async listActiveByUser(userId: string): Promise<RoomMember[]> {
    const { results } = await this.db
      .prepare(
        `SELECT rm.* FROM room_members rm JOIN rooms r ON r.code = rm.room_code
         WHERE rm.user_id = ?1 AND rm.left_at IS NULL AND r.closed_at IS NULL
         ORDER BY rm.joined_at DESC`
      )
      .bind(userId)
      .all<MemberRow>();
    return (results ?? []).map(memberFromRow);
  }
}
