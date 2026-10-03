import { describe, expect, it } from "vitest";
import {
  _internal,
  hashRefreshToken,
  randomId,
  randomToken,
  signAccessToken,
  verifyAccessToken,
} from "../../src/util/crypto";

const SECRET = "unit-secret";

describe("base64url", () => {
  it("round-trips bytes without +, / or =", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255]);
    const enc = _internal.b64urlEncode(bytes);
    expect(enc).not.toMatch(/[+/=]/);
    const dec = _internal.b64urlDecode(enc);
    expect(Array.from(dec)).toEqual([0, 1, 2, 250, 251, 255]);
  });
});

describe("random", () => {
  it("produces distinct tokens and prefixed ids", () => {
    const a = randomToken(32);
    const b = randomToken(32);
    expect(a).not.toBe(b);
    expect(a.length).toBe(43); // 32 bytes -> 43 base64url chars
    const id = randomId("u");
    expect(id.startsWith("u_")).toBe(true);
    expect(id.length).toBeGreaterThan(10);
  });
});

describe("JWT", () => {
  it("signs and verifies round-trip", async () => {
    const token = await signAccessToken(SECRET, {
      sub: "u_abc",
      handle: "ada",
      guest: true,
    });
    const res = await verifyAccessToken(SECRET, token);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.claims.sub).toBe("u_abc");
      expect(res.claims.guest).toBe(true);
      expect(res.claims.iss).toBe("uno-by-j");
    }
  });

  it("rejects tampered payloads", async () => {
    const token = await signAccessToken(SECRET, { sub: "u_abc", handle: "ada", guest: true });
    const [h, p, s] = token.split(".");
    const payload = JSON.parse(
      new TextDecoder().decode(
        _internal.b64urlDecode(p!)
      )
    );
    payload.sub = "u_victim";
    const forged = `${h}.${_internal.b64urlEncode(
      new TextEncoder().encode(JSON.stringify(payload))
    )}.${s}`;
    const res = await verifyAccessToken(SECRET, forged);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("bad_signature");
  });

  it("rejects wrong-issuer/audience tokens", async () => {
    const token = await signAccessToken(SECRET, { sub: "u_x", handle: "x", guest: true });
    // Hand-craft a token with a foreign iss/aud but valid signature.
    const header = _internal.b64urlEncode(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
    const payload = _internal.b64urlEncode(
      new TextEncoder().encode(
        JSON.stringify({
          sub: "u_x",
          handle: "x",
          guest: true,
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 600,
          iss: "evil",
          aud: "evil-client",
        })
      )
    );
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${payload}`));
    const evil = `${header}.${payload}.${_internal.b64urlEncode(new Uint8Array(sig))}`;
    const res = await verifyAccessToken(SECRET, evil);
    expect(res.ok).toBe(false);
  });

  it("rejects garbage", async () => {
    expect((await verifyAccessToken(SECRET, "not-a-jwt")).ok).toBe(false);
    expect((await verifyAccessToken(SECRET, "a.b.c")).ok).toBe(false);
  });

  it("refresh hashes are stable and keyed", async () => {
    const h1 = await hashRefreshToken("tok");
    const h2 = await hashRefreshToken("tok");
    expect(h1).toBe(h2);
    expect(h1).not.toBe("tok");
  });
});
