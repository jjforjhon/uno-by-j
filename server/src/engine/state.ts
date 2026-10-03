import type { Card, CardColor, EngineSettings, GameState, PlayerState, Rng } from "./types";
import { buildDeck, shuffle } from "./deck";

export const HAND_SIZE = 7;

export interface StartPlayerInput {
  userId: string;
  displayName: string;
}

export interface StartOptions {
  gameId: string;
  roomCode: string;
  players: StartPlayerInput[]; // seat order; 2..10 validated by the room layer
  settings: EngineSettings;
  now: number; // epoch ms; turnDeadlineAt derives from this
  rng: Rng;
}

class SetupRuleError extends Error {}

/**
 * Create a fresh round: build+shuffle deck, deal 7 each, flip until a number
 * card leads the discard (docs/RULES.md §2.2 documented deviation), seat 0 starts.
 */
export function startGame(opts: StartOptions): GameState {
  if (opts.players.length < 2) {
    throw new SetupRuleError("need at least 2 players");
  }

  const deck = shuffle(buildDeck(), opts.rng);
  const players: PlayerState[] = opts.players.map((p, seat) => ({
    userId: p.userId,
    seat,
    displayName: p.displayName,
    hand: deck.splice(0, HAND_SIZE),
    connected: true,
    left: false,
    hasCalledUno: false,
  }));

  // Flip until a number card (deterministic deviation per RULES.md).
  let topCard: Card | undefined;
  while (deck.length > 0) {
    const candidate = deck.pop()!;
    if (candidate.kind === "NUMBER") {
      topCard = candidate;
      break;
    }
    // Non-number lead: return it to the bottom and keep flipping.
    deck.unshift(candidate);
  }
  if (!topCard) throw new SetupRuleError("no number card in deck");

  return {
    gameId: opts.gameId,
    roomCode: opts.roomCode,
    status: "PLAYING",
    players,
    currentPlayerIndex: 0,
    direction: 1,
    currentColor: topCard.color as CardColor,
    topCard,
    drawPile: deck,
    discardPile: [topCard],
    pendingUno: null,
    turnSeq: 1,
    turnDeadlineAt: opts.settings.turnTimeoutS > 0 ? opts.now + opts.settings.turnTimeoutS * 1000 : 0,
    drawnThisTurn: false,
    winnerUserId: null,
    lastScores: null,
    settings: { ...opts.settings },
  };
}

export { SetupRuleError };
