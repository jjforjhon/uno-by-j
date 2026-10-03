import type { PublicUser, RefreshTokenRow, TokenPair, User } from "../domain/types";
import { toPublicUser } from "../domain/types";
import type {
  RefreshTokenRepo,
  SecurityEventRepo,
  UserRepo,
  RateLimiter,
} from "../domain/repos";
import {
  ACCESS_TTL_S,
  REFRESH_TTL_S,
  hashRefreshToken,
  randomId,
  randomToken,
  signAccessToken,
  verifyAccessToken,
} from "../util/crypto";
import { generateUniqueHandle, sanitizeDisplayName } from "./handles";
import { AppError, banned, authExpired, authRequired, badRequest, rateLimited } from "../domain/errors";

export const GUEST_CREATE_LIMIT = 20; // per IP per hour
export const GUEST_CREATE_WINDOW_MS = 60 * 60 * 1000;

export interface AuthDeps {
  users: UserRepo;
  tokens: RefreshTokenRepo;
  events: SecurityEventRepo;
  limiter: RateLimiter;
  jwtSecret: string;
  nowMs?: () => number;
}

export class AuthService {
  private readonly now: () => number;

  constructor(private readonly d: AuthDeps) {
    this.now = d.nowMs ?? (() => Date.now());
  }

  /** Create a guest account and issue the first token pair. */
  async createGuest(rawDisplayName: string | undefined, ipKey: string): Promise<TokenPair> {
    const allowed = await this.d.limiter.check(
      `guest:${ipKey}`,
      GUEST_CREATE_LIMIT,
      GUEST_CREATE_WINDOW_MS
    );
    if (!allowed) throw rateLimited();

    const displayName = sanitizeDisplayName(rawDisplayName);
    const handle = await generateUniqueHandle(this.d.users, displayName);
    const now = this.now();
    const user: User = {
      id: randomId("u"),
      handle,
      displayName,
      avatarId: 0,
      isGuest: true,
      state: "ACTIVE",
      createdAt: now,
      lastSeenAt: now,
    };
    await this.d.users.insert(user);
    await this.d.events.record("AUTH_GUEST_CREATED", user.id, null, now);
    const pair = await this.issueTokens(user);
    return pair;
  }

  /**
   * Rotate a refresh token. Reuse of an already-rotated/revoked token revokes the
   * whole family (stolen-token containment) and fails generically.
   */
  async refresh(rawRefreshToken: string): Promise<TokenPair> {
    if (!rawRefreshToken || rawRefreshToken.length > 512) throw badRequest("invalid token");
    const tokenHash = await hashRefreshToken(rawRefreshToken);
    const row = await this.d.tokens.findByHash(tokenHash);
    const now = this.now();

    if (!row) {
      // Unknown token: indistinguishable response for "never existed" vs "other family".
      throw authExpired();
    }
    if (row.revokedAt != null) {
      // REUSE. Assume theft: kill the family.
      const revoked = await this.d.tokens.revokeFamily(row.familyId, now);
      await this.d.events.record(
        "REFRESH_REUSE",
        row.userId,
        `revoked=${revoked}`,
        now
      );
      throw authExpired();
    }
    if (row.expiresAt <= now) {
      await this.d.tokens.revokeById(row.id, now);
      throw authExpired();
    }

    const user = await this.d.users.findById(row.userId);
    if (!user) throw authExpired();
    if (user.state === "BANNED") throw banned();

    await this.d.tokens.revokeById(row.id, now);
    const pair = await this.issueTokens(user, row.familyId);
    await this.d.users.touch(user.id, now);
    return pair;
  }

  /** Idempotent logout: revokes the presented token's whole rotation family. */
  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) return;
    const tokenHash = await hashRefreshToken(rawRefreshToken);
    const row = await this.d.tokens.findByHash(tokenHash);
    if (!row || row.revokedAt != null) return;
    await this.d.tokens.revokeFamily(row.familyId, this.now());
    await this.d.events.record("AUTH_LOGOUT", row.userId, null, this.now());
  }

  /** Validate a Bearer access token and return the current user. */
  async authenticate(bearerToken: string): Promise<User> {
    const result = await verifyAccessToken(
      this.d.jwtSecret,
      bearerToken,
      Math.floor(this.now() / 1000)
    );
    if (!result.ok) {
      throw result.reason === "expired" ? authExpired() : authRequired();
    }
    const user = await this.d.users.findById(result.claims.sub);
    if (!user) throw authRequired();
    if (user.state === "BANNED") throw banned();
    return user;
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.d.users.findById(userId);
    if (!user) throw authRequired();
    await this.d.users.touch(userId, this.now());
    return toPublicUser(user);
  }

  private async issueTokens(user: User, familyId?: string): Promise<TokenPair> {
    const now = this.now();
    const nowS = Math.floor(now / 1000);
    const access = await signAccessToken(this.d.jwtSecret, {
      sub: user.id,
      handle: user.handle,
      guest: user.isGuest,
    }, nowS);
    const refreshToken = randomToken(32);
    const row: RefreshTokenRow = {
      id: randomId("rt"),
      userId: user.id,
      tokenHash: await hashRefreshToken(refreshToken),
      familyId: familyId ?? randomId("fam"),
      expiresAt: now + REFRESH_TTL_S * 1000,
      revokedAt: null,
      createdAt: now,
    };
    await this.d.tokens.insert(row);
    return {
      accessToken: access,
      refreshToken,
      accessExpiresAt: now / 1000 + ACCESS_TTL_S,
      user: toPublicUser(user),
    };
  }
}
