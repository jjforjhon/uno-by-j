import type { RefreshTokenRow, User } from "../src/domain/types";
import type { MemberRole, Room, RoomMember } from "../src/domain/rooms";
import type {
  RateLimiter,
  RefreshTokenRepo,
  RoomMemberRepo,
  RoomRepo,
  SecurityEventRepo,
  UserRepo,
} from "../src/domain/repos";

export class FakeUserRepo implements UserRepo {
  readonly rows = new Map<string, User>();
  private byHandle = new Map<string, string>();

  async insert(user: User): Promise<void> {
    if (this.byHandle.has(user.handle)) {
      throw new Error("UNIQUE constraint failed: users.handle");
    }
    this.rows.set(user.id, { ...user });
    this.byHandle.set(user.handle, user.id);
  }

  async findById(id: string): Promise<User | null> {
    const u = this.rows.get(id);
    return u ? { ...u } : null;
  }

  async findByHandle(handle: string): Promise<User | null> {
    const id = this.byHandle.get(handle);
    if (!id) return null;
    const u = this.rows.get(id);
    return u ? { ...u } : null;
  }

  async touch(id: string, at: number): Promise<void> {
    const u = this.rows.get(id);
    if (u) u.lastSeenAt = at;
  }
}

export class FakeTokenRepo implements RefreshTokenRepo {
  readonly rows = new Map<string, RefreshTokenRow>();

  async insert(row: RefreshTokenRow): Promise<void> {
    this.rows.set(row.tokenHash, { ...row });
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRow | null> {
    const r = this.rows.get(tokenHash);
    return r ? { ...r } : null;
  }

  async revokeById(id: string, at: number): Promise<void> {
    for (const r of this.rows.values()) {
      if (r.id === id && r.revokedAt == null) r.revokedAt = at;
    }
  }

  async revokeFamily(familyId: string, at: number): Promise<number> {
    let n = 0;
    for (const r of this.rows.values()) {
      if (r.familyId === familyId && r.revokedAt == null) {
        r.revokedAt = at;
        n++;
      }
    }
    return n;
  }

  async revokeAllForUser(userId: string, at: number): Promise<void> {
    for (const r of this.rows.values()) {
      if (r.userId === userId && r.revokedAt == null) r.revokedAt = at;
    }
  }
}

export class FakeEventRepo implements SecurityEventRepo {
  readonly events: Array<{ kind: string; userId: string | null; detail: string | null; at: number }> = [];

  async record(
    kind: string,
    userId: string | null,
    detail: string | null,
    at: number
  ): Promise<void> {
    this.events.push({ kind, userId, detail, at });
  }
}

export class FakeRateLimiter implements RateLimiter {
  readonly calls: Array<{ key: string; limit: number; windowMs: number }> = [];
  allow = true;

  async check(key: string, limit: number, windowMs: number): Promise<boolean> {
    this.calls.push({ key, limit, windowMs });
    return this.allow;
  }
}

export class FakeRoomRepo implements RoomRepo {
  readonly rows = new Map<string, Room>();

  async insert(room: Room): Promise<void> {
    if (this.rows.has(room.code)) {
      throw new Error("UNIQUE constraint failed: rooms.code");
    }
    this.rows.set(room.code, { ...room });
  }

  async findByCode(code: string): Promise<Room | null> {
    const r = this.rows.get(code);
    return r ? { ...r } : null;
  }

  async updateHost(code: string, hostUserId: string): Promise<void> {
    const r = this.rows.get(code);
    if (r) r.hostUserId = hostUserId;
  }

  async updateStatus(
    code: string,
    status: Room["status"],
    closedAt: number | null
  ): Promise<void> {
    const r = this.rows.get(code);
    if (r) {
      r.status = status;
      r.closedAt = closedAt;
    }
  }

  async findQuickplayWaiter(
    excludeUserId: string,
    cutoffMs: number
  ): Promise<Room | null> {
    const candidates = [...this.rows.values()]
      .filter(
        (r) =>
          r.isQuickplay &&
          r.status === "WAITING" &&
          r.closedAt == null &&
          r.createdAt <= cutoffMs &&
          r.hostUserId !== excludeUserId
      )
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const r of candidates) {
      const active = [...(this.members?.rows.values() ?? [])].filter(
        (m) => m.roomCode === r.code && m.leftAt == null
      ).length;
      if (active < r.maxPlayers) return { ...r };
    }
    return null;
  }

  // Back-reference wired by the test factory so quickplay can check seat counts.
  members?: FakeRoomMemberRepo;
}

export class FakeRoomMemberRepo implements RoomMemberRepo {
  readonly rows = new Map<string, RoomMember>();

  private key(roomCode: string, userId: string): string {
    return `${roomCode}:${userId}`;
  }

  async insertGuarded(
    member: RoomMember,
    maxPlayers: number
  ): Promise<"OK" | "FULL" | "DUPLICATE"> {
    const existing = this.rows.get(this.key(member.roomCode, member.userId));
    if (existing && existing.leftAt == null) return "DUPLICATE";
    const active = [...this.rows.values()].filter(
      (m) => m.roomCode === member.roomCode && m.leftAt == null
    ).length;
    if (active >= maxPlayers) return "FULL";
    this.rows.set(this.key(member.roomCode, member.userId), { ...member });
    return "OK";
  }

  async findActiveByRoomAndUser(
    roomCode: string,
    userId: string
  ): Promise<RoomMember | null> {
    const m = this.rows.get(this.key(roomCode, userId));
    return m && m.leftAt == null ? { ...m } : null;
  }

  async listActiveByRoom(roomCode: string): Promise<RoomMember[]> {
    return [...this.rows.values()]
      .filter((m) => m.roomCode === roomCode && m.leftAt == null)
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((m) => ({ ...m }));
  }

  async countActive(roomCode: string): Promise<number> {
    return [...this.rows.values()].filter(
      (m) => m.roomCode === roomCode && m.leftAt == null
    ).length;
  }

  async markLeft(
    roomCode: string,
    userId: string,
    at: number
  ): Promise<{ wasHost: boolean; remaining: number }> {
    const m = this.rows.get(this.key(roomCode, userId));
    if (!m || m.leftAt != null) return { wasHost: false, remaining: 0 };
    m.leftAt = at;
    const remaining = await this.countActive(roomCode);
    return { wasHost: m.role === "HOST", remaining };
  }

  async getRole(roomCode: string, userId: string): Promise<MemberRole | null> {
    const m = this.rows.get(this.key(roomCode, userId));
    return m && m.leftAt == null ? m.role : null;
  }

  async updateRole(roomCode: string, userId: string, role: MemberRole): Promise<void> {
    const m = this.rows.get(this.key(roomCode, userId));
    if (m && m.leftAt == null) m.role = role;
  }

  async listActiveByUser(userId: string): Promise<RoomMember[]> {
    return [...this.rows.values()]
      .filter((m) => m.userId === userId && m.leftAt == null)
      .map((m) => ({ ...m }));
  }
}
