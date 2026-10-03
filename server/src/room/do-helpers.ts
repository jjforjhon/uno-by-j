/**
 * RoomDO support types + decoding. Kept out of do.ts so the DO class file
 * stays focused on behavior. Message shapes mirror docs/PROTOCOL.md.
 */
import type { RoomView } from "../domain/rooms";
import type { GameEvent } from "../engine/types";

export const PROTOCOL_VERSION = 1;

// ---------- limits (docs/PROTOCOL.md) ----------

/** Heartbeat contract: client pings, server auto-responds; 45s => disconnected. */
export const HEARTBEAT_TIMEOUT_S = 45;
/** HELLO must arrive within this window after the upgrade or we close 4001. */
export const HELLO_TIMEOUT_S = 10;
/** Recent-action idempotency window per player. */
export const IDEMPOTENCY_TTL_MS = 60_000;
export const IDEMPOTENCY_MAX_PER_PLAYER = 8;
/** Msg/s per socket (sliding 1 s window). */
export const MSG_RATE_LIMIT = 10;
export const MAX_PLAYERS_HARD = 10;
/** Max accepted WS text frame bytes. */
export const MAX_WS_FRAME_BYTES = 4 * 1024;
/** Internal DO HTTP surface auth (Worker forwarder sets this header). */
export const INTERNAL_SECRET_HEADER = "x-internal-secret";

// ---------- S2C event vocabulary ----------

/** Room/lifecycle events the DO synthesizes (docs/PROTOCOL.md EVENT kinds). */
export type RoomEvent =
  | { kind: "PLAYER_JOINED"; userId: string; displayName: string }
  | { kind: "PLAYER_LEFT"; userId: string }
  | { kind: "PLAYER_DISCONNECTED"; userId: string }
  | { kind: "PLAYER_RECONNECTED"; userId: string }
  | { kind: "ROOM_UPDATED"; room: RoomView }
  | {
      kind: "CHAT_MESSAGE";
      id: string;
      senderUserId: string;
      senderDisplayName: string;
      body: string;
      createdAt: number;
    };

/** Anything fan-out-able. */
export type OutEvent = GameEvent | RoomEvent;

// ---------- WS error codes (stable enum, docs/PROTOCOL.md) ----------

export type WsErrorCode =
  | "BAD_MESSAGE"
  | "AUTH_REQUIRED"
  | "AUTH_EXPIRED"
  | "NOT_MEMBER"
  | "ROOM_FULL"
  | "ROOM_NOT_FOUND"
  | "RATE_LIMITED"
  | "GAME_NOT_STARTED"
  | "NOT_YOUR_TURN"
  | "CARD_NOT_OWNED"
  | "CARD_NOT_PLAYABLE"
  | "DRAW4_ILLEGAL"
  | "WILD_COLOR_REQUIRED"
  | "ALREADY_DRAWN"
  | "UNO_WINDOW_INACTIVE"
  | "ROUND_OVER"
  | "FORBIDDEN"
  | "SERVER_BUSY";

const PASS_THROUGH_RULE_CODES: ReadonlySet<string> = new Set([
  "GAME_NOT_STARTED",
  "NOT_YOUR_TURN",
  "CARD_NOT_OWNED",
  "CARD_NOT_PLAYABLE",
  "DRAW4_ILLEGAL",
  "WILD_COLOR_REQUIRED",
  "ALREADY_DRAWN",
  "UNO_WINDOW_INACTIVE",
  "ROUND_OVER",
]);

/** Map engine RuleError codes onto WS codes (BAD_REQUEST -> BAD_MESSAGE). */
export function mapRuleCode(c: string): WsErrorCode {
  return PASS_THROUGH_RULE_CODES.has(c) ? (c as WsErrorCode) : "BAD_MESSAGE";
}

// ---------- envelopes ----------

export interface ServerEnvelope {
  v: number;
  type: string;
  seq?: number;
  reqId?: string;
  d: unknown;
}

/** In-memory per-socket metadata (rebuilt from socket tags after hibernation). */
export interface Conn {
  ws: WebSocket;
  /** Set after successful HELLO; undefined until then (4001 on first non-HELLO). */
  userId?: string;
  /** Monotonic ms clock of the upgrade (HELLO deadline check). */
  openedAt: number;
  /** Sliding-window timestamps for the per-socket msg/s cap. */
  rate: number[];
  closed: boolean;
}

export interface DedupeEntry {
  at: number;
  seq: number;
  applied: boolean;
}

// ---------- C2S decode (strict; unknown fields dropped) ----------

export type ClientMsg =
  | { type: "HELLO"; token: string }
  | { type: "PLAY_CARD"; reqId: string; actionId: string; cardId: string; chosenColor?: "R" | "G" | "B" | "Y" }
  | { type: "DRAW_CARD"; reqId: string; actionId: string }
  | { type: "PASS"; reqId: string; actionId: string }
  | { type: "CALL_UNO"; reqId: string; actionId: string }
  | { type: "CATCH_UNO"; reqId: string; actionId: string; targetPlayerId: string }
  | { type: "LEAVE"; reqId: string }
  | { type: "SYNC_REQ"; reqId: string; sinceSeq: number }
  | { type: "PING"; reqId: string }
  | { type: "CHAT_SEND"; reqId: string; text: string };

export type DecodeResult =
  | { ok: true; msg: ClientMsg }
  | { ok: false; error: "TOO_LARGE" | "BAD_JSON" | "SHAPE" | "VERSION" };

function isFiniteInt(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && Number.isInteger(x);
}

export function decodeClientMessage(raw: string): DecodeResult {
  if (raw.length > MAX_WS_FRAME_BYTES) return { ok: false, error: "TOO_LARGE" };
  let env: unknown;
  try {
    env = JSON.parse(raw);
  } catch {
    return { ok: false, error: "BAD_JSON" };
  }
  if (typeof env !== "object" || env === null || Array.isArray(env)) {
    return { ok: false, error: "SHAPE" };
  }
  const { v, type, reqId, d } = env as {
    v?: unknown;
    type?: unknown;
    reqId?: unknown;
    d?: unknown;
  };
  if (v !== PROTOCOL_VERSION) return { ok: false, error: "VERSION" };
  if (typeof type !== "string") return { ok: false, error: "SHAPE" };
  const data =
    typeof d === "object" && d !== null && !Array.isArray(d) ? (d as Record<string, unknown>) : {};
  const rid = typeof reqId === "string" && reqId.length > 0 && reqId.length <= 128 ? reqId : "";

  switch (type) {
    case "HELLO":
      if (typeof data.token !== "string" || data.token.length === 0 || data.token.length > 2048) {
        return { ok: false, error: "SHAPE" };
      }
      return { ok: true, msg: { type: "HELLO", token: data.token } };

    case "PLAY_CARD": {
      if (!rid) return { ok: false, error: "SHAPE" };
      if (typeof data.actionId !== "string" || data.actionId.length === 0 || data.actionId.length > 128) {
        return { ok: false, error: "SHAPE" };
      }
      if (typeof data.cardId !== "string" || data.cardId.length === 0 || data.cardId.length > 64) {
        return { ok: false, error: "SHAPE" };
      }
      let chosenColor: "R" | "G" | "B" | "Y" | undefined;
      if (data.chosenColor !== undefined) {
        if (
          typeof data.chosenColor !== "string" ||
          !/^[RGBY]$/.test(data.chosenColor)
        ) {
          return { ok: false, error: "SHAPE" };
        }
        chosenColor = data.chosenColor as "R" | "G" | "B" | "Y";
      }
      return {
        ok: true,
        msg: {
          type: "PLAY_CARD",
          reqId: rid,
          actionId: data.actionId,
          cardId: data.cardId,
          chosenColor,
        },
      };
    }

    case "DRAW_CARD":
    case "PASS":
    case "CALL_UNO":
      if (!rid) return { ok: false, error: "SHAPE" };
      if (typeof data.actionId !== "string" || data.actionId.length === 0 || data.actionId.length > 128) {
        return { ok: false, error: "SHAPE" };
      }
      return { ok: true, msg: { type, reqId: rid, actionId: data.actionId } };

    case "CATCH_UNO": {
      if (!rid) return { ok: false, error: "SHAPE" };
      if (typeof data.actionId !== "string" || data.actionId.length === 0 || data.actionId.length > 128) {
        return { ok: false, error: "SHAPE" };
      }
      if (
        typeof data.targetPlayerId !== "string" ||
        data.targetPlayerId.length === 0 ||
        data.targetPlayerId.length > 128
      ) {
        return { ok: false, error: "SHAPE" };
      }
      return {
        ok: true,
        msg: { type, reqId: rid, actionId: data.actionId, targetPlayerId: data.targetPlayerId },
      };
    }

    case "LEAVE":
      if (!rid) return { ok: false, error: "SHAPE" };
      return { ok: true, msg: { type: "LEAVE", reqId: rid } };

    case "SYNC_REQ":
      if (!rid) return { ok: false, error: "SHAPE" };
      if (!isFiniteInt(data.sinceSeq) || (data.sinceSeq as number) < 0) {
        return { ok: false, error: "SHAPE" };
      }
      return { ok: true, msg: { type: "SYNC_REQ", reqId: rid, sinceSeq: data.sinceSeq as number } };

    case "PING":
      return { ok: true, msg: { type: "PING", reqId: rid } };

    case "CHAT_SEND": {
      if (!rid) return { ok: false, error: "SHAPE" };
      const rawText = data.text ?? data.message ?? data.body;
      if (typeof rawText !== "string") return { ok: false, error: "SHAPE" };
      const text = rawText.trim();
      if (text.length === 0 || text.length > 280) {
        return { ok: false, error: "SHAPE" };
      }
      return { ok: true, msg: { type: "CHAT_SEND", reqId: rid, text } };
    }

    default:
      return { ok: false, error: "SHAPE" };
  }
}
