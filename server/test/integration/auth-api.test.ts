import { beforeAll, describe, expect, it } from "vitest";
import { applyD1Migrations, env, SELF } from "cloudflare:test";

beforeAll(async () => {
  // Migrations are read at config time and injected as a binding (vitest.config.ts).
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

interface TokenPair {
  user: { id: string; handle: string; displayName: string; isGuest: boolean };
  accessToken: string;
  refreshToken: string;
}

async function createGuest(name?: string): Promise<{ res: Response; body: TokenPair }> {
  const res = await SELF.fetch("https://example.com/auth/guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(name ? { displayName: name } : {}),
  });
  const body = (await res.json()) as TokenPair;
  return { res, body };
}

describe("POST /auth/guest", () => {
  it("creates a guest and returns a token pair", async () => {
    const { res, body } = await createGuest("Ada");
    expect(res.status).toBe(201);
    expect(body.user.displayName).toBe("Ada");
    expect(body.user.isGuest).toBe(true);
    expect(body.accessToken.split(".")).toHaveLength(3);
    expect(body.refreshToken.length).toBeGreaterThan(30);
  });

  it("assigns unique handles on repeated names", async () => {
    const a = await createGuest("Unique Person");
    const b = await createGuest("Unique Person");
    expect(a.body.user.handle).toBe("uniqueperson");
    expect(b.body.user.handle).not.toBe(a.body.user.handle);
  });
});

describe("GET /me", () => {
  it("resolves the bearer token to the user", async () => {
    const { body } = await createGuest("Me");
    const res = await SELF.fetch("https://example.com/me", {
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { user: { id: string } };
    expect(data.user.id).toBe(body.user.id);
  });

  it("rejects missing/invalid tokens with 401 and a stable code", async () => {
    const noAuth = await SELF.fetch("https://example.com/me");
    expect(noAuth.status).toBe(401);
    expect(((await noAuth.json()) as { error: { code: string } }).error.code).toBe(
      "AUTH_REQUIRED"
    );

    const { body } = await createGuest("X");
    const bad = await SELF.fetch("https://example.com/me", {
      headers: { authorization: `Bearer ${body.accessToken.slice(0, -2)}zz` },
    });
    expect(bad.status).toBe(401);
  });
});

describe("refresh rotation + reuse detection", () => {
  it("rotates and kills the family on replay", async () => {
    const { body } = await createGuest("Rot");

    const r1 = await SELF.fetch("https://example.com/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: body.refreshToken }),
    });
    expect(r1.status).toBe(200);
    const pair2 = (await r1.json()) as TokenPair;
    expect(pair2.refreshToken).not.toBe(body.refreshToken);

    // Replay the OLD token: reuse detection.
    const replay = await SELF.fetch("https://example.com/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: body.refreshToken }),
    });
    expect(replay.status).toBe(401);

    // The rotated token is now dead too (family revoked).
    const after = await SELF.fetch("https://example.com/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: pair2.refreshToken }),
    });
    expect(after.status).toBe(401);
  });

  it("rejects unknown refresh tokens with 401", async () => {
    const res = await SELF.fetch("https://example.com/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: "does-not-exist" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("logout", () => {
  it("revokes the refresh family", async () => {
    const { body } = await createGuest("Bye");
    const out = await SELF.fetch("https://example.com/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: body.refreshToken }),
    });
    expect(out.status).toBe(200);

    const after = await SELF.fetch("https://example.com/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: body.refreshToken }),
    });
    expect(after.status).toBe(401);
  });
});

describe("input validation", () => {
  it("rejects malformed JSON with 400", async () => {
    const res = await SELF.fetch("https://example.com/auth/guest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "BAD_REQUEST"
    );
  });

  it("rejects oversized bodies with 400", async () => {
    const res = await SELF.fetch("https://example.com/auth/guest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "x".repeat(10_000) }),
    });
    expect(res.status).toBe(400);
  });

  it("404s unknown routes with a stable code", async () => {
    const res = await SELF.fetch("https://example.com/nope", { method: "GET" });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "NOT_FOUND"
    );
  });

  it("sets security headers on responses", async () => {
    const res = await SELF.fetch("https://example.com/nope", { method: "GET" });
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });
});
