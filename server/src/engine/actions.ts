import type {
  Card,
  CardColor,
  GameAction,
  GameEvent,
  GameState,
  PlayerState,
  RoundScore,
} from "./types";
import { CARD_COLORS, UNO_WINDOW_MS } from "./types";
import { handPoints, isPlayable, shuffle } from "./deck";
import { RuleError } from "./types";
import type { Rng } from "./types";

/**
 * apply() — the ONLY way game state mutates. Validates against authoritative
 * state, mutates in place, returns events for the DO to route (secret events
 * only to their subject; everything else to the room).
 */
export function apply(
  state: GameState,
  action: GameAction,
  now: number,
  rng: Rng
): GameEvent[] {
  switch (action.type) {
    case "PLAY_CARD":
      return playCard(state, action.playerId, action.cardId, action.chosenColor, now, rng);
    case "DRAW_CARD":
      return drawCard(state, action.playerId, now, rng);
    case "PASS":
      return pass(state, action.playerId, now);
    case "CALL_UNO":
      return callUno(state, action.playerId);
    case "CATCH_UNO":
      return catchUno(state, action.playerId, action.targetPlayerId, now, rng);
    case "TIMEOUT_TURN":
      return timeoutTurn(state, now, rng);
    case "LEAVE":
      return leave(state, action.playerId, now, rng);
    case "PRESENCE":
      return presence(state, action.playerId, action.connected);
    default:
      // Unknown action types are rejected, never silently ignored.
      throw new RuleError("BAD_REQUEST");
  }
}

// ---------- helpers ----------

function current(state: GameState): PlayerState {
  return state.players[state.currentPlayerIndex]!;
}

function requirePlaying(state: GameState): void {
  if (state.status !== "PLAYING") throw new RuleError("ROUND_OVER");
}

function requireCurrentPlayer(state: GameState, playerId: string): void {
  if (current(state).userId !== playerId) throw new RuleError("NOT_YOUR_TURN");
}

/** The offender acted (play/draw/pass/timeout): no more catches. */
function closeUnoWindowIfOffender(state: GameState, playerId: string): void {
  if (state.pendingUno?.offenderId === playerId) state.pendingUno = null;
}

/** Time-bounded window (RULES §3): expires UNO_WINDOW_MS after opening. */
function unoWindowExpired(state: GameState, now: number): boolean {
  return state.pendingUno != null && now - state.pendingUno.openedAt >= UNO_WINDOW_MS;
}

/**
 * expireUnoWindow: after the window lapses, CATCH_UNO is no longer available —
 * the offender escaped the catch (documented simplification: no automatic
 * penalty on expiry; anyone who observed in real time could have caught).
 */
function expireUnoWindow(state: GameState, now: number): void {
  if (unoWindowExpired(state, now)) state.pendingUno = null;
}

function activePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => !p.left);
}

/** Index of the next active seat in the current direction (cycling, skipping left). */
function nextActiveIndex(state: GameState, from: number): number {
  const dir = state.direction;
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (from + dir * step + n) % n;
    if (!state.players[idx]!.left) return idx;
  }
  return from; // no other active player
}

function advanceTurn(state: GameState, now: number): void {
  state.currentPlayerIndex = nextActiveIndex(state, state.currentPlayerIndex);
  state.drawnThisTurn = false;
  state.turnSeq += 1;
  state.turnDeadlineAt = state.settings.turnTimeoutS > 0 ? now + state.settings.turnTimeoutS * 1000 : 0;
}

/** Draw up to n cards, reshuffling the discard pile when needed (RULES §5). */
function drawFromPile(state: GameState, n: number, rng: Rng): Card[] {
  const drawn: Card[] = [];
  while (drawn.length < n) {
    if (state.drawPile.length === 0) {
      if (state.discardPile.length <= 1) break; // nothing left to reshuffle (documented edge)
      state.drawPile = shuffle(state.discardPile, rng);
      state.discardPile = [state.topCard];
    }
    drawn.push(state.drawPile.pop()!);
  }
  return drawn;
}

function giveCards(
  state: GameState,
  player: PlayerState,
  cards: Card[],
  reason: Extract<GameEvent, { kind: "DRAWN_PUBLIC" }>["reason"]
): GameEvent[] {
  if (cards.length === 0) return [];
  player.hand.push(...cards);
  // Receiving cards invalidates a previous UNO call for this 1-card state.
  player.hasCalledUno = false;
  return [
    { kind: "DRAWN_SECRET", playerId: player.userId, cards, newCount: player.hand.length, reason },
    { kind: "DRAWN_PUBLIC", playerId: player.userId, count: cards.length, reason },
  ];
}

function endRound(state: GameState, winnerUserId: string | null): GameEvent[] {
  state.status = "ROUND_OVER";
  state.pendingUno = null;
  state.winnerUserId = winnerUserId;
  const scores: RoundScore[] = state.players.map((p) => ({
    userId: p.userId,
    handPoints: handPoints(p.hand),
  }));
  state.lastScores = scores;
  return [{ kind: "ROUND_ENDED", winnerUserId, scores }];
}

function validateColor(c: unknown): c is CardColor {
  return typeof c === "string" && (CARD_COLORS as string[]).includes(c);
}

// ---------- action handlers ----------

function playCard(
  state: GameState,
  playerId: string,
  cardId: string,
  chosenColor: unknown,
  now: number,
  rng: Rng
): GameEvent[] {
  requirePlaying(state);
  requireCurrentPlayer(state, playerId);
  closeUnoWindowIfOffender(state, playerId);

  const player = current(state);
  const cardIndex = player.hand.findIndex((c) => c.id === cardId);
  if (cardIndex === -1) throw new RuleError("CARD_NOT_OWNED");
  const card = player.hand[cardIndex]!;

  if (!isPlayable(card, state.topCard, state.currentColor)) {
    throw new RuleError("CARD_NOT_PLAYABLE");
  }

  // Wild Draw 4 restriction (server-enforced, RULES §3): no card of the active
  // color in hand — other wilds do not exempt you.
  if (card.kind === "WILD4") {
    const hasActiveColor = player.hand.some(
      (c, i) => i !== cardIndex && c.color === state.currentColor
    );
    if (hasActiveColor) throw new RuleError("DRAW4_ILLEGAL");
  }

  // Wilds choose their color inline (same action; design decision in RULES §3).
  let newColor = state.currentColor;
  if (card.kind === "WILD" || card.kind === "WILD4") {
    if (!validateColor(chosenColor)) throw new RuleError("WILD_COLOR_REQUIRED");
    newColor = chosenColor;
  }

  player.hand.splice(cardIndex, 1);
  state.discardPile.push(card);
  state.topCard = card;
  state.currentColor = newColor;

  const events: GameEvent[] = [
    {
      kind: "CARD_PLAYED",
      playerId,
      card,
      newColor,
      playerCardCount: player.hand.length,
      drawPileCount: state.drawPile.length,
    },
  ];

  // Round won?
  if (player.hand.length === 0) {
    events.push(...endRound(state, playerId));
    return events;
  }

  // Open the UNO window on the penultimate play.
  if (player.hand.length === 1) {
    state.pendingUno = { offenderId: playerId, openedAt: now };
  }

  // Effects.
  switch (card.kind) {
    case "NUMBER":
      break;
    case "SKIP": {
      const victimIdx = nextActiveIndex(state, state.currentPlayerIndex);
      const victim = state.players[victimIdx]!;
      events.push({ kind: "SKIPPED", playerId: victim.userId });
      state.currentPlayerIndex = victimIdx;
      break;
    }
    case "REVERSE": {
      state.direction = state.direction === 1 ? -1 : 1;
      events.push({ kind: "DIRECTION_FLIPPED", direction: state.direction });
      if (activePlayers(state).length === 2) {
        // Official 2-player rule: Reverse acts as Skip.
        const victimIdx = nextActiveIndex(state, state.currentPlayerIndex);
        const victim = state.players[victimIdx]!;
        events.push({ kind: "SKIPPED", playerId: victim.userId });
        state.currentPlayerIndex = victimIdx;
      }
      break;
    }
    case "DRAW2": {
      const victimIdx = nextActiveIndex(state, state.currentPlayerIndex);
      const victim = state.players[victimIdx]!;
      state.currentPlayerIndex = victimIdx;
      events.push(...giveCards(state, victim, drawFromPile(state, 2, rng), "PENALTY_DRAW2"));
      events.push({ kind: "SKIPPED", playerId: victim.userId });
      break;
    }
    case "WILD4": {
      const victimIdx = nextActiveIndex(state, state.currentPlayerIndex);
      const victim = state.players[victimIdx]!;
      state.currentPlayerIndex = victimIdx;
      events.push(...giveCards(state, victim, drawFromPile(state, 4, rng), "PENALTY_WILD4"));
      events.push({ kind: "SKIPPED", playerId: victim.userId });
      break;
    }
    case "WILD":
      break;
  }

  advanceTurn(state, now);
  events.push({
    kind: "TURN_CHANGED",
    playerId: current(state).userId,
    deadlineAt: state.turnDeadlineAt,
  });
  return events;
}

function drawCard(
  state: GameState,
  playerId: string,
  now: number,
  rng: Rng
): GameEvent[] {
  requirePlaying(state);
  requireCurrentPlayer(state, playerId);
  closeUnoWindowIfOffender(state, playerId);

  const player = current(state);
  if (state.drawnThisTurn) throw new RuleError("ALREADY_DRAWN");

  const cards = drawFromPile(state, 1, rng);
  const events: GameEvent[] = [];
  if (cards.length === 0) {
    // Piles exhausted: pass the turn (documented edge, RULES §5).
    advanceTurn(state, now);
    events.push({
      kind: "TURN_CHANGED",
      playerId: current(state).userId,
      deadlineAt: state.turnDeadlineAt,
    });
    return events;
  }

  player.hand.push(...cards);
  player.hasCalledUno = false;
  events.push(
    { kind: "DRAWN_SECRET", playerId, cards, newCount: player.hand.length, reason: "DRAW" },
    { kind: "DRAWN_PUBLIC", playerId, count: cards.length, reason: "DRAW" }
  );

  const drawn = cards[0]!;
  if (isPlayable(drawn, state.topCard, state.currentColor)) {
    // Player may play the drawn card or pass; turn stays with them.
    state.drawnThisTurn = true;
  } else {
    advanceTurn(state, now);
    events.push({
      kind: "TURN_CHANGED",
      playerId: current(state).userId,
      deadlineAt: state.turnDeadlineAt,
    });
  }
  return events;
}

function pass(state: GameState, playerId: string, now: number): GameEvent[] {
  requirePlaying(state);
  requireCurrentPlayer(state, playerId);
  closeUnoWindowIfOffender(state, playerId);
  if (!state.drawnThisTurn) throw new RuleError("BAD_REQUEST");

  advanceTurn(state, now);
  return [
    {
      kind: "TURN_CHANGED",
      playerId: current(state).userId,
      deadlineAt: state.turnDeadlineAt,
    },
  ];
}

function callUno(state: GameState, playerId: string): GameEvent[] {
  if (state.status !== "PLAYING") throw new RuleError("ROUND_OVER");
  if (state.pendingUno?.offenderId !== playerId) {
    throw new RuleError("UNO_WINDOW_INACTIVE");
  }
  state.pendingUno = null;
  const player = state.players.find((p) => p.userId === playerId)!;
  player.hasCalledUno = true;
  return [{ kind: "UNO_CALLED", playerId }];
}

function catchUno(
  state: GameState,
  catcherId: string,
  targetPlayerId: string,
  now: number,
  rng: Rng
): GameEvent[] {
  if (state.status !== "PLAYING") throw new RuleError("ROUND_OVER");
  if (catcherId === targetPlayerId) throw new RuleError("BAD_REQUEST");
  expireUnoWindow(state, now); // time-bounded window: lapsed windows reject
  if (state.pendingUno?.offenderId !== targetPlayerId) {
    throw new RuleError("UNO_WINDOW_INACTIVE");
  }

  const offender = state.players.find((p) => p.userId === targetPlayerId)!;
  if (offender.hand.length !== 1) throw new RuleError("UNO_WINDOW_INACTIVE");

  state.pendingUno = null;
  const events: GameEvent[] = [{ kind: "UNO_CAUGHT", offenderId: targetPlayerId, catcherId }];
  events.push(...giveCards(state, offender, drawFromPile(state, 2, rng), "UNO_CAUGHT"));
  return events;
}

function timeoutTurn(state: GameState, now: number, rng: Rng): GameEvent[] {
  if (state.status !== "PLAYING") return [];
  if (now < state.turnDeadlineAt) return []; // stale alarm: ignore
  const player = current(state);
  closeUnoWindowIfOffender(state, player.userId);

  const events: GameEvent[] = [];
  const cards = drawFromPile(state, 1, rng);
  if (cards.length > 0) {
    player.hand.push(...cards);
    player.hasCalledUno = false;
    events.push(
      { kind: "DRAWN_SECRET", playerId: player.userId, cards, newCount: player.hand.length, reason: "TIMEOUT" },
      { kind: "DRAWN_PUBLIC", playerId: player.userId, count: cards.length, reason: "TIMEOUT" }
    );
  }
  advanceTurn(state, now);
  events.push({
    kind: "TURN_CHANGED",
    playerId: current(state).userId,
    deadlineAt: state.turnDeadlineAt,
  });
  return events;
}

function leave(
  state: GameState,
  playerId: string,
  now: number,
  rng: Rng
): GameEvent[] {
  const player = state.players.find((p) => p.userId === playerId);
  if (!player || player.left) return [];

  player.left = true;
  player.connected = false;
  // Cards return to the bottom of the draw pile (RULES §7).
  state.drawPile.unshift(...player.hand);
  player.hand = [];

  const events: GameEvent[] = [{ kind: "PLAYER_LEFT_GAME", userId: playerId }];
  if (state.pendingUno?.offenderId === playerId) state.pendingUno = null;

  if (state.status !== "PLAYING") return events;

  const remaining = activePlayers(state);
  if (remaining.length <= 1) {
    events.push(...endRound(state, remaining[0]?.userId ?? null));
    return events;
  }

  // If the leaver had the turn, hand it to the next active player.
  if (current(state).userId === playerId) {
    advanceTurn(state, now);
    events.push({
      kind: "TURN_CHANGED",
      playerId: current(state).userId,
      deadlineAt: state.turnDeadlineAt,
    });
  }
  return events;
}

function presence(state: GameState, playerId: string, connected: boolean): GameEvent[] {
  const player = state.players.find((p) => p.userId === playerId);
  if (player) player.connected = connected;
  return [];
}
