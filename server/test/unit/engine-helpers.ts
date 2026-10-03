import { startGame } from "../../src/engine/state";
import { apply } from "../../src/engine/actions";
import { gameView } from "../../src/engine/views";
import { mulberry32 } from "../../src/util/rng";
import type { Card, GameAction, GameEvent, GameState } from "../../src/engine/types";
import type { Rng } from "../../src/engine/types";

export const T0 = 1_700_000_000_000;

export interface EngineHarness {
  state: GameState;
  rng: Rng;
  now: number;
  act(action: GameAction): GameEvent[];
  advanceMs(ms: number): void;
  handOf(userId: string): Card[];
  view(userId: string): ReturnType<typeof gameView>;
  /** Force a specific hand for a player (test rigging only). */
  setHand(userId: string, cards: Card[]): void;
  handSizeOf(userId: string): number;
  currentPlayerId(): string;
}

export function makeGame(
  names: string[] = ["ada", "bob", "carol"],
  seed = 42,
  opts: { turnTimeoutS?: number } = {}
): EngineHarness {
  let now = T0;
  const rng = mulberry32(seed);
  const state = startGame({
    gameId: "g_test",
    roomCode: "AAAAAA",
    players: names.map((n) => ({ userId: `u_${n}`, displayName: n })),
    settings: { turnTimeoutS: opts.turnTimeoutS ?? 30 },
    now,
    rng,
  });

  const h: EngineHarness = {
    state,
    rng,
    get now() {
      return now;
    },
    act(action) {
      return apply(state, action, now, rng);
    },
    advanceMs(ms) {
      now += ms;
    },
    handOf(userId) {
      return state.players.find((p) => p.userId === userId)!.hand;
    },
    view(userId) {
      return gameView(state, userId);
    },
    setHand(userId, cards) {
      const p = state.players.find((x) => x.userId === userId)!;
      p.hand = [...cards];
    },
    handSizeOf(userId) {
      return state.players.find((p) => p.userId === userId)!.hand.length;
    },
    currentPlayerId() {
      return state.players[state.currentPlayerIndex]!.userId;
    },
  };
  return h;
}

/** Quick card builders for rigging hands. */
export const c = {
  num(id: string, value: number, color: Card["color"]): Card {
    return { id, color, kind: "NUMBER", value };
  },
  skip(id: string, color: Card["color"]): Card {
    return { id, color, kind: "SKIP" };
  },
  reverse(id: string, color: Card["color"]): Card {
    return { id, color, kind: "REVERSE" };
  },
  draw2(id: string, color: Card["color"]): Card {
    return { id, color, kind: "DRAW2" };
  },
  wild(id: string): Card {
    return { id, color: null, kind: "WILD" };
  },
  wild4(id: string): Card {
    return { id, color: null, kind: "WILD4" };
  },
};
