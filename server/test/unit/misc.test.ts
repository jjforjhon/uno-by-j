import { describe, expect, it } from "vitest";
import { MemoryRateLimiter } from "../../src/net/ratelimit";
import { generateUniqueHandle, sanitizeDisplayName } from "../../src/auth/handles";
import { FakeUserRepo } from "../helpers";

describe("sanitizeDisplayName", () => {
  it("trims, collapses whitespace, strips control chars, clamps to 24", () => {
    expect(sanitizeDisplayName("  Ada   Lovelace  ")).toBe("Ada Lovelace");
    expect(sanitizeDisplayName("a\u0000b\u001f")).toBe("ab");
    expect(sanitizeDisplayName("x".repeat(100))).toBe("x".repeat(24));
  });

  it("falls back to Player when too short", () => {
    expect(sanitizeDisplayName("")).toBe("Player");
    expect(sanitizeDisplayName("  ")).toBe("Player");
    expect(sanitizeDisplayName("a")).toBe("Player");
  });
});

describe("generateUniqueHandle", () => {
  it("returns the base handle when free", async () => {
    const users = new FakeUserRepo();
    expect(await generateUniqueHandle(users, "Ada Lovelace")).toBe("adalovelace");
  });

  it("appends a numeric suffix on collision, then random", async () => {
    const users = new FakeUserRepo();
    const first = await generateUniqueHandle(users, "Ada Lovelace");
    expect(first).toBe("adalovelace");
    // Reserve each generated handle before asking for the next one.
    await users.insert({
      id: "u_t1",
      handle: first,
      displayName: "Ada Lovelace",
      avatarId: 0,
      isGuest: true,
      state: "ACTIVE",
      createdAt: 0,
      lastSeenAt: 0,
    });
    const second = await generateUniqueHandle(users, "Ada Lovelace");
    expect(second).toBe("adalovelace2");
    await users.insert({
      id: "u_t2",
      handle: second,
      displayName: "Ada Lovelace",
      avatarId: 0,
      isGuest: true,
      state: "ACTIVE",
      createdAt: 0,
      lastSeenAt: 0,
    });
    const third = await generateUniqueHandle(users, "Ada Lovelace");
    expect(third).toBe("adalovelace3");
    expect(third).not.toBe(second);
  });

  it("falls back to a neutral base for non-latin names", async () => {
    const users = new FakeUserRepo();
    const h = await generateUniqueHandle(users, "程心");
    expect(h).toMatch(/^player/);
  });
});

describe("MemoryRateLimiter", () => {
  it("allows up to the limit, then blocks until the window resets", async () => {
    let now = 1000;
    const limiter = new MemoryRateLimiter(() => now);
    for (let i = 0; i < 3; i++) {
      expect(await limiter.check("k", 3, 1000)).toBe(true);
    }
    expect(await limiter.check("k", 3, 1000)).toBe(false);
    now += 1001;
    expect(await limiter.check("k", 3, 1000)).toBe(true);
  });

  it("tracks keys independently", async () => {
    const limiter = new MemoryRateLimiter(() => 1000);
    expect(await limiter.check("a", 1, 1000)).toBe(true);
    expect(await limiter.check("b", 1, 1000)).toBe(true);
    expect(await limiter.check("a", 1, 1000)).toBe(false);
  });
});
