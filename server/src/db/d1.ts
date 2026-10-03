import type { RefreshTokenRow, User, UserState } from "../domain/types";
import type {
  RefreshTokenRepo,
  SecurityEventRepo,
  UserRepo,
} from "../domain/repos";

/** The only place SQL lives. Everything else talks to the ports above. */

interface UserRow {
  id: string;
  handle: string;
  display_name: string;
  avatar_id: number;
  is_guest: number;
  state: string;
  created_at: number;
  last_seen_at: number;
}

function userFromRow(r: UserRow): User {
  return {
    id: r.id,
    handle: r.handle,
    displayName: r.display_name,
    avatarId: r.avatar_id,
    isGuest: r.is_guest === 1,
    state: r.state as UserState,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
  };
}

export class D1UserRepo implements UserRepo {
  constructor(private readonly db: D1Database) {}

  async insert(user: User): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO users (id, handle, display_name, avatar_id, is_guest, state, created_at, last_seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
      )
      .bind(
        user.id,
        user.handle,
        user.displayName,
        user.avatarId,
        user.isGuest ? 1 : 0,
        user.state,
        user.createdAt,
        user.lastSeenAt
      )
      .run();
  }

  async findById(id: string): Promise<User | null> {
    const r = await this.db
      .prepare(`SELECT * FROM users WHERE id = ?1`)
      .bind(id)
      .first<UserRow>();
    return r ? userFromRow(r) : null;
  }

  async findByHandle(handle: string): Promise<User | null> {
    const r = await this.db
      .prepare(`SELECT * FROM users WHERE handle = ?1`)
      .bind(handle)
      .first<UserRow>();
    return r ? userFromRow(r) : null;
  }

  async touch(id: string, at: number): Promise<void> {
    await this.db
      .prepare(`UPDATE users SET last_seen_at = ?2 WHERE id = ?1`)
      .bind(id, at)
      .run();
  }
}

interface TokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  family_id: string;
  expires_at: number;
  revoked_at: number | null;
  created_at: number;
}

function tokenFromRow(r: TokenRow): RefreshTokenRow {
  return {
    id: r.id,
    userId: r.user_id,
    tokenHash: r.token_hash,
    familyId: r.family_id,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    createdAt: r.created_at,
  };
}

export class D1RefreshTokenRepo implements RefreshTokenRepo {
  constructor(private readonly db: D1Database) {}

  async insert(row: RefreshTokenRow): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at, revoked_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
      )
      .bind(
        row.id,
        row.userId,
        row.tokenHash,
        row.familyId,
        row.expiresAt,
        row.revokedAt,
        row.createdAt
      )
      .run();
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRow | null> {
    const r = await this.db
      .prepare(`SELECT * FROM refresh_tokens WHERE token_hash = ?1`)
      .bind(tokenHash)
      .first<TokenRow>();
    return r ? tokenFromRow(r) : null;
  }

  async revokeById(id: string, at: number): Promise<void> {
    await this.db
      .prepare(`UPDATE refresh_tokens SET revoked_at = ?2 WHERE id = ?1 AND revoked_at IS NULL`)
      .bind(id, at)
      .run();
  }

  async revokeFamily(familyId: string, at: number): Promise<number> {
    const res = await this.db
      .prepare(`UPDATE refresh_tokens SET revoked_at = ?2 WHERE family_id = ?1 AND revoked_at IS NULL`)
      .bind(familyId, at)
      .run();
    return res.meta.changes ?? 0;
  }

  async revokeAllForUser(userId: string, at: number): Promise<void> {
    await this.db
      .prepare(`UPDATE refresh_tokens SET revoked_at = ?2 WHERE user_id = ?1 AND revoked_at IS NULL`)
      .bind(userId, at)
      .run();
  }
}

export class D1SecurityEventRepo implements SecurityEventRepo {
  constructor(private readonly db: D1Database) {}

  async record(
    kind: string,
    userId: string | null,
    detail: string | null,
    at: number
  ): Promise<void> {
    await this.db
      .prepare(`INSERT INTO security_events (id, kind, user_id, detail, at) VALUES (?1, ?2, ?3, ?4, ?5)`)
      .bind(crypto.randomUUID(), kind, userId, detail, at)
      .run();
  }
}

export * from "./chat";
