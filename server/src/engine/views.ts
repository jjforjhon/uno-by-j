import type { Card, CardColor, GameState, RoundScore } from "./types";
import { isPlayable } from "./deck";

/**
 * The ONLY projection the engine exposes. Built per viewer:
 * - the viewer sees their own cards; everyone else is a count
 * - playableIds are computed server-side (UX hints, never authority)
 * Hidden information never crosses this boundary by construction.
 */

export interface PublicPlayerView {
  userId: string;
  seat: number;
  displayName: string;
  cardCount: number;
  connected: boolean;
  left: boolean;
  hasCalledUno: boolean;
  isCurrent: boolean;
}

export interface SelfHandView {
  cards: Card[];
  playableIds: string[];
  /** Player drew a playable card this turn and may pass. */
  canPass: boolean;
}

export interface GameSnapshotView {
  gameId: string;
  roomCode: string;
  status: GameState["status"];
  direction: 1 | -1;
  currentPlayerId: string | null;
  currentColor: CardColor;
  topCard: Card;
  drawPileCount: number;
  discardPileCount: number;
  turnSeq: number;
  turnDeadlineAt: number;
  pendingUnoOffenderId: string | null;
  players: PublicPlayerView[];
  hand: SelfHandView;
  winnerUserId: string | null;
  lastScores: RoundScore[] | null;
}

export function gameView(state: GameState, forUserId: string): GameSnapshotView {
  const me = state.players.find((p) => p.userId === forUserId);
  const current = state.players[state.currentPlayerIndex] ?? null;

  const players: PublicPlayerView[] = state.players.map((p) => ({
    userId: p.userId,
    seat: p.seat,
    displayName: p.displayName,
    cardCount: p.hand.length,
    connected: p.connected,
    left: p.left,
    hasCalledUno: p.hasCalledUno,
    isCurrent: current?.userId === p.userId,
  }));

  const isMyTurn = current?.userId === forUserId;
  const playableIds = isMyTurn
    ? me!.hand.filter((c) => isPlayable(c, state.topCard, state.currentColor)).map((c) => c.id)
    : [];

  return {
    gameId: state.gameId,
    roomCode: state.roomCode,
    status: state.status,
    direction: state.direction,
    currentPlayerId: current && !current.left ? current.userId : null,
    currentColor: state.currentColor,
    topCard: state.topCard,
    drawPileCount: state.drawPile.length,
    discardPileCount: state.discardPile.length,
    turnSeq: state.turnSeq,
    turnDeadlineAt: state.turnDeadlineAt,
    pendingUnoOffenderId: state.pendingUno?.offenderId ?? null,
    players,
    hand: {
      cards: me ? me.hand.map((c) => ({ ...c })) : [],
      playableIds,
      canPass: isMyTurn && state.drawnThisTurn,
    },
    winnerUserId: state.winnerUserId,
    lastScores: state.lastScores,
  };
}
