import { randomToken } from "../util/crypto";

/** Unambiguous alphabet: no 0/O, 1/I/L, and no vowels to avoid accidental words. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LEN = 6;

export function generateRoomCode(): string {
  const bytes = new Uint8Array(CODE_LEN);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const b of bytes) code += ALPHABET[b % ALPHABET.length]!;
  return code;
}

/** Normalize user input: uppercase, strip separators/spaces. */
export function normalizeRoomCode(raw: string): string {
  return raw.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, "").slice(0, CODE_LEN);
}

export function isValidRoomCode(raw: string): boolean {
  return raw.length === CODE_LEN && /^[2-9A-HJ-NP-Z]{6}$/.test(raw);
}
