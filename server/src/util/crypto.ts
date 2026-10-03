/**
 * Cryptographic primitives for UNO by J — Cloudflare Workers runtime (WebCrypto only).
 *
 * Security properties:
 * - JWT access tokens: HS256, 15-minute expiry, secret only in Wrangler secrets.
 * - Refresh tokens: 256-bit random, stored SHA-256-hashed (raw value never persisted).
 * - All random values from crypto.getRandomValues (CSPRNG).
 */

const JWT_ISS = "uno-by-j";
const JWT_AUD = "uno-by-j-client";
export const ACCESS_TTL_S = 15 * 60; // 15 minutes
export const REFRESH_TTL_S = 30 * 24 * 60 * 60; // 30 days

const encoder = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  let bin: string;
  try {
    bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  } catch {
    throw new RangeError("invalid base64url");
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return b64urlEncode(buf);
}

export function randomId(prefix: string, bytes = 15): string {
  return `${prefix}_${randomToken(bytes)}`;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return b64urlEncode(new Uint8Array(digest));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export interface AccessClaims {
  sub: string;      // user id
  handle: string;
  guest: boolean;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

export async function signAccessToken(
  secret: string,
  claims: Omit<AccessClaims, "iat" | "exp" | "iss" | "aud">,
  nowS: number = Math.floor(Date.now() / 1000)
): Promise<string> {
  const payload: AccessClaims = {
    ...claims,
    iat: nowS,
    exp: nowS + ACCESS_TTL_S,
    iss: JWT_ISS,
    aud: JWT_AUD,
  };
  const header = { alg: "HS256", typ: "JWT" };
  const h = b64urlEncode(encoder.encode(JSON.stringify(header)));
  const p = b64urlEncode(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(`${h}.${p}`));
  return `${h}.${p}.${b64urlEncode(new Uint8Array(sig))}`;
}

export type VerifyResult =
  | { ok: true; claims: AccessClaims }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export async function verifyAccessToken(
  secret: string,
  token: string,
  nowS: number = Math.floor(Date.now() / 1000)
): Promise<VerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [h, p, sig] = parts as [string, string, string];
  const key = await hmacKey(secret);
  let sigBytes: Uint8Array;
  try {
    sigBytes = b64urlDecode(sig);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const expected = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${h}.${p}`)
  );
  // Constant-time-ish comparison via length check + difference accumulator.
  const a = new Uint8Array(expected);
  if (a.length !== sigBytes.length) return { ok: false, reason: "bad_signature" };
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ sigBytes[i]!;
  if (diff !== 0) return { ok: false, reason: "bad_signature" };
  let claims: AccessClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (claims.iss !== JWT_ISS || claims.aud !== JWT_AUD) {
    return { ok: false, reason: "bad_signature" };
  }
  if (typeof claims.exp !== "number" || claims.exp < nowS) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, claims };
}

/** Refresh tokens: opaque 256-bit random, persisted only as SHA-256. */
export async function hashRefreshToken(token: string): Promise<string> {
  return sha256Hex(`rt:${token}`);
}

// Re-exported for tests.
export const _internal = { b64urlEncode, b64urlDecode };
