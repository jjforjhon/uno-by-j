import type { Card, CardColor, CardKind, Rng } from "./types";
import { CARD_COLORS } from "./types";

/** Official 108-card deck with stable ids (c_0 .. c_107). Order is set by shuffle. */
export function buildDeck(): Card[] {
  const cards: Card[] = [];
  let i = 0;
  for (const color of CARD_COLORS) {
    push(cards, { id: `c_${i++}`, color, kind: "NUMBER", value: 0 });
    for (let v = 1; v <= 9; v++) {
      for (let copy = 0; copy < 2; copy++) {
        push(cards, { id: `c_${i++}`, color, kind: "NUMBER", value: v });
      }
    }
    for (const kind of ["SKIP", "REVERSE", "DRAW2"] as const) {
      for (let copy = 0; copy < 2; copy++) {
        push(cards, { id: `c_${i++}`, color, kind });
      }
    }
  }
  for (let copy = 0; copy < 4; copy++) {
    push(cards, { id: `c_${i++}`, color: null, kind: "WILD" });
    push(cards, { id: `c_${i++}`, color: null, kind: "WILD4" });
  }
  return cards;
}

function push(cards: Card[], card: Card): void {
  cards.push(card);
}

/** Fisher-Yates using the injected RNG (deterministic under a seeded Rng). */
export function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return items;
}

/** Points per docs/RULES.md: numbers face value, actions 20, wilds 50. */
export function cardPoints(card: Card): number {
  switch (card.kind) {
    case "NUMBER":
      return card.value ?? 0;
    case "SKIP":
    case "REVERSE":
    case "DRAW2":
      return 20;
    case "WILD":
    case "WILD4":
      return 50;
  }
}

export function handPoints(hand: Card[]): number {
  return hand.reduce((sum, c) => sum + cardPoints(c), 0);
}

/** Can `card` legally be played on top of `top` with `activeColor`? */
export function isPlayable(card: Card, top: Card, activeColor: CardColor): boolean {
  if (card.kind === "WILD" || card.kind === "WILD4") return true;
  if (card.color === activeColor) return true;
  if (card.kind === "NUMBER" && top.kind === "NUMBER" && card.value === top.value) return true;
  if (card.kind === top.kind && card.kind !== "NUMBER") return true;
  return false;
}

export function colorOf(card: Card, fallback: CardColor): CardColor {
  return card.color ?? fallback;
}

export type { CardColor, CardKind };
