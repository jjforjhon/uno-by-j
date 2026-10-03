import { AppError, ErrorCode, authRequired, badRequest } from "../domain/errors";
import type { User } from "../domain/types";
import type { AuthService } from "../auth/service";

/** Max accepted JSON body size — anything bigger is dropped before parsing. */
const MAX_BODY_BYTES = 4 * 1024;

export interface Env {
  DB: D1Database;
  ROOM_DO: DurableObjectNamespace;
  /** HS256 signing key — Wrangler secret, never committed. */
  JWT_SECRET: string;
  ROOM_INTERNAL_SECRET?: string;
  ENVIRONMENT?: string;
}

export interface RouteContext {
  env: Env;
  request: Request;
  url: URL;
  user?: User;
}

type Handler = (ctx: RouteContext) => Promise<Response>;

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...SECURITY_HEADERS },
  });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof AppError) {
    return jsonResponse({ error: { code: e.code } }, e.httpStatus);
  }
  // Log server-side only (Workers observability); never leak internals to the client.
  console.error("unhandled_error", e instanceof Error ? e.message : String(e));
  return jsonResponse({ error: { code: ErrorCode.SERVER_BUSY } }, 500);
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader && Number(lengthHeader) > MAX_BODY_BYTES) {
    throw badRequest("payload too large");
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    throw badRequest("unreadable body");
  }
  if (text.length > MAX_BODY_BYTES) throw badRequest("payload too large");
  if (text.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw badRequest("invalid body");
    }
    return parsed as Record<string, unknown>;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw badRequest("invalid json");
  }
}

/** Extract the client IP for rate limiting. Only CF's trusted header is used. */
export function clientIpKey(request: Request): string {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  return ip;
}

export function requireUser(ctx: RouteContext): User {
  if (!ctx.user) throw authRequired();
  return ctx.user;
}

export function makeRouter(
  routes: Array<{ method: string; pattern: RegExp; auth: boolean; handler: Handler }>,
  opts: { authenticate: (request: Request, env: Env) => Promise<User> }
) {
  return {
    async handle(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";
      for (const route of routes) {
        const match = route.pattern.exec(path);
        if (match && route.method === request.method) {
          const ctx: RouteContext = { env, request, url };
          if (route.auth) {
            const header = request.headers.get("authorization") ?? "";
            const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
            if (!token) throw authRequired();
            ctx.user = await opts.authenticate(request, env);
          }
          const response = await route.handler(ctx);
          for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
            response.headers.set(k, v);
          }
          return response;
        }
      }
      throw new AppError(ErrorCode.NOT_FOUND, 404);
    },
  };
}

export { readJsonBody };
