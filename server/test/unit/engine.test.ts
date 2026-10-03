import { describe, expect, it } from "vitest";
import { buildDeck, isPlayable, cardPoints } from "../../src/engine/deck";
import { makeGame, c } from "./engine-helpers";
import type { Card, CardColor } from "../../src/engine/types";

function findInHand(h: ReturnType<typeof makeGame>, userId: string, pred: (card: Card) => boolean): Card {
  const card = h.handOf(userId).find(pred);
  if (!card) throw new Error("required card not in hand for test");
  return card;
}

const isRed = (card: Card) => card.color === "R";

describe("deck", () => {
  it("contains exactly 108 official cards with the right composition", () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(108);
    expect(deck.filter((x) => x.kind === "NUMBER" && x.value === 0)).toHaveLength(4);
    expect(deck.filter((x) => x.kind === "NUMBER" && x.value === 5)).toHaveLength(8);
    expect(deck.filter((x) => x.kind === "SKIP")).toHaveLength(8);
    expect(deck.filter((x) => x.kind === "REVERSE")).toHaveLength(8);
    expect(deck.filter((x) => x.kind === "DRAW2")).toHaveLength(8);
    expect(deck.filter((x) => x.kind === "WILD")).toHaveLength(4);
    expect(deck.filter((x) => x.kind === "WILD4")).toHaveLength(4);
  });

  it("scores: numbers face value, actions 20, wilds 50", () => {
    expect(cardPoints(c.num("x", 7, "R"))).toBe(7);
    expect(cardPoints(c.skip("x", "R"))).toBe(20);
    expect(cardPoints(c.draw2("x", "G"))).toBe(20);
    expect(cardPoints(c.wild("x"))).toBe(50);
    expect(cardPoints(c.wild4("x"))).toBe(50);
  });

  it("isPlayable: color match, kind match, number match, wilds always", () => {
    const top = c.num("top", 5, "R");
    expect(isPlayable(c.num("a", 5, "B"), top, "R")).toBe(true); // number match
    expect(isPlayable(c.num("b", 3, "R"), top, "R")).toBe(true); // color match
    expect(isPlayable(c.num("d", 3, "B"), top, "B")).toBe(true); // active color
    expect(isPlayable(c.num("e", 3, "B"), top, "G")).toBe(false); // no match
    expect(isPlayable(c.skip("f", "R"), top, "R")).toBe(true); // action card, color match
    expect(isPlayable(c.skip("f2", "R"), top, "B")).toBe(false); // action card, no color/symbol match
    expect(isPlayable(c.skip("g", "B"), c.skip("top2", "G"), "R")).toBe(true); // kind match
    expect(isPlayable(c.wild("w"), top, "G")).toBe(true);
    expect(isPlayable(c.wild4("w4"), top, "G")).toBe(true);
    expect(isPlayable(c.num("h", 9, "Y"), c.num("top3", 2, "G"), "R")).toBe(false);
  });

  it("is deterministic under a seeded RNG", () => {
    const a = makeGame(["a", "b"], 1234);
    const b = makeGame(["a", "b"], 1234);
    expect(a.handOf("u_a")).toEqual(b.handOf("u_a"));
    expect(a.state.topCard).toEqual(b.state.topCard);
  });
});

describe("game setup", () => {
  it("deals 7 cards each, number card leads, seat 0 starts", () => {
    const h = makeGame(["ada", "bob", "carol"], 7);
    expect(h.handSizeOf("u_ada")).toBe(7);
    expect(h.handSizeOf("u_bob")).toBe(7);
    expect(h.handSizeOf("u_carol")).toBe(7);
    expect(h.state.topCard.kind).toBe("NUMBER");
    expect(h.state.discardPile).toHaveLength(1);
    expect(h.currentPlayerId()).toBe("u_ada");
    expect(h.state.currentColor).toBe(h.state.topCard.color);
    expect(h.state.turnSeq).toBe(1);
  });

  it("rejects fewer than 2 players", () => {
    expect(() => makeGame(["solo"])).toThrow();
  });
});

describe("card play", () => {
  it("plays a matching color card and advances to the next seat", () => {
    const h = makeGame(["ada", "bob", "carol"], 11);
    const red = findInHand(h, "u_ada", isRed);
    h.act({ type: "PLAY_CARD", playerId: "u_ada", cardId: red.id });
    expect(h.state.topCard.id).toBe(red.id);
    expect(h.currentPlayerId()).toBe("u_bob");
    expect(h.state.turnSeq).toBe(2);
  });

  it("rejects playing a card you do not own", () => {
    const h = makeGame(["ada", "bob"], 3);
    expect(() => h.act({ type: "PLAY_CARD", playerId: "u_ada", cardId: "c_nope" })).toThrow(
      expect.objectContaining({ code: "CARD_NOT_OWNED" })
    );
  });

  it("rejects illegal plays", () => {
    const h = makeGame(["ada", "bob"], 5);
    // Deterministic board: top = red 5, active color blue.
    h.state.topCard = { id: "t2", color: "R", kind: "NUMBER", value: 5 };
    h.state.currentColor = "B";
    const bad: Card = { id: "c_bad", color: "Y", kind: "NUMBER", value: 9 };
    h.setHand("u_ada", [bad]);
    expect(() => h.act({ type: "PLAY_CARD", playerId: "u_ada", cardId: "c_bad" })).toThrow(
      expect.objectContaining({ code: "CARD_NOT_PLAYABLE" })
    );
  });

  it("rejects out-of-turn plays", () => {
    const h = makeGame(["ada", "bob"], 9);
    const card = h.handOf("u_bob")[0]!;
    expect(() => h.act({ type: "PLAY_CARD", playerId: "u_bob", cardId: card.id })).toThrow(
      expect.objectContaining({ code: "NOT_YOUR_TURN" })
    );
  });

  it("rejects unknown action types", () => {
    const h = makeGame(["ada", "bob"], 10);
    expect(() => h.act({ type: "MAGIC" } as never)).toThrow(
      expect.objectContaining({ code: "BAD_REQUEST" })
    );
  });

  it("wild requires a chosen color; WILD4 requires no active-color cards", () => {
    const h = makeGame(["ada", "bob", "carol"], 13);
    h.state.currentColor = "B";
    h.state.topCard = { id: "t", color: "B", kind: "NUMBER", value: 7 };

    // WILD4 with an active-color card in hand is illegal.
    h.setHand("u_ada", [c.wild4("w4"), c.num("b1", 2, "B")]);
    expect(() =>
      h.act({ type: "PLAY_CARD", playerId: "u_ada", cardId: "w4", chosenColor: "G" })
    ).toThrow(expect.objectContaining({ code: "DRAW4_ILLEGAL" }));

    // Without active color: legal, color applied, next player draws 4 and is skipped.
    h.setHand("u_ada", [c.wild4("w4b"), c.num("r1b", 2, "R")]);
    const bobBefore = h.handSizeOf("u_bob");
    const events = h.act({ type: "PLAY_CARD", playerId: "u_ada", cardId: "w4b", chosenColor: "G" });
    expect(events.some((e) => e.kind === "CARD_PLAYED")).toBe(true);
    expect(h.state.currentColor).toBe("G");
    expect(h.handSizeOf("u_bob")).toBe(bobBefore + 4);
    expect(events.some((e) => e.kind === "SKIPPED" && e.playerId === "u_bob")).toBe(true);
    expect(h.currentPlayerId()).toBe("u_carol");
  });

  it("wild without a color choice is rejected", () => {
    const h = makeGame(["ada", "bob"], 15);
    h.setHand("u_ada", [c.wild("w1")]);
    expect(() =>
      h.act({ type: "PLAY_CARD", playerId: "u_ada", cardId: "w1" })
    ).toThrow(expect.objectContaining({ code: "WILD_COLOR_REQUIRED" }));
  });

  it("DRAW2 penalizes +2 and skips the next player", () => {
    const h = makeGame(["ada", "bob", "carol"], 21);
    const top = h.state.topCard;
    const color: CardColor = top.color!;
    // Pad card so playing the action card does not end the round.
    h.setHand("u_ada", [c.draw2("d2", color), c.wild("pad")]);
    const bobBefore = h.handSizeOf("u_bob");
    h.act({ type: "PLAY_CARD", playerId: "u_ada", cardId: "d2" });
    expect(h.handSizeOf("u_bob")).toBe(bobBefore + 2);
    expect(h.currentPlayerId()).toBe("u_carol");
  });

  it("REVERSE flips direction (and acts as skip with 2 players)", () => {
    const h3 = makeGame(["ada", "bob", "carol"], 31);
    h3.setHand("u_ada", [c.reverse("rev", h3.state.topCard.color!), c.wild("pad")]);
    h3.act({ type: "PLAY_CARD", playerId: "u_ada", cardId: "rev" });
    expect(h3.state.direction).toBe(-1);
    expect(h3.currentPlayerId()).toBe("u_carol");

    const h2 = makeGame(["ada", "bob"], 33);
    h2.setHand("u_ada", [c.reverse("rev2", h2.state.topCard.color!), c.wild("pad2")]);
    h2.act({ type: "PLAY_CARD", playerId: "u_ada", cardId: "rev2" });
    expect(h2.currentPlayerId()).toBe("u_ada");
  });

  it("SKIP skips the next player", () => {
    const h = makeGame(["ada", "bob", "carol"], 41);
    h.setHand("u_ada", [c.skip("sk", h.state.topCard.color!), c.wild("pad")]);
    h.act({ type: "PLAY_CARD", playerId: "u_ada", cardId: "sk" });
    expect(h.currentPlayerId()).toBe("u_carol");
    expect(h.state.turnSeq).toBe(2); // one action, despite the skip
  });
});
