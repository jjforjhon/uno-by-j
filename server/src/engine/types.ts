/**
 * UNO by J — authoritative game engine.
 *
 * PURE and PLATFORM-FREE: no Cloudflare APIs, no Date.now(), no Math.random().
 * Time enters via the `now` parameter; randomness via the injected Rng.
 * apply() mutates the given state in place (the DO owns the object) and returns
 * the events that happened, for the DO to route to clients (with sanitization).
 *
 * Hidden information (hands, draw pile order) NEVER leaves the engine except
 * through explicit secret events / the viewer's own hand in views.ts.
 */

export type CardColor = "R" | "G" | "B" | "Y";
export const CARD_COLORS: CardColor[] = ["R", "G", "B", "Y"];

export type CardKind = "NUMBER" | "SKIP" | "REVERSE" | "DRAW2" | "WILD" | "WILD4";

export interface Card {
  id: string;
  /** null only for wilds. */
  color: CardColor | null;
  kind: CardKind;
  /** 0-9, only for NUMBER. */
  value?: number;
}

export interface PlayerState {
  userId: string;
  seat: number;
  displayName: string;
  hand: Card[];
  connected: boolean;
  left: boolean;
  hasCalledUno: boolean;
}

export interface UnoWindow {
  offenderId: string;
  /** Epoch ms when the window opened; expires after UNO_WINDOW_MS. */
  openedAt: number;
}

/** How long opponents may catch a missed UNO call (docs/RULES.md §3). */
export const UNO_WINDOW_MS = 5000;

export type GameStatus = "PLAYING" | "ROUND_OVER";

export interface EngineSettings {
  turnTimeoutS: number;
}

export interface RoundScore {
  userId: string;
  /** Points this player's remaining hand cost them (credited to the winner). */
  handPoints: number;
}

export interface GameState {
  gameId: string;
  roomCode: string;
  status: GameStatus;
  players: PlayerState[]; // seat order; fixed length; left players are skipped
  currentPlayerIndex: number; // always points at an active (non-left) player while PLAYING
  direction: 1 | -1;
  currentColor: CardColor; // may differ from topCard.color after a wild
  topCard: Card;
  drawPile: Card[];
  discardPile: Card[]; // top = last element
  pendingUno: UnoWindow | null;
  turnSeq: number; // increments on every successful mutating action
  turnDeadlineAt: number; // epoch ms
  drawnThisTurn: boolean; // current player drew a playable card this turn
  winnerUserId: string | null;
  lastScores: RoundScore[] | null;
  settings: EngineSettings;
}

// ---------- Actions ----------

export type GameAction =
  | { type: "PLAY_CARD"; playerId: string; cardId: string; chosenColor?: CardColor }
  | { type: "DRAW_CARD"; playerId: string }
  | { type: "PASS"; playerId: string }
  | { type: "CALL_UNO"; playerId: string }
  | { type: "CATCH_UNO"; playerId: string; targetPlayerId: string }
  | { type: "TIMEOUT_TURN" }
  | { type: "LEAVE"; playerId: string }
  | { type: "PRESENCE"; playerId: string; connected: boolean };

// ---------- Events ----------

export type GameEvent =
  | { kind: "GAME_STARTED"; playerCount: number; firstPlayerId: string }
  | { kind: "TURN_CHANGED"; playerId: string; deadlineAt: number }
  | { kind: "CARD_PLAYED"; playerId: string; card: Card; newColor: CardColor; playerCardCount: number; drawPileCount: number }
  | { kind: "DRAWN_PUBLIC"; playerId: string; count: number; reason: DrawReason }
  | { kind: "DRAWN_SECRET"; playerId: string; cards: Card[]; newCount: number; reason: DrawReason }
  | { kind: "SKIPPED"; playerId: string }
  | { kind: "DIRECTION_FLIPPED"; direction: 1 | -1 }
  | { kind: "UNO_CALLED"; playerId: string }
  | { kind: "UNO_CAUGHT"; offenderId: string; catcherId: string }
  | { kind: "PLAYER_LEFT_GAME"; userId: string }
  | { kind: "ROUND_ENDED"; winnerUserId: string | null; scores: RoundScore[] };

export type DrawReason = "DRAW" | "PENALTY_DRAW2" | "PENALTY_WILD4" | "UNO_CAUGHT" | "TIMEOUT";

// ---------- Errors (codes match docs/PROTOCOL.md) ----------

export type RuleErrorCode =
  | "GAME_NOT_STARTED"
  | "NOT_YOUR_TURN"
  | "CARD_NOT_OWNED"
  | "CARD_NOT_PLAYABLE"
  | "DRAW4_ILLEGAL"
  | "WILD_COLOR_REQUIRED"
  | "ALREADY_DRAWN"
  | "UNO_WINDOW_INACTIVE"
  | "ROUND_OVER"
  | "BAD_REQUEST";

export class RuleError extends Error {
  readonly code: RuleErrorCode;
  constructor(code: RuleErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

// ---------- RNG ----------

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
}
