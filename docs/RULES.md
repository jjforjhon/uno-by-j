# RULES.md — Normative game rules (server-side engine)

This file is the single source of truth for UNO-by-J gameplay. The server engine
implements exactly this; any deviation is a bug or must be reflected here first.

## 1. Deck

Official 108-card deck:

| Card | Count |
|---|---|
| 0 (per color) | 4 (one each) |
| 1–9 (per color) | 76 (two each × 4 colors) |
| Skip / Reverse / Draw 2 (per color) | 8 each (two each × 4 colors) |
| Wild | 4 |
| Wild Draw 4 | 4 |

## 2. Game flow

1. 2–10 players. Each dealt 7 cards. Remainder = draw pile.
2. Flip top card of the draw pile to start the discard. If it is not a number card,
   **reshuffle until a number card is on top** (deviation from official start handling;
   documented so resolution stays deterministic).
3. First player = seat 0 (dealer rotation per round: host → next seat each round).
4. Direction: clockwise; `Reverse` flips it (with exactly 2 players, `Reverse` acts as Skip).

## 3. Turn actions

- **PLAY_CARD**: card must be in the player's hand; playable if it matches the active
  color, matches the top card's kind, matches the top card's number, or is a Wild/Wild 4.
  - `Wild`/`Wild Draw 4` → the color is **chosen inline in the PLAY_CARD action**
    (`chosenColor` field); missing/invalid → `WILD_COLOR_REQUIRED` rejection.
    (Implementation decision: no separate CHOOSE_COLOR sub-state — fewer network
    round-trips, no abandon-mid-color state. `CHOOSE_COLOR` from the original
    PROTOCOL sketch is therefore removed from the wire protocol.)
  - `Wild Draw 4` → legal only if the player holds **no card of the active color**
    (other colors and wilds do not exempt). Enforced server-side. Challenge
    mechanic is out of scope for v1 (roadmap).
  - `Draw 2` → next player draws 2 and is **skipped** (official penalty behavior).
  - `Wild Draw 4` → next player draws 4 and is skipped.
  - `Skip` → next player loses their turn.
- **DRAW_CARD**: player draws 1. If the drawn card is playable they may play it or `PASS`;
  if not playable, turn auto-passes. Drawing twice in a turn is rejected.
- **PASS**: only immediately after drawing a playable card (turn passes).
- **CALL_UNO / CATCH_UNO**: a window opens when a player plays their penultimate card.
  It closes when (a) the offender calls `CALL_UNO`, (b) the offender next acts
  (plays/draws/passes/times out), or (c) **5 seconds elapse**, whichever first.
  A successful `CATCH_UNO` by another player inside the open window penalizes the
  offender +2 cards; catching is only valid if the offender still has exactly 1 card.
  (Implementation decision, documented: when the window lapses uncaught, the offender
  is **not** auto-penalized — the window simply closes. Bounding the window at 5 s
  keeps the social pressure of a real-time call while avoiding server-side expiry
  timers for a rule that needs them only marginally.)

## 4. Winning / scoring

- Round ends immediately when a player plays their last card.
- Round scoring: cards left in others' hands → number = face value, Skip/Reverse/Draw2 = 20,
  Wild/Wild4 = 50; credited to the round winner.
- Match mode (room toggle, default off): first to 500 wins the match; otherwise each round
  is standalone.

## 5. Draw pile exhaustion

When the draw pile is empty: shuffle the discard pile minus its top card back in.
If both piles are somehow empty (extreme edge), the current turn auto-passes.

## 6. Turn timer / AFK

- Turn timeout: **30 s**. On expiry the server auto-draws 1 and passes (never stalls).
- The timer is announced in state (`turnDeadlineAt`) so clients can render a countdown.
- Disconnects do **not** pause the game: the seat is kept, the timer keeps running.

## 7. Disconnect / leave

- Disconnect: seat retained; reconnect restores the full private view via `SNAPSHOT`.
- Leave mid-game: the player's hand returns to the bottom of the draw pile; play
  continues. If fewer than 2 active players remain, the round ends; remaining players
  win/share by score. The last player able to leave claims host status for the room.

## 8. Rematch

- After a round ends, any player may send `READY`; when all connected players are ready
  (or 10 s after the first), a new round deals with the next dealer. Seats/shuffle are
  re-randomized except dealer rotation.
