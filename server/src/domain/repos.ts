import type { RefreshTokenRow, User } from "./types";
import type { MemberRole, Room, RoomMember, RoomSettings } from "./rooms";

/**
 * Persistence ports (hexagonal). The D1 implementation lives in src/db;
 * tests use in-memory fakes. Swapping D1 for Postgres/SQLite later touches
 * only src/db — never the services.
 */
export interface UserRepo {
  insert(user: User): Promise<void>;
  findById(id: string): Promise<User | null>;
  findByHandle(handle: string): Promise<User | null>;
  touch(id: string, at: number): Promise<void>;
}

export interface RefreshTokenRepo {
  insert(row: RefreshTokenRow): Promise<void>;
  findByHash(tokenHash: string): Promise<RefreshTokenRow | null>;
  revokeById(id: string, at: number): Promise<void>;
  revokeFamily(familyId: string, at: number): Promise<number>;
  revokeAllForUser(userId: string, at: number): Promise<void>;
}

export interface SecurityEventRepo {
  record(kind: string, userId: string | null, detail: string | null, at: number): Promise<void>;
}

export interface RateLimiter {
  /** Returns true if the action is allowed under `limit` per `windowMs` for `key`. */
  check(key: string, limit: number, windowMs: number): Promise<boolean>;
}

export interface RoomRepo {
  insert(room: Room): Promise<void>;
  findByCode(code: string): Promise<Room | null>;
  updateHost(code: string, hostUserId: string): Promise<void>;
  updateStatus(code: string, status: Room["status"], closedAt: number | null): Promise<void>;
  /** Find the oldest eligible quickplay waiter room; `cutoffMs` = oldest allowed createdAt. */
  findQuickplayWaiter(excludeUserId: string, cutoffMs: number): Promise<Room | null>;
}

export interface RoomMemberRepo {
  /** Atomic guarded seat insert: returns false if a seat is already held (full or joined). */
  insertGuarded(
    member: RoomMember,
    maxPlayers: number
  ): Promise<"OK" | "FULL" | "DUPLICATE">;
  findActiveByRoomAndUser(roomCode: string, userId: string): Promise<RoomMember | null>;
  listActiveByRoom(roomCode: string): Promise<RoomMember[]>;
  countActive(roomCode: string): Promise<number>;
  /** Leave: marks left_at. Returns whether the leaver was host and how many remain. */
  markLeft(roomCode: string, userId: string, at: number): Promise<{ wasHost: boolean; remaining: number }>;
  getRole(roomCode: string, userId: string): Promise<MemberRole | null>;
  updateRole(roomCode: string, userId: string, role: MemberRole): Promise<void>;
  listActiveByUser(userId: string): Promise<RoomMember[]>;
}

export interface ChatRepo {
  insert(msg: import("./chat").ChatMessage): Promise<void>;
  listRecentByRoom(roomCode: string, limit?: number): Promise<import("./chat").ChatMessage[]>;
}

export interface BlockRepo {
  block(blockerUserId: string, blockedUserId: string, at: number): Promise<void>;
  unblock(blockerUserId: string, blockedUserId: string): Promise<void>;
  isBlocked(userA: string, userB: string): Promise<boolean>;
  listBlockedByUser(userId: string): Promise<string[]>;
}

export interface ReportRepo {
  insert(report: import("./chat").Report): Promise<void>;
  listByTarget(targetUserId: string): Promise<import("./chat").Report[]>;
  countRecentByReporter(reporterUserId: string, sinceMs: number): Promise<number>;
}

export type { Room, RoomMember, RoomSettings };
export * from "./chat";
