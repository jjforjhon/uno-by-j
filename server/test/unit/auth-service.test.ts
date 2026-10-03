import { describe, expect, it } from "vitest";
import { AuthService, GUEST_CREATE_LIMIT } from "../../src/auth/service";
import {
  FakeEventRepo,
  FakeRateLimiter,
  FakeTokenRepo,
  FakeUserRepo,
} from "../helpers";
import { hashRefreshToken, verifyAccessToken } from "../../src/util/crypto";

const SECRET = "test-secret-0123456789abcdef";
const T0 = 1_700_000_000_000;

interface Repos {
  users: FakeUserRepo;
  tokens: FakeTokenRepo;
  events: FakeEventRepo;
  limiter: FakeRateLimiter;
}

function makeRepos(): Repos {
  return {
    users: new FakeUserRepo(),
    tokens: new FakeTokenRepo(),
    events: new FakeEventRepo(),
    limiter: new FakeRateLimiter(),
  };
}

function makeService(repos: Repos = makeRepos(), nowMs: () => number = () => T0) {
  const svc = new AuthService({ ...repos, jwtSecret: SECRET, nowMs });
  return { svc, ...repos };
}

describe("guest creation", () => {
  it("creates a guest with sanitized name, unique handle and valid tokens", async () => {
    const { svc, users, tokens, events } = makeService();
    const pair = await svc.createGuest("  Ada  ", "ip1");

    expect(pair.user.displayName).toBe("Ada");
    expect(pair.user.handle).toMatch(/^ada/);
    expect(pair.user.isGuest).toBe(true);
    expect(users.rows.size).toBe(1);
    expect(tokens.rows.size).toBe(1);

    // Verify with the service's injected clock (real wall time would see the token as expired).
    const claims = await verifyAccessToken(SECRET, pair.accessToken, T0 / 1000 + 60);
    expect(claims.ok).toBe(true);
    if (claims.ok) {
      expect(claims.claims.sub).toBe(pair.user.id);
      expect(claims.claims.guest).toBe(true);
    }
    expect(events.events.some((e) => e.kind === "AUTH_GUEST_CREATED")).toBe(true);
  });

  it("falls back to Player for empty or control-char names", async () => {
    const { svc } = makeService();
    const pair = await svc.createGuest("\u0000\u001f", "ip");
    expect(pair.user.displayName).toBe("Player");
  });

  it("enforces the per-IP guest creation limit", async () => {
    const { svc, limiter } = makeService();
    limiter.allow = false;
    await expect(svc.createGuest("Spam", "ip9")).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    expect(limiter.calls[0]).toMatchObject({ limit: GUEST_CREATE_LIMIT });
  });
});

describe("refresh rotation", () => {
  it("rotates tokens: old revoked, new issued, same family", async () => {
    const { svc, tokens } = makeService();
    const p1 = await svc.createGuest("Rot", "ip");
    const p2 = await svc.refresh(p1.refreshToken);

    expect(p2.refreshToken).not.toBe(p1.refreshToken);
    expect(p2.user.id).toBe(p1.user.id);

    const oldRow = await tokens.findByHash(await hashRefreshToken(p1.refreshToken));
    const newRow = await tokens.findByHash(await hashRefreshToken(p2.refreshToken));
    expect(oldRow?.revokedAt).not.toBeNull();
    expect(newRow?.revokedAt).toBeNull();
    expect(newRow?.familyId).toBe(oldRow?.familyId);
  });

  it("detects reuse of a rotated token and revokes the whole family", async () => {
    const { svc, tokens, events } = makeService();
    const p1 = await svc.createGuest("Reuse", "ip");
    const p2 = await svc.refresh(p1.refreshToken);

    // Replaying the old token is reuse -> family killed.
    await expect(svc.refresh(p1.refreshToken)).rejects.toMatchObject({
      code: "AUTH_EXPIRED",
    });

    // The newer token is dead too: the family was revoked.
    await expect(svc.refresh(p2.refreshToken)).rejects.toMatchObject({
      code: "AUTH_EXPIRED",
    });

    for (const row of tokens.rows.values()) {
      expect(row.revokedAt).not.toBeNull();
    }
    expect(events.events.some((e) => e.kind === "REFRESH_REUSE")).toBe(true);
  });

  it("rejects unknown tokens with the same generic error", async () => {
    const { svc } = makeService();
    await expect(svc.refresh("bogus-token")).rejects.toMatchObject({
      code: "AUTH_EXPIRED",
    });
  });

  it("rejects expired refresh tokens", async () => {
    const repos = makeRepos();
    const { svc } = makeService(repos);
    const p1 = await svc.createGuest("Exp", "ip");

    const later = T0 + 31 * 24 * 60 * 60 * 1000; // past the 30-day TTL
    const aged = new AuthService({ ...repos, jwtSecret: SECRET, nowMs: () => later });
    await expect(aged.refresh(p1.refreshToken)).rejects.toMatchObject({
      code: "AUTH_EXPIRED",
    });
  });

  it("rejects banned users on refresh", async () => {
    const repos = makeRepos();
    const { svc } = makeService(repos);
    const p1 = await svc.createGuest("Bad", "ip");
    const user = [...repos.users.rows.values()][0]!;
    user.state = "BANNED";
    await expect(svc.refresh(p1.refreshToken)).rejects.toMatchObject({ code: "BANNED" });
  });
});

describe("logout", () => {
  it("revokes the family and makes further refreshes fail; idempotent", async () => {
    const { svc, tokens } = makeService();
    const p1 = await svc.createGuest("Bye", "ip");
    await svc.logout(p1.refreshToken);
    await svc.logout(p1.refreshToken); // idempotent, no throw

    const row = await tokens.findByHash(await hashRefreshToken(p1.refreshToken));
    expect(row?.revokedAt).not.toBeNull();
    await expect(svc.refresh(p1.refreshToken)).rejects.toMatchObject({
      code: "AUTH_EXPIRED",
    });
  });

  it("is a no-op without a token", async () => {
    const { svc } = makeService();
    await expect(svc.logout(undefined)).resolves.toBeUndefined();
  });
});

describe("authenticate", () => {
  it("resolves the user for a valid access token", async () => {
    const { svc } = makeService();
    const p1 = await svc.createGuest("Auth", "ip");
    const user = await svc.authenticate(p1.accessToken);
    expect(user.id).toBe(p1.user.id);
  });

  it("rejects a forged token", async () => {
    const { svc } = makeService();
    const p1 = await svc.createGuest("Forge", "ip");
    const forged = p1.accessToken.slice(0, -3) + "aaa";
    await expect(svc.authenticate(forged)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("rejects an expired access token", async () => {
    const repos = makeRepos();
    const { svc } = makeService(repos);
    const p1 = await svc.createGuest("Old", "ip");

    const later = T0 + 16 * 60 * 1000; // past the 15-minute access TTL
    const aged = new AuthService({ ...repos, jwtSecret: SECRET, nowMs: () => later });
    await expect(aged.authenticate(p1.accessToken)).rejects.toMatchObject({
      code: "AUTH_EXPIRED",
    });
  });

  it("rejects tokens signed with the wrong secret", async () => {
    const repos = makeRepos();
    const { svc } = makeService(repos);
    const p1 = await svc.createGuest("Key", "ip");
    const other = new AuthService({ ...repos, jwtSecret: "other-secret", nowMs: () => T0 });
    await expect(other.authenticate(p1.accessToken)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });
});
