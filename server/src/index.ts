/**
 * UNO by J — Cloudflare Worker entry point.
 * Statelessness WS upgrade and RoomDO forwarding arrive in Phase 6.
 */
import {
  makeRouter,
  jsonResponse,
  errorResponse,
  clientIpKey,
  readJsonBody,
} from "./net/router";
import type { Env, RouteContext } from "./net/router";
import { getAuthService } from "./auth/context";
import { getRoomService } from "./room/context";
import { INTERNAL_SECRET_HEADER } from "./room/do-helpers";
import type { User } from "./domain/types";
import { D1BlockRepo, D1ReportRepo } from "./db/chat";
import { badRequest, rateLimited } from "./domain/errors";

export { RoomDO } from "./room/do";

function requireUser(ctx: RouteContext): User {
  const u = ctx.user;
  if (!u) throw new Error("route marked auth but no user resolved");
  return u;
}

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

const routes = makeRouter(
  [
    {
      method: "POST",
      pattern: /^\/auth\/guest$/,
      auth: false,
      handler: async (ctx) => {
        const auth = getAuthService(ctx.env);
        const body = await readJsonBody(ctx.request);
        const pair = await auth.createGuest(
          typeof body.displayName === "string" ? body.displayName : undefined,
          clientIpKey(ctx.request)
        );
        return jsonResponse(pair, 201);
      },
    },
    {
      method: "POST",
      pattern: /^\/auth\/refresh$/,
      auth: false, // the refresh token itself is the credential
      handler: async (ctx) => {
        const auth = getAuthService(ctx.env);
        const body = await readJsonBody(ctx.request);
        const rt = typeof body.refreshToken === "string" ? body.refreshToken : "";
        const pair = await auth.refresh(rt);
        return jsonResponse(pair, 200);
      },
    },
    {
      method: "POST",
      pattern: /^\/auth\/logout$/,
      auth: false,
      handler: async (ctx) => {
        const auth = getAuthService(ctx.env);
        const body = await readJsonBody(ctx.request);
        const rt = typeof body.refreshToken === "string" ? body.refreshToken : "";
        await auth.logout(rt);
        return jsonResponse({ ok: true }, 200);
      },
    },
    {
      method: "GET",
      pattern: /^\/me$/,
      auth: true,
      handler: async (ctx) => {
        const auth = getAuthService(ctx.env);
        const user = requireUser(ctx);
        const me = await auth.me(user.id);
        return jsonResponse({ user: me }, 200);
      },
    },

    // ---- Rooms (Phase 4) ----
    {
      method: "POST",
      pattern: /^\/room$/,
      auth: true,
      handler: async (ctx) => {
        const rooms = getRoomService(ctx.env);
        const user = requireUser(ctx);
        const body = await readJsonBody(ctx.request);
        const view = await rooms.create(user, {
          isPublic: body.isPublic === true,
          isQuickplay: body.isQuickplay === true,
          maxPlayers: typeof body.maxPlayers === "number" ? body.maxPlayers : undefined,
          settings:
            typeof body.settings === "object" && body.settings !== null
              ? (body.settings as Record<string, never>)
              : undefined,
        });
        return jsonResponse({ room: view }, 201);
      },
    },
    {
      method: "POST",
      pattern: /^\/room\/quickplay$/,
      auth: true,
      handler: async (ctx) => {
        const rooms = getRoomService(ctx.env);
        const user = requireUser(ctx);
        const view = await rooms.quickplay(user);
        return jsonResponse({ room: view }, 200);
      },
    },
    {
      method: "POST",
      pattern: /^\/room\/([2-9A-HJ-NP-Z]{6})\/join$/i,
      auth: true,
      handler: async (ctx) => {
        const rooms = getRoomService(ctx.env);
        const user = requireUser(ctx);
        const code = ctx.url.pathname.match(/([2-9A-HJ-NP-Z]{6})\/join$/i)?.[1] ?? "";
        const view = await rooms.join(user, code);
        return jsonResponse({ room: view }, 200);
      },
    },
    {
      method: "POST",
      pattern: /^\/room\/([2-9A-HJ-NP-Z]{6})\/leave$/i,
      auth: true,
      handler: async (ctx) => {
        const rooms = getRoomService(ctx.env);
        const user = requireUser(ctx);
        const code = ctx.url.pathname.match(/([2-9A-HJ-NP-Z]{6})\/leave$/i)?.[1] ?? "";
        const result = await rooms.leave(user, code);
        return jsonResponse(result, 200);
      },
    },
    {
      method: "GET",
      pattern: /^\/room\/([2-9A-HJ-NP-Z]{6})$/i,
      auth: true,
      handler: async (ctx) => {
        const rooms = getRoomService(ctx.env);
        const user = requireUser(ctx);
        const code = ctx.url.pathname.match(/([2-9A-HJ-NP-Z]{6})$/i)?.[1] ?? "";
        const view = await rooms.getRoomIfMember(user, code);
        return jsonResponse({ room: view }, 200);
      },
    },
    {
      method: "GET",
      pattern: /^\/my\/rooms$/,
      auth: true,
      handler: async (ctx) => {
        const rooms = getRoomService(ctx.env);
        const user = requireUser(ctx);
        const list = await rooms.listMyRooms(user);
        return jsonResponse({ rooms: list }, 200);
      },
    },
    {
      method: "POST",
      pattern: /^\/room\/([2-9A-HJ-NP-Z]{6})\/start$/i,
      auth: true,
      handler: async (ctx) => {
        const rooms = getRoomService(ctx.env);
        const user = requireUser(ctx);
        const code = ctx.url.pathname.match(/([2-9A-HJ-NP-Z]{6})\/start$/i)?.[1] ?? "";
        const opts = await rooms.start(user, code);
        const stub = ctx.env.ROOM_DO.get(ctx.env.ROOM_DO.idFromName(opts.roomCode));
        const headers: Record<string, string> = {
          "content-type": "application/json",
          "x-room-code": opts.roomCode,
        };
        if (ctx.env.ROOM_INTERNAL_SECRET) {
          headers[INTERNAL_SECRET_HEADER] = ctx.env.ROOM_INTERNAL_SECRET;
        }
        const resp = await stub.fetch("https://room.internal/start", {
          method: "POST",
          headers,
          body: JSON.stringify(opts),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: { code: "SERVER_BUSY" } }));
          return jsonResponse(err, resp.status);
        }
        return jsonResponse(await resp.json(), 200);
      },
    },

    // ---- Moderation & Blocks (Phase 8) ----
    {
      method: "POST",
      pattern: /^\/block$/,
      auth: true,
      handler: async (ctx) => {
        const user = requireUser(ctx);
        const body = await readJsonBody(ctx.request);
        const targetUserId = typeof body.targetUserId === "string" ? body.targetUserId.trim() : "";
        if (!targetUserId || targetUserId === user.id) {
          throw badRequest("Invalid targetUserId");
        }
        const blockRepo = new D1BlockRepo(ctx.env.DB);
        await blockRepo.block(user.id, targetUserId, Date.now());
        return jsonResponse({ ok: true }, 200);
      },
    },
    {
      method: "DELETE",
      pattern: /^\/block\/([a-zA-Z0-9_-]+)$/,
      auth: true,
      handler: async (ctx) => {
        const user = requireUser(ctx);
        const targetUserId = ctx.url.pathname.match(/^\/block\/([a-zA-Z0-9_-]+)$/)?.[1] ?? "";
        if (!targetUserId) throw badRequest("Invalid targetUserId");
        const blockRepo = new D1BlockRepo(ctx.env.DB);
        await blockRepo.unblock(user.id, targetUserId);
        return jsonResponse({ ok: true }, 200);
      },
    },
    {
      method: "GET",
      pattern: /^\/blocks$/,
      auth: true,
      handler: async (ctx) => {
        const user = requireUser(ctx);
        const blockRepo = new D1BlockRepo(ctx.env.DB);
        const blockedUserIds = await blockRepo.listBlockedByUser(user.id);
        return jsonResponse({ blockedUserIds }, 200);
      },
    },
    {
      method: "POST",
      pattern: /^\/report$/,
      auth: true,
      handler: async (ctx) => {
        const user = requireUser(ctx);
        const body = await readJsonBody(ctx.request);
        const targetUserId = typeof body.targetUserId === "string" ? body.targetUserId.trim() : "";
        if (!targetUserId || targetUserId === user.id) {
          throw badRequest("Invalid targetUserId");
        }
        const category = typeof body.category === "string" ? body.category.toUpperCase() : "";
        const allowedCategories = ["HARASSMENT", "CHEATING", "SPAM", "OFFENSIVE", "OTHER"];
        if (!allowedCategories.includes(category)) {
          throw badRequest("Invalid report category");
        }
        const reportRepo = new D1ReportRepo(ctx.env.DB);
        const now = Date.now();
        const recentCount = await reportRepo.countRecentByReporter(user.id, now - 60_000);
        if (recentCount >= 5) {
          throw rateLimited();
        }
        const reportId = `rep_${crypto.randomUUID()}`;
        await reportRepo.insert({
          id: reportId,
          reporterUserId: user.id,
          targetUserId,
          roomCode: typeof body.roomCode === "string" ? body.roomCode : null,
          category: category as any,
          messageId: typeof body.messageId === "string" ? body.messageId : null,
          reason: typeof body.reason === "string" ? body.reason.slice(0, 500) : null,
          createdAt: now,
          status: "PENDING",
        });
        return jsonResponse({ ok: true, reportId }, 201);
      },
    },
  ],
  {
    authenticate: async (request, env) => {
      const auth = getAuthService(env);
      return auth.authenticate(bearerToken(request));
    },
  }
);

export default {
  async fetch(request: Request, env: Env, _ec: ExecutionContext): Promise<Response> {
    if (!env.JWT_SECRET) {
      // Fail fast: signing with an empty key would create forgeable tokens.
      console.error("misconfiguration: JWT_SECRET is not set (use `wrangler secret put JWT_SECRET`)");
      return jsonResponse(
        { error: { code: "SERVER_BUSY" } },
        500
      );
    }
    const url = new URL(request.url);
    const wsMatch = url.pathname.match(/^\/(?:room\/([2-9A-HJ-NP-Z]{6})\/ws|ws\/room\/([2-9A-HJ-NP-Z]{6}))$/i);
    if (wsMatch && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const code = (wsMatch[1] || wsMatch[2])!.toUpperCase();
      const id = env.ROOM_DO.idFromName(code);
      const stub = env.ROOM_DO.get(id);
      const forwardReq = new Request(request.url, {
        method: request.method,
        headers: new Headers(request.headers),
      });
      forwardReq.headers.set("x-room-code", code);
      return stub.fetch(forwardReq);
    }
    try {
      return await routes.handle(request, env);
    } catch (e) {
      return errorResponse(e);
    }
  },
} satisfies ExportedHandler<Env>;
