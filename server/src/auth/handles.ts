import { randomToken } from "../util/crypto";
import type { UserRepo } from "../domain/repos";

const DISPLAY_MIN = 2;
const DISPLAY_MAX = 24;
const HANDLE_MAX = 20;

/** Trim, strip control chars, collapse whitespace, clamp length; fallback keeps UX smooth. */
export function sanitizeDisplayName(raw: string | undefined | null): string {
  let s = (raw ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DISPLAY_MAX);
  if (s.length < DISPLAY_MIN) s = "Player";
  return s;
}

function handleBase(displayName: string): string {
  const base = displayName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, HANDLE_MAX);
  return base.length >= 3 ? base : "player";
}

/** Collision-safe handle generation: name, name+N, then random suffix. */
export async function generateUniqueHandle(
  users: UserRepo,
  displayName: string
): Promise<string> {
  const base = handleBase(displayName);
  if (!(await users.findByHandle(base))) return base;
  for (let n = 2; n < 50; n++) {
    const candidate = `${base}${n}`;
    if (!(await users.findByHandle(candidate))) return candidate;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${base}${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    if (candidate.length >= 3 && !(await users.findByHandle(candidate))) return candidate;
  }
  return `${base}${Date.now().toString(36)}`;
}
