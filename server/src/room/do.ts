/**
 * RoomDO — the authoritative room. One instance per room (idFromName(code)).
 *
 * Responsibilities:
 *  - WebSocket lifecycle: hibernating sockets (free while idle), auto-response
 *    pings, lazy HELLO-deadline sweep via alarms, reconnect with SNAPSHOT.
 *  - Message routing: HELLO -> WELCOME + SNAPSHOT; game actions -> engine.apply();
 *    SYNC_REQ -> SNAPSHOT; app-level PING -> PONG (raw "PING-v1" never wakes us).
 *  - Ordering + idempotency: room `seq` strictly monotonic; retried
 *    (userId, actionId) pairs get the original ACK, never a second execution.
 *  - Turn deadlines: storage.setAlarm(turnDeadlineAt) -> engine TIMEOUT_TURN.
 *  - Crash recovery: GameState + seq + dedupe persisted to DO SQLite after
 *    every mutation; rehydrated lazily on first access.
 *
 * Security model: the DO re-verifies EVERYTHING (JWT, membership) — it trusts
 * no caller, not even the Worker. Hands never leave the engine except through
 * gameView(), which serializes only the viewer's own hand.
 */
import { verifyAccessToken } from "../util/crypto";
import { cryptoRng } from "../util/rng";
import { RuleError } from "../engine/types";
import { apply } from "../engine/actions";
import { startGame } from "../engine/state";
import { gameView } from "../engine/views";
import type { GameEvent, GameState, PlayerState } from "../engine/types";
import type { StartRoomOptions, RoomView } from "../domain/rooms";
import type { ChatMessage } from "../domain/chat";
import {
  PROTOCOL_VERSION,
  HELLO_TIMEOUT_S,
  IDEMPOTENCY_TTL_MS,
  IDEMPOTENCY_MAX_PER_PLAYER,
  MSG_RATE_LIMIT,
  MAX_PLAYERS_HARD,
  MAX_WS_FRAME_BYTES,
  INTERNAL_SECRET_HEADER,
  mapRuleCode,
  decodeClientMessage,
} from "./do-helpers";
import type { Conn, DedupeEntry, ServerEnvelope, WsErrorCode, OutEvent } from "./do-helpers";

// ---------- persisted keys (DO SQLite) ----------

const K_GAME = "game";
const K_SEQ = "seq";
const K_DEDUPE = "dedupe";

/** Socket tag prefixes (survive hibernation — the only per-socket memory). */
const TAG_OPENED = "o:";
const TAG_ROOM = "r:";

interface SocketAttachment {
  userId?: string;
  roomCode?: string;
  openedAt?: number;
}

function getAttachment(ws: WebSocket): SocketAttachment {
  try {
    return (ws.deserializeAttachment() as SocketAttachment | null) ?? {};
  } catch {
    return {};
  }
}

function setAttachment(ws: WebSocket, att: SocketAttachment): void {
  try {
    ws.serializeAttachment(att);
  } catch {
    /* socket closing or unsupported */
  }
}

function tagValue(tags: string[], prefix: string): string | undefined {
  return tags.find((t) => t.startsWith(prefix))?.slice(prefix.length);
}

function randomGameId(): string {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  return `g_${Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

interface InternalNotifyBody {
  kind: "PLAYER_JOINED" | "PLAYER_LEFT";
  userId: string;
  room: RoomView;
}

export class RoomDO {
  /** Lazily-loaded authoritative state (undefined = not loaded, null = none). */
  private game: GameState | null | undefined;
  private seq = 0;
  private dedupe = new Map<string, DedupeEntry>();
  private loaded = false;
  private cachedRoomCode?: string;
  private chatRateLimits = new Map<string, number[]>();
  private socketRateLimits = new Map<WebSocket, number[]>();

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: { DB: D1Database; JWT_SECRET: string; ROOM_INTERNAL_SECRET?: string }
  ) {}

  /** Room code = tag or header or game state or idFromName name. */
  private roomCode(target?: WebSocket | Request): string {
    if (target instanceof Request) {
      const fromHeader = target.headers.get("x-room-code");
      if (fromHeader) {
        this.cachedRoomCode = fromHeader;
        return fromHeader;
      }
    } else if (target) {
      const att = getAttachment(target);
      if (att.roomCode) {
        this.cachedRoomCode = att.roomCode;
        return att.roomCode;
      }
      const fromTag = tagValue(this.state.getTags(target), TAG_ROOM);
      if (fromTag) {
        this.cachedRoomCode = fromTag;
        return fromTag;
      }
    }
    return this.cachedRoomCode || this.state.id.name || this.game?.roomCode || "";
  }

  // ============================================================
  // HTTP surface
  // ============================================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
        return await this.handleUpgrade(request);
      }
      if (request.method === "POST" && url.pathname === "/start") {
        return await this.handleStart(request);
      }
      if (request.method === "POST" && url.pathname === "/notify") {
        return await this.handleNotify(request);
      }
      if (request.method === "POST" && url.pathname === "/test/reset") {
        this.game = null;
        this.socketRateLimits.clear();
        this.chatRateLimits.clear();
        for (const ws of this.state.getWebSockets()) {
          try {
            ws.close(1000, "reset");
          } catch {}
        }
        await this.state.storage.deleteAlarm();
        return Response.json({ ok: true });
      }
      return new Response("not found", { status: 404 });
    } catch (e) {
      console.error("RoomDO.fetch_error", e instanceof Error ? e.message : String(e));
      return new Response("internal error", { status: 500 });
    }
  }

  // ---------- start (Worker bridge; HTTP route did host authorization) ----

  private async handleStart(request: Request): Promise<Response> {
    if (!this.internalAuthorized(request)) return new Response("forbidden", { status: 403 });
    const opts = (await request.json()) as StartRoomOptions;
    if (!opts || typeof opts.roomCode !== "string" || opts.roomCode.length !== 6) {
      return new Response("bad request", { status: 400 });
    }

    await this.ensureLoaded();
    // Idempotent start: a live round is never re-dealt (rematch = start after
    // ROUND_OVER, which re-deals from the CURRENT D1 membership).
    if (this.game && this.game.status === "PLAYING") {
      return Response.json({ ok: true, alreadyPlaying: true });
    }

    // Membership is re-resolved NOW — current at start time, not HTTP time.
    const members = await this.activeMembers(opts.roomCode);
    if (members.length < 2) {
      return Response.json({ error: { code: "BAD_REQUEST" } }, { status: 400 });
    }

    const now = Date.now();
    const players: PlayerState[] = members.map((m, seat) => ({
      userId: m.userId,
      seat,
      displayName: m.displayName,
      hand: [],
      connected: false,
      left: false,
      hasCalledUno: false,
    }));

    const fresh = startGame({
      gameId: randomGameId(),
      roomCode: opts.roomCode,
      players,
      settings: {
        turnTimeoutS: opts.settings.turnTimeoutS > 0 ? opts.settings.turnTimeoutS : 30,
      },
      now,
      rng: cryptoRng(),
    });

    this.game = fresh;
    this.dedupe.clear();
    await this.persistAll();

    await this.broadcast(
      [
        { kind: "GAME_STARTED", playerCount: players.length, firstPlayerId: players[0]!.userId },
        { kind: "TURN_CHANGED", playerId: players[0]!.userId, deadlineAt: fresh.turnDeadlineAt },
      ],
      now
    );
    await this.armAlarm();
    return Response.json({ ok: true });
  }

  // ---------- lobby notifications (join/leave while sockets are open) ----

  private async handleNotify(request: Request): Promise<Response> {
    if (!this.internalAuthorized(request)) return new Response("forbidden", { status: 403 });
    const body = (await request.json()) as InternalNotifyBody;
    if (
      (body.kind !== "PLAYER_JOINED" && body.kind !== "PLAYER_LEFT") ||
      typeof body.userId !== "string"
    ) {
      return new Response("bad request", { status: 400 });
    }

    await this.ensureLoaded();
    const now = Date.now();
    const name =
      body.room.members.find((m) => m.userId === body.userId)?.displayName ?? body.userId;

    if (body.kind === "PLAYER_LEFT") {
      if (this.game && this.game.players.some((p) => p.userId === body.userId && !p.left)) {
        const events = apply(this.game, { type: "LEAVE", playerId: body.userId }, now, cryptoRng());
        await this.persistAll();
        await this.broadcast(events, now);
      }
      await this.broadcast({ kind: "PLAYER_LEFT", userId: body.userId }, now);
      return Response.json({ ok: true });
    }

    // PLAYER_JOINED: lobby event always; engine seat only for a live round
    // with room to spare (late joiners get cards at the next round start).
    await this.broadcast(
      { kind: "PLAYER_JOINED", userId: body.userId, displayName: name },
      now
    );
    if (
      this.game &&
      this.game.status === "PLAYING" &&
      !this.game.players.some((p) => p.userId === body.userId) &&
      this.game.players.length < MAX_PLAYERS_HARD
    ) {
      this.game.players.push({
        userId: body.userId,
        seat: this.game.players.length,
        displayName: name,
        hand: [],
        connected: false,
        left: false,
        hasCalledUno: false,
      });
      await this.persistAll();
    }
    return Response.json({ ok: true });
  }

  // ============================================================
  // WebSocket upgrade (hibernation API — no long-lived listeners)
  // ============================================================

  private async handleUpgrade(request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const server = pair[1];
    const openedAt = Date.now().toString();
    const code = this.roomCode(request);
    this.cachedRoomCode = code;

    // Free keepalive: the runtime answers "PING-v1" with "PONG-v1" WITHOUT
    // waking the DO (hibernation-preserving heartbeat).
    this.state.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(`PING-v${PROTOCOL_VERSION}`, `PONG-v${PROTOCOL_VERSION}`)
    );
    this.state.acceptWebSocket(server, [`${TAG_OPENED}${openedAt}`, `${TAG_ROOM}${code}`]);
    setAttachment(server, { roomCode: code, openedAt: Number(openedAt) });

    // Make sure the HELLO sweep runs even if every client goes silent.
    await this.armAlarm();

    // `server` is serialized into the 101 response; class methods
    // (webSocketMessage/webSocketClose/webSocketError) receive events from
    // now on — including after hibernation.
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private closeWs(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      /* already closing */
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string" || message.length > MAX_WS_FRAME_BYTES) {
      // Binary frames and oversized messages are never valid in this protocol.
      this.wsError(ws, undefined, "BAD_MESSAGE");
      return;
    }
    const att = getAttachment(ws);
    const userId = att.userId;
    const openedAt = att.openedAt ?? Number(tagValue(this.state.getTags(ws), TAG_OPENED) ?? 0);
    let rate = this.socketRateLimits.get(ws);
    if (!rate) {
      rate = [];
      this.socketRateLimits.set(ws, rate);
    }
    const conn: Conn = { ws, userId, openedAt, rate, closed: false };
    await this.onMessage(conn, message);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.socketRateLimits.delete(ws);
    this.closeWs(ws, 1000, "closed");
    const att = getAttachment(ws);
    const userId = att.userId;
    if (!userId) return;
    // Multi-device safe: only mark disconnected if no other socket of this user.
    const otherOpen = this.state.getWebSockets().some((w) => {
      if (w === ws) return false;
      return getAttachment(w).userId === userId;
    });
    if (otherOpen) return;
    await this.ensureLoaded();
    const now = Date.now();
    if (this.game) {
      const player = this.game.players.find((p) => p.userId === userId);
      if (player && player.connected) {
        const events = apply(
          this.game,
          { type: "PRESENCE", playerId: userId, connected: false },
          now,
          cryptoRng()
        );
        try {
          await this.persistAll();
          await this.broadcast(events, now);
          await this.broadcast({ kind: "PLAYER_DISCONNECTED", userId }, now);
        } catch {
          // DO may be aborting or shutting down; ignore teardown persistence errors
        }
      }
    } else {
      try {
        await this.broadcast({ kind: "PLAYER_DISCONNECTED", userId }, now);
      } catch {
        // teardown ignore
      }
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.socketRateLimits.delete(ws);
    await this.webSocketClose(ws);
  }

  // ============================================================
  // Message loop
  // ============================================================

  private async onMessage(conn: Conn, raw: string): Promise<void> {
    const now = Date.now();

    // Per-socket rate cap (docs/PROTOCOL.md: 10 msg/s).
    conn.rate = conn.rate.filter((t) => now - t < 1000);
    this.socketRateLimits.set(conn.ws, conn.rate);
    if (conn.rate.length >= MSG_RATE_LIMIT) {
      this.wsError(conn.ws, undefined, "RATE_LIMITED");
      return;
    }
    conn.rate.push(now);

    const decoded = decodeClientMessage(raw);
    if (!decoded.ok) {
      this.wsError(conn.ws, undefined, "BAD_MESSAGE");
      if (decoded.error === "VERSION") this.closeWs(conn.ws, 4002, "version mismatch");
      return;
    }
    const msg = decoded.msg;

    // First message MUST be HELLO (auth gate; docs/PROTOCOL.md).
    if (!conn.userId && msg.type !== "HELLO") {
      this.closeWs(conn.ws, 4001, "expected HELLO");
      return;
    }

    try {
      switch (msg.type) {
        case "HELLO":
          await this.onHello(conn, msg.token, now);
          return;
        case "PING":
          this.send(conn.ws, { v: PROTOCOL_VERSION, type: "PONG", reqId: msg.reqId, d: {} });
          return;
        case "SYNC_REQ":
          await this.onSyncReq(conn, msg);
          return;
        case "LEAVE":
          await this.onLeave(conn, msg.reqId);
          return;
        case "PLAY_CARD":
          await this.onGameAction(conn, now, msg.reqId, msg.actionId, () => ({
            type: "PLAY_CARD",
            playerId: conn.userId!,
            cardId: msg.cardId,
            chosenColor: msg.chosenColor,
          }));
          return;
        case "DRAW_CARD":
          await this.onGameAction(conn, now, msg.reqId, msg.actionId, () => ({
            type: "DRAW_CARD",
            playerId: conn.userId!,
          }));
          return;
        case "PASS":
          await this.onGameAction(conn, now, msg.reqId, msg.actionId, () => ({
            type: "PASS",
            playerId: conn.userId!,
          }));
          return;
        case "CALL_UNO":
          await this.onGameAction(conn, now, msg.reqId, msg.actionId, () => ({
            type: "CALL_UNO",
            playerId: conn.userId!,
          }));
          return;
        case "CATCH_UNO":
          await this.onGameAction(conn, now, msg.reqId, msg.actionId, () => ({
            type: "CATCH_UNO",
            playerId: conn.userId!,
            targetPlayerId: msg.targetPlayerId,
          }));
          return;
        case "CHAT_SEND":
          await this.onChatSend(conn, msg.reqId, msg.text, now);
          return;
      }
    } catch (e) {
      if (e instanceof RuleError) {
        this.wsError(conn.ws, "reqId" in msg ? msg.reqId : undefined, mapRuleCode(e.code));
        return;
      }
      console.error("RoomDO.message_error", e instanceof Error ? e.message : String(e));
      this.wsError(conn.ws, "reqId" in msg ? msg.reqId : undefined, "SERVER_BUSY");
    }
  }

  // ---------- HELLO / WELCOME / SNAPSHOT ----------

  private async onHello(conn: Conn, token: string, now: number): Promise<void> {
    // 1. JWT (10 s HELLO window enforced via the o: tag + alarm sweep).
    if (Date.now() - conn.openedAt > HELLO_TIMEOUT_S * 1000) {
      this.closeWs(conn.ws, 4001, "HELLO timeout");
      return;
    }
    const verify = await verifyAccessToken(this.env.JWT_SECRET, token, Math.floor(now / 1000));
    if (!verify.ok) {
      this.wsError(conn.ws, undefined, verify.reason === "expired" ? "AUTH_EXPIRED" : "AUTH_REQUIRED");
      this.closeWs(conn.ws, 3000, "auth failed");
      return;
    }
    const userId = verify.claims.sub;

    // 2. Room exists + active membership (D1 is the source of truth).
    const code = this.roomCode();
    const room = await this.findRoom(code);
    if (!room) {
      this.wsError(conn.ws, undefined, "ROOM_NOT_FOUND");
      this.closeWs(conn.ws, 3000, "no such room");
      return;
    }
    const role = await this.getRole(code, userId);
    if (!role) {
      this.wsError(conn.ws, undefined, "NOT_MEMBER");
      this.closeWs(conn.ws, 3000, "not a member");
      return;
    }

    // 3. Presence: mark connected; seat late joiners of a live round.
    await this.ensureLoaded();
    if (this.game) {
      const player = this.game.players.find((p) => p.userId === userId);
      if (player) {
        if (!player.connected) {
          const events = apply(
            this.game,
            { type: "PRESENCE", playerId: userId, connected: true },
            now,
            cryptoRng()
          );
          await this.persistAll();
          await this.broadcast(events, now);
          await this.broadcast({ kind: "PLAYER_RECONNECTED", userId }, now);
        }
      } else if (
        this.game.status === "PLAYING" &&
        this.game.players.length < MAX_PLAYERS_HARD
      ) {
        this.game.players.push({
          userId,
          seat: this.game.players.length,
          displayName: verify.claims.handle || userId,
          hand: [],
          connected: true,
          left: false,
          hasCalledUno: false,
        });
        await this.persistAll();
      }
    }

    // 4. Record authenticated user in socket attachment (hibernation-safe).
    conn.userId = userId;
    setAttachment(conn.ws, {
      userId,
      roomCode: code,
      openedAt: conn.openedAt,
    });

    // 5. WELCOME + full personal SNAPSHOT — join AND reconnect both land here.
    this.send(conn.ws, {
      v: PROTOCOL_VERSION,
      type: "WELCOME",
      d: {
        you: { userId, seat: this.game?.players.find((p) => p.userId === userId)?.seat ?? null },
        roomSeq: this.seq,
      },
    });
    const snapshot = await this.snapshotFor(userId, code);
    if (snapshot) this.send(conn.ws, snapshot);
  }

  private async onSyncReq(conn: Conn, msg: { reqId: string; sinceSeq: number }): Promise<void> {
    await this.ensureLoaded();
    if (msg.sinceSeq >= this.seq) {
      // Nothing missed — ACK so the client stops resyncing.
      this.send(conn.ws, { v: PROTOCOL_VERSION, type: "ACK", reqId: msg.reqId, d: { ok: true } });
      return;
    }
    // Individual seqs are never replayed; a fresh SNAPSHOT supersedes.
    const snapshot = await this.snapshotFor(conn.userId!, this.roomCode());
    if (snapshot) this.send(conn.ws, snapshot);
  }

  // ---------- game actions ----------

  private async onGameAction(
    conn: Conn,
    now: number,
    reqId: string,
    actionId: string,
    build: () => Parameters<typeof apply>[1]
  ): Promise<void> {
    await this.ensureLoaded();
    if (!this.game) {
      this.wsError(conn.ws, reqId, "GAME_NOT_STARTED");
      return;
    }
    const me = conn.userId!;

    // Idempotency: a retried actionId returns the original outcome.
    const key = `${me}:${actionId}`;
    const prior = this.dedupe.get(key);
    if (prior) {
      this.send(conn.ws, {
        v: PROTOCOL_VERSION,
        type: "ACK",
        reqId,
        d: { ok: prior.applied, seq: prior.seq, duplicate: true },
      });
      return;
    }

    const events = apply(this.game, build(), now, cryptoRng());
    await this.broadcast(events, now);
    this.rememberAction(key, now, this.seq, true);
    await this.persistAll();
    this.send(conn.ws, { v: PROTOCOL_VERSION, type: "ACK", reqId, d: { ok: true, seq: this.seq } });
    await this.armAlarm();
  }

  private async onLeave(conn: Conn, reqId: string): Promise<void> {
    const me = conn.userId!;
    const code = this.roomCode();
    await this.ensureLoaded();

    if (this.game && this.game.players.some((p) => p.userId === me && !p.left)) {
      const now = Date.now();
      const events = apply(this.game, { type: "LEAVE", playerId: me }, now, cryptoRng());
      await this.broadcast(events, now);
      await this.broadcast({ kind: "PLAYER_LEFT", userId: me }, now);
    }
    await this.leaveD1(code, me);
    await this.persistAll();

    // Room may have closed (last member) or re-hosted — push the fresh view.
    const room = await this.findRoomView(code);
    if (room) await this.broadcast({ kind: "ROOM_UPDATED", room }, Date.now());

    this.send(conn.ws, { v: PROTOCOL_VERSION, type: "ACK", reqId, d: { ok: true } });
    this.closeWs(conn.ws, 1000, "leaving");
    await this.armAlarm();
  }

  // ============================================================
  // Fan-out: seq assignment + routing + per-user sanitization
  // ============================================================

  /**
   * Assign the next seq to an event and route it:
   *  - DRAWN_SECRET -> only the subject (as their fresh SNAPSHOT)
   *  - ROUND_ENDED  -> everyone + their final SNAPSHOT
   *  - everything else -> everyone (public info only)
   * Returns the highest seq assigned.
   */
  private async broadcast(events: OutEvent | OutEvent[], now: number): Promise<number> {
    const list = Array.isArray(events) ? events : [events];
    for (const ev of list) {
      this.seq += 1;
      if (ev.kind === "DRAWN_SECRET") {
        // The subject's snapshot carries the drawn cards inside their hand;
        // everyone else received the accompanying DRAWN_PUBLIC. The secret
        // event itself is NEVER serialized to non-subjects.
        const snap = await this.snapshotFor(ev.playerId, this.roomCode());
        if (snap) this.deliver(ev.playerId, snap);
        continue;
      }
      if (ev.kind === "ROUND_ENDED") {
        await this.onRoundEnded(ev, now);
        continue;
      }
      this.sendAll({ v: PROTOCOL_VERSION, type: "EVENT", seq: this.seq, d: ev });
    }
    await this.persistSeq();
    return this.seq;
  }

  private async onRoundEnded(
    ev: Extract<GameEvent, { kind: "ROUND_ENDED" }>,
    _now: number
  ): Promise<void> {
    // Result to everyone, then each player's final snapshot (their last hand).
    this.sendAll({ v: PROTOCOL_VERSION, type: "EVENT", seq: this.seq, d: ev });
    const code = this.roomCode();
    for (const ws of this.state.getWebSockets()) {
      const userId = getAttachment(ws).userId;
      if (!userId) continue;
      const snap = await this.snapshotFor(userId, code);
      if (snap) this.send(ws, snap);
    }

    // Room flips back to WAITING for a rematch (D1 + lobby event).
    const room = await this.markWaiting(code);
    if (room) {
      this.seq += 1;
      this.sendAll({ v: PROTOCOL_VERSION, type: "EVENT", seq: this.seq, d: { kind: "ROOM_UPDATED", room } });
      await this.persistSeq();
    }
  }

  /** Personal SNAPSHOT: sanitized game view + fresh room view. */
  private async snapshotFor(userId: string, code: string): Promise<ServerEnvelope | null> {
    const room = await this.findRoomView(code);
    const game = this.game ? gameView(this.game, userId) : null;
    const chat = await this.findRecentChat(code);
    if (!room && !game) return null;
    return {
      v: PROTOCOL_VERSION,
      type: "SNAPSHOT",
      seq: this.seq,
      d: { room, game, chat },
    };
  }

  /** Deliver to every open socket of one user (multi-device safe). */
  private deliver(userId: string, msg: ServerEnvelope): void {
    for (const ws of this.state.getWebSockets()) {
      if (getAttachment(ws).userId === userId) {
        this.send(ws, msg);
      }
    }
  }

  private sendAll(msg: ServerEnvelope): void {
    for (const ws of this.state.getWebSockets()) {
      this.send(ws, msg);
    }
  }

  private send(ws: WebSocket, msg: ServerEnvelope): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket closing; webSocketClose will fire */
    }
  }

  // ============================================================
  // Alarms: turn deadlines + HELLO sweep
  // ============================================================

  /** Arm the next alarm = min(turn deadline, pending-HELLO sweep deadline). */
  private async armAlarm(): Promise<void> {
    const now = Date.now();
    const candidates: number[] = [];

    if (this.game && this.game.status === "PLAYING") {
      candidates.push(this.game.turnDeadlineAt);
    }
    let pendingHello = false;
    for (const ws of this.state.getWebSockets()) {
      const att = getAttachment(ws);
      if (!att.userId) {
        pendingHello = true;
        candidates.push(now + HELLO_TIMEOUT_S * 1000);
      }
    }
    void pendingHello;

    const current = await this.state.storage.getAlarm();
    const next = candidates.length > 0 ? Math.min(...candidates) : null;
    if (next === null) {
      if (current !== null) await this.state.storage.deleteAlarm();
      return;
    }
    // Alarms fire at whole seconds; keep re-arming on each mutation anyway.
    if (current === null || Math.abs(current - next) > 500) {
      await this.state.storage.setAlarm(next);
    }
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    await this.ensureLoaded();

    // 1. Sweep sockets that never said HELLO within the window.
    for (const ws of this.state.getWebSockets()) {
      const att = getAttachment(ws);
      if (att.userId) continue;
      const openedAt = att.openedAt ?? Number(tagValue(this.state.getTags(ws), TAG_OPENED) ?? 0);
      if (now - openedAt > HELLO_TIMEOUT_S * 1000) {
        this.closeWs(ws, 4001, "HELLO timeout");
      }
    }

    // 2. Turn deadline: stale alarms ignored inside the engine.
    if (this.game && this.game.status === "PLAYING" && now >= this.game.turnDeadlineAt) {
      const events = apply(this.game, { type: "TIMEOUT_TURN" }, now, cryptoRng());
      await this.broadcast(events, now);
      await this.persistAll();
    }

    await this.armAlarm();
  }

  // ============================================================
  // Persistence (DO SQLite) + lazy hydration
  // ============================================================

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const [game, seq, dedupe] = await Promise.all([
      this.state.storage.get<GameState>(K_GAME),
      this.state.storage.get<number>(K_SEQ),
      this.state.storage.get<Array<[string, DedupeEntry]>>(K_DEDUPE),
    ]);
    this.game = game ?? null;
    this.seq = seq ?? 0;
    this.dedupe = new Map(dedupe ?? []);
  }

  private async persistAll(): Promise<void> {
    await this.state.storage.put({
      [K_GAME]: this.game,
      [K_SEQ]: this.seq,
      [K_DEDUPE]: [...this.dedupe.entries()],
    });
  }

  private async persistSeq(): Promise<void> {
    await this.state.storage.put(K_SEQ, this.seq);
  }

  // ============================================================
  // D1 access (the DO re-verifies everything itself)
  // ============================================================

  private async findRoom(code: string): Promise<{ code: string } | null> {
    const row = await this.env.DB.prepare(`SELECT code FROM rooms WHERE code = ?1`)
      .bind(code)
      .first<{ code: string }>();
    return row ?? null;
  }

  private async getRole(code: string, userId: string): Promise<string | null> {
    const row = await this.env.DB.prepare(
      `SELECT role FROM room_members WHERE room_code = ?1 AND user_id = ?2 AND left_at IS NULL`
    )
      .bind(code, userId)
      .first<{ role: string }>();
    return row?.role ?? null;
  }

  private async activeMembers(code: string): Promise<Array<{ userId: string; displayName: string }>> {
    const { results } = await this.env.DB.prepare(
      `SELECT rm.user_id, u.display_name
       FROM room_members rm JOIN users u ON u.id = rm.user_id
       WHERE rm.room_code = ?1 AND rm.left_at IS NULL
       ORDER BY rm.joined_at ASC`
    )
      .bind(code)
      .all<{ user_id: string; display_name: string }>();
    return (results ?? []).map((r) => ({ userId: r.user_id, displayName: r.display_name }));
  }

  private async findRoomView(code: string): Promise<RoomView | null> {
    const room = await this.env.DB.prepare(
      `SELECT code, host_user_id, is_public, status, max_players, settings_json
       FROM rooms WHERE code = ?1`
    )
      .bind(code)
      .first<{
        code: string;
        host_user_id: string;
        is_public: number;
        status: string;
        max_players: number;
        settings_json: string;
      }>();
    if (!room) return null;
    const { results } = await this.env.DB.prepare(
      `SELECT rm.user_id, rm.role, u.handle, u.display_name, u.avatar_id
       FROM room_members rm JOIN users u ON u.id = rm.user_id
       WHERE rm.room_code = ?1 AND rm.left_at IS NULL
       ORDER BY rm.joined_at ASC`
    )
      .bind(code)
      .all<{ user_id: string; role: string; handle: string; display_name: string; avatar_id: number }>();
    return {
      code: room.code,
      hostUserId: room.host_user_id,
      isPublic: room.is_public === 1,
      status: room.status as RoomView["status"],
      maxPlayers: room.max_players,
      settings: safeSettings(room.settings_json),
      members: (results ?? []).map((m) => ({
        userId: m.user_id,
        handle: m.handle,
        displayName: m.display_name,
        avatarId: m.avatar_id,
        role: m.role as "HOST" | "MEMBER",
        isHost: m.role === "HOST",
      })),
    };
  }

  /** WS LEAVE: same rules as RoomService.leave (host migration, close). */
  private async leaveD1(code: string, userId: string): Promise<void> {
    const now = Date.now();
    const member = await this.env.DB.prepare(
      `SELECT role FROM room_members WHERE room_code = ?1 AND user_id = ?2 AND left_at IS NULL`
    )
      .bind(code, userId)
      .first<{ role: string }>();
    if (!member) return;

    await this.env.DB.prepare(
      `UPDATE room_members SET left_at = ?3 WHERE room_code = ?1 AND user_id = ?2 AND left_at IS NULL`
    )
      .bind(code, userId, now)
      .run();

    if (member.role === "HOST") {
      const next = await this.env.DB.prepare(
        `SELECT user_id FROM room_members WHERE room_code = ?1 AND left_at IS NULL
         ORDER BY joined_at ASC LIMIT 1`
      )
        .bind(code)
        .first<{ user_id: string }>();
      if (next) {
        await this.env.DB.prepare(
          `UPDATE room_members SET role = 'HOST' WHERE room_code = ?1 AND user_id = ?2 AND left_at IS NULL`
        )
          .bind(code, next.user_id)
          .run();
        await this.env.DB.prepare(`UPDATE rooms SET host_user_id = ?2 WHERE code = ?1`)
          .bind(code, next.user_id)
          .run();
      }
    }

    const remaining = await this.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM room_members WHERE room_code = ?1 AND left_at IS NULL`
    )
      .bind(code)
      .first<{ n: number }>();
    if ((remaining?.n ?? 0) === 0) {
      await this.env.DB.prepare(`UPDATE rooms SET status = 'CLOSED', closed_at = ?2 WHERE code = ?1`)
        .bind(code, now)
        .run();
    }
  }

  /** Round ended -> room back to WAITING for a rematch. */
  private async markWaiting(code: string): Promise<RoomView | null> {
    const room = await this.env.DB.prepare(`SELECT status FROM rooms WHERE code = ?1`)
      .bind(code)
      .first<{ status: string }>();
    if (!room || room.status !== "PLAYING") return null;
    await this.env.DB.prepare(`UPDATE rooms SET status = 'WAITING' WHERE code = ?1`)
      .bind(code)
      .run();
    return this.findRoomView(code);
  }

  // ============================================================
  // Small helpers
  // ============================================================

  private internalAuthorized(request: Request): boolean {
    const expected = this.env.ROOM_INTERNAL_SECRET;
    if (!expected) return true; // dev/test: no internal secret configured
    return request.headers.get(INTERNAL_SECRET_HEADER) === expected;
  }

  private rememberAction(key: string, now: number, seq: number, applied: boolean): void {
    // Prune expired entries, then cap per player (FIFO by time).
    const cutoff = now - IDEMPOTENCY_TTL_MS;
    for (const [k, e] of this.dedupe) {
      if (e.at < cutoff) this.dedupe.delete(k);
    }
    const playerId = key.split(":")[0]!;
    const mine = [...this.dedupe.entries()].filter(([k]) => k.startsWith(`${playerId}:`));
    if (mine.length >= IDEMPOTENCY_MAX_PER_PLAYER) {
      mine.sort((a, b) => a[1].at - b[1].at);
      for (let i = 0; i <= mine.length - IDEMPOTENCY_MAX_PER_PLAYER; i++) {
        this.dedupe.delete(mine[i]![0]);
      }
    }
    this.dedupe.set(key, { at: now, seq, applied });
  }

  private wsError(ws: WebSocket, reqId: string | undefined, code: WsErrorCode): void {
    this.send(ws, { v: PROTOCOL_VERSION, type: "ERROR", reqId, d: { code } });
  }

  private async onChatSend(conn: Conn, reqId: string, text: string, now: number): Promise<void> {
    const me = conn.userId!;
    const code = this.roomCode();

    // Check chat rate limit: max 5 messages per 10 seconds
    const timestamps = (this.chatRateLimits.get(me) ?? []).filter((t) => now - t < 10_000);
    if (timestamps.length >= 5) {
      this.wsError(conn.ws, reqId, "RATE_LIMITED");
      return;
    }
    timestamps.push(now);
    this.chatRateLimits.set(me, timestamps);

    const room = await this.findRoomView(code);
    const member = room?.members.find((m) => m.userId === me);
    const senderName = member?.displayName ?? "Player";

    const msgId = `m_${crypto.randomUUID()}`;
    const chatMsg: ChatMessage = {
      id: msgId,
      roomCode: code,
      senderUserId: me,
      senderName,
      body: text,
      createdAt: now,
    };

    await this.persistChatMessage(chatMsg);

    await this.broadcast(
      {
        kind: "CHAT_MESSAGE",
        id: msgId,
        senderUserId: me,
        senderDisplayName: senderName,
        body: text,
        createdAt: now,
      },
      now
    );

    this.send(conn.ws, {
      v: PROTOCOL_VERSION,
      type: "ACK",
      reqId,
      d: { ok: true, seq: this.seq, messageId: msgId },
    });
  }

  private async persistChatMessage(msg: ChatMessage): Promise<void> {
    try {
      await this.env.DB.prepare(
        `INSERT INTO chat_messages (id, room_code, sender_user_id, sender_name, body, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
      )
        .bind(msg.id, msg.roomCode, msg.senderUserId, msg.senderName, msg.body, msg.createdAt)
        .run();
    } catch (e) {
      console.error("RoomDO.persistChatMessage failed", e);
    }
  }

  private async findRecentChat(code: string, limit = 50): Promise<ChatMessage[]> {
    try {
      const { results } = await this.env.DB.prepare(
        `SELECT * FROM chat_messages WHERE room_code = ?1 ORDER BY created_at DESC LIMIT ?2`
      )
        .bind(code, limit)
        .all<{
          id: string;
          room_code: string;
          sender_user_id: string;
          sender_name: string;
          body: string;
          created_at: number;
        }>();
      return (results ?? [])
        .map((r) => ({
          id: r.id,
          roomCode: r.room_code,
          senderUserId: r.sender_user_id,
          senderName: r.sender_name,
          body: r.body,
          createdAt: r.created_at,
        }))
        .reverse();
    } catch {
      return [];
    }
  }
}

function safeSettings(json: string): RoomView["settings"] {
  try {
    return JSON.parse(json) as RoomView["settings"];
  } catch {
    return { matchMode: false, stacking: false, turnTimeoutS: 30 };
  }
}
