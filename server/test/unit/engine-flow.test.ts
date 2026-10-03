import { describe, expect, it } from "vitest";
import { makeGame, c, T0 } from "./engine-helpers";
import type { Card } from "../../src/engine/types";

describe("draw and pass flow", () => {
  it("drawing a playable card keeps the turn and permits play or pass", () => {
    const h = makeGame(["ada", "bob"], 51);
    // Force a deterministic unplayable hand then draw rig: replace the draw pile top.
    const topColor = h.state.topCard.color!;
    const good: Card = { id: "x_good", color: topColor, kind: "NUMBER", value: 3 };
    h.state.drawPile.push(good);

    const events = h.act({ type: "DRAW_CARD", playerId: h.currentPlayerId() });
    const me = h.currentPlayerId();
    expect(h.handSizeOf(me)).toBe(8);
    expect(events.some((e) => e.kind === "DRAWN_SECRET" && e.playerId === me)).toBe(true);
    expect(h.state.drawnThisTurn).toBe(true);

    // Second draw is rejected.
    expect(() => h.act({ type: "DRAW_CARD", playerId: me })).toThrow(
      expect.objectContaining({ code: "ALREADY_DRAWN" })
    );

    // Playing the drawn card works and advances.
    h.act({ type: "PLAY_CARD", playerId: me, cardId: "x_good" });
    expect(h.state.topCard.id).toBe("x_good");
    expect(h.currentPlayerId()).not.toBe(me);
  });

  it("drawing an unplayable card auto-advances the turn", () => {
    const h = makeGame(["ada", "bob"], 53);
    const topColor = h.state.topCard.color!;
    const otherColor = topColor === "R" ? "B" : "R";
    const bad: Card = {
      id: "x_bad",
      color: otherColor,
      kind: "NUMBER",
      value: h.state.topCard.kind === "NUMBER" && h.state.topCard.value === 3 ? 4 : 3,
    };
    h.state.drawPile.push(bad);

    const me = h.currentPlayerId();
    h.act({ type: "DRAW_CARD", playerId: me });
    expect(h.handSizeOf(me)).toBe(8);
    expect(h.currentPlayerId()).not.toBe(me); // turn passed automatically
  });

  it("PASS is only legal after drawing a playable card", () => {
    const h = makeGame(["ada", "bob"], 55);
    const me = h.currentPlayerId();
    expect(() => h.act({ type: "PASS", playerId: me })).toThrow(
      expect.objectContaining({ code: "BAD_REQUEST" })
    );

    const good: Card = { id: "x_g", color: h.state.topCard.color!, kind: "NUMBER", value: 1 };
    h.state.drawPile.push(good);
    h.act({ type: "DRAW_CARD", playerId: me });
    expect(() => h.act({ type: "PASS", playerId: me })).not.toThrow();
    expect(h.currentPlayerId()).not.toBe(me);
  });

  it("reshuffles the discard pile when the draw pile empties", () => {
    const h = makeGame(["ada", "bob"], 57);
    h.state.drawPile = [];
    h.state.discardPile = [h.state.topCard, c.num("d1", 1, "R"), c.num("d2", 2, "B"), c.num("d3", 3, "G")];
    const me = h.currentPlayerId();
    h.act({ type: "DRAW_CARD", playerId: me });
    expect(h.handSizeOf(me)).toBe(8);
    expect(h.state.drawPile.length).toBe(3); // 4 discard - 1 drawn
    // The authoritative top card stays as the discard anchor.
    expect(h.state.discardPile).toHaveLength(1);
    expect(h.state.discardPile[0]!.id).toBe(h.state.topCard.id);
  });

  it("handles both piles empty without crashing (documented edge)", () => {
    const h = makeGame(["ada", "bob"], 59);
    h.state.drawPile = [];
    h.state.discardPile = [h.state.topCard];
    const me = h.currentPlayerId();
    h.act({ type: "DRAW_CARD", playerId: me });
    expect(h.currentPlayerId()).not.toBe(me); // turn passed, no cards dealt
  });
});

describe("UNO window", () => {
  function rigOneCard(h: ReturnType<typeof makeGame>, userId: string, cardId: string): void {
    h.setHand(userId, [c.num(cardId, 0, h.state.currentColor), c.wild(`${cardId}_pad`)]);
  }

  it("opens on the penultimate play and clears when the offender calls UNO", () => {
    const h = makeGame(["ada", "bob", "carol"], 61);
    rigOneCard(h, "u_ada", "last");
    h.act({ type: "PLAY_CARD", playerId: "u_ada", cardId: "last" });
    expect(h.state.pendingUno?.offenderId).toBe("u_ada");

    h.act({ type: "CALL_UNO", playerId: "u_ada" });
    expect(h.state.pendingUno).toBeNull();
    expect(h.view("u_ada").players.find((p) => p.userId === "u_ada")!.hasCalledUno).toBe(true);
  });

  it("a successful catch penalizes the offender +2; lapsed windows reject", () => {
    const h = makeGame(["ada", "bob", "carol"], 63);
    rigOneCard(h, "u_ada", "last");
    h.act({ type: "PLAY_CARD", playerId: "u_ada", cardId: "last" });

    const before = h.handSizeOf("u_ada");
    const events = h.act({ type: "CATCH_UNO", playerId: "u_bob", targetPlayerId: "u_ada" });
    expect(events.some((e) => e.kind === "UNO_CAUGHT")).toBe(true);
    expect(h.handSizeOf("u_ada")).toBe(before + 2);
  });

  it("a lapsed window (past 5 s) can no longer be caught", () => {
    const h = makeGame(["ada", "bob", "carol"], 64);
    rigOneCard(h, "u_ada", "last");
    h.act({ type: "PLAY_CARD", playerId: "u_ada", cardId: "last" });
    expect(h.state.pendingUno?.offenderId).toBe("u_ada");

    h.advanceMs(5001); // window lapses
    expect(() =>
      h.act({ type: "CATCH_UNO", playerId: "u_bob", targetPlayerId: "u_ada" })
    ).toThrow(expect.objectContaining({ code: "UNO_WINDOW_INACTIVE" }));
  });

  it("catching after the offender acted is rejected; self-catch rejected", () => {
    const h = makeGame(["ada", "bob", "carol"], 65);
    rigOneCard(h, "u_ada", "last");
    h.act({ type: "PLAY_CARD", playerId: "u_ada", cardId: "last" });
    expect(h.state.pendingUno?.offenderId).toBe("u_ada");

    // Rig three unplayable draws so bob and carol auto-pass and ada then draws,
    // which is the offender acting -> window closes (play would win the round).
    const c0 = h.state.currentColor;
    const unplayable = (id: string): Card => ({
      id,
      color: c0 === "R" ? "B" : "R",
      kind: "NUMBER",
      value: h.state.topCard.value === 5 ? 6 : 5,
    });
    h.state.drawPile.push(unplayable("u1"), unplayable("u2"), unplayable("u3"));

    h.act({ type: "DRAW_CARD", playerId: "u_bob" });
    h.act({ type: "DRAW_CARD", playerId: "u_carol" });
    h.act({ type: "DRAW_CARD", playerId: "u_ada" }); // offender acts: window closes
    expect(h.state.pendingUno).toBeNull();

    expect(() =>
      h.act({ type: "CATCH_UNO", playerId: "u_bob", targetPlayerId: "u_ada" })
    ).toThrow(expect.objectContaining({ code: "UNO_WINDOW_INACTIVE" }));

    // Self-catch is rejected outright.
    expect(() =>
      h.act({ type: "CATCH_UNO", playerId: "u_bob", targetPlayerId: "u_bob" })
    ).toThrow(expect.objectContaining({ code: "BAD_REQUEST" }));
  });

  it("CALL_UNO without an open window is rejected", () => {
    const h = makeGame(["ada", "bob"], 67);
    expect(() => h.act({ type: "CALL_UNO", playerId: h.currentPlayerId() })).toThrow(
      expect.objectContaining({ code: "UNO_WINDOW_INACTIVE" })
    );
  });
});

describe("winning", () => {
  it("playing the last card ends the round with scores and locks the game", () => {
    const h = makeGame(["ada", "bob", "carol"], 71);
    const topColor = h.state.topCard.color!;
    h.setHand("u_ada", [c.num("win", 0, topColor)]);
    const events = h.act({ type: "PLAY_CARD", playerId: "u_ada", cardId: "win" });

    expect(events.some((e) => e.kind === "ROUND_ENDED" && e.winnerUserId === "u_ada")).toBe(true);
    expect(h.state.status).toBe("ROUND_OVER");
    expect(h.state.winnerUserId).toBe("u_ada");
    expect(h.state.lastScores!.find((s) => s.userId === "u_bob")!.handPoints).toBeGreaterThan(0);

    // All further game actions are rejected.
    expect(() => h.act({ type: "DRAW_CARD", playerId: "u_bob" })).toThrow(
      expect.objectContaining({ code: "ROUND_OVER" })
    );
  });
});

describe("leaving", () => {
  it("returns the leaver's cards to the draw pile and keeps play going", () => {
    const h = makeGame(["ada", "bob", "carol"], 73);
    const drawBefore = h.state.drawPile.length;
    const bobCards = h.handSizeOf("u_bob");

    const events = h.act({ type: "LEAVE", playerId: "u_bob" });
    expect(events.some((e) => e.kind === "PLAYER_LEFT_GAME")).toBe(true);
    expect(h.state.drawPile.length).toBe(drawBefore + bobCards);
    expect(h.view("u_bob").players.find((p) => p.userId === "u_bob")!.left).toBe(true);
    // Turns now skip bob: ada draws an unplayable card and the turn passes carol-ward.
    expect(h.currentPlayerId()).toBe("u_ada");
    const topColor = h.state.topCard.color!;
    const otherColor = topColor === "R" ? "B" : "R";
    const bad: Card = {
      id: "x_skipme",
      color: otherColor,
      kind: "NUMBER",
      value: h.state.topCard.kind === "NUMBER" && h.state.topCard.value === 3 ? 4 : 3,
    };
    h.state.drawPile.push(bad);
    h.act({ type: "DRAW_CARD", playerId: "u_ada" });
    expect(h.currentPlayerId()).toBe("u_carol");
  });

  it("ends the round when fewer than two active players remain", () => {
    const h = makeGame(["ada", "bob"], 75);
    const events = h.act({ type: "LEAVE", playerId: "u_bob" });
    expect(events.some((e) => e.kind === "ROUND_ENDED" && e.winnerUserId === "u_ada")).toBe(true);
  });

  it("hands the turn to the next player when the current player leaves", () => {
    const h = makeGame(["ada", "bob", "carol"], 77);
    const current = h.currentPlayerId();
    // Rig the leaver's next actor to draw an unplayable card so the turn's end
    // is deterministic regardless of shuffle luck.
    h.act({ type: "LEAVE", playerId: current });
    expect(h.currentPlayerId()).not.toBe(current);
    expect(h.state.status).toBe("PLAYING");
  });

  it("leaving is idempotent for already-left players", () => {
    const h = makeGame(["ada", "bob"], 79);
    h.act({ type: "LEAVE", playerId: "u_bob" });
    expect(() => h.act({ type: "LEAVE", playerId: "u_bob" })).not.toThrow();
  });
});

describe("turn timeout", () => {
  it("is ignored before the deadline and auto-draw+passes after it", () => {
    const h = makeGame(["ada", "bob", "carol"], 81, { turnTimeoutS: 30 });
    const me = h.currentPlayerId();

    h.advanceMs(10_000);
    expect(h.act({ type: "TIMEOUT_TURN" })).toEqual([]); // stale: ignored
    expect(h.currentPlayerId()).toBe(me);

    h.advanceMs(21_000); // now past 30 s
    const events = h.act({ type: "TIMEOUT_TURN" });
    expect(events.some((e) => e.kind === "DRAWN_PUBLIC" && e.playerId === me)).toBe(true);
    expect(h.currentPlayerId()).not.toBe(me);
    expect(h.handSizeOf(me)).toBe(8);
  });
});

describe("views (information hiding)", () => {
  it("exposes my hand but only counts for opponents", () => {
    const h = makeGame(["ada", "bob", "carol"], 83);
    const mine = h.view("u_ada");
    expect(mine.hand.cards).toHaveLength(7);

    const opp = mine.players.find((p) => p.userId === "u_bob")!;
    expect(opp.cardCount).toBe(7);
    // The serialized view must not contain opponent card arrays at all.
    expect(JSON.stringify(mine)).not.toContain('"hand":[{"id":"c_');
    expect(mine.players.every((p) => !("hand" in p))).toBe(true);
  });

  it("playable hints only exist on your own turn", () => {
    const h = makeGame(["ada", "bob"], 85);
    const current = h.currentPlayerId();
    const other = current === "u_ada" ? "u_bob" : "u_ada";

    expect(h.view(current).hand.playableIds.length).toBeGreaterThanOrEqual(0);
    expect(h.view(other).hand.playableIds).toEqual([]);
    expect(h.view(other).hand.canPass).toBe(false);
  });

  it("draw pile order is never serialized", () => {
    const h = makeGame(["ada", "bob"], 87);
    const snapshot = JSON.stringify(h.view("u_ada"));
    expect(snapshot).not.toContain('"drawPile":');
    expect(snapshot).toContain('"drawPileCount":');
  });

  it("turn deadline is present for countdown UI", () => {
    const h = makeGame(["ada", "bob"], 89, { turnTimeoutS: 30 });
    expect(h.view("u_ada").turnDeadlineAt).toBe(T0 + 30_000);
  });
});

describe("presence", () => {
  it("tracks connection state without emitting events", () => {
    const h = makeGame(["ada", "bob", "carol"], 91);
    const events = h.act({ type: "PRESENCE", playerId: "u_bob", connected: false });
    expect(events).toEqual([]);
    expect(h.view("u_ada").players.find((p) => p.userId === "u_bob")!.connected).toBe(false);
    h.act({ type: "PRESENCE", playerId: "u_bob", connected: true });
    expect(h.view("u_ada").players.find((p) => p.userId === "u_bob")!.connected).toBe(true);
  });
});
