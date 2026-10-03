# PROTOCOL.md — Client ↔ Server messages (WSS, JSON, TLS only)

Normative message schemas. Both the TypeScript server and the Kotlin client implement
these; golden fixtures in `protocol/fixtures/` are tested against both (parity gate).

## REST endpoints (implemented Phases 3–4)

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /auth/guest` | – | create guest, returns token pair |
| `POST /auth/refresh` | refresh token | rotate; reuse revokes the family |
| `POST /auth/logout` | refresh token | revoke family |
| `GET /me` | Bearer | identity |
| `POST /room` | Bearer | create room `{isPublic, isQuickplay, maxPlayers?, settings?}` |
| `POST /room/quickplay` | Bearer | pair into oldest eligible ticket, else create one |
| `POST /room/:code/join` | Bearer | join (idempotent); `409 ROOM_FULL` when seats gone |
| `POST /room/:code/leave` | Bearer | leave; host migrates; last leave closes room |
| `GET /room/:code` | Bearer member | room view (members, host, settings) |
| `GET /my/rooms` | Bearer | active memberships |

Error envelope: `{ "error": { "code": "<STABLE_CODE>" } }`.

## Envelope

Client→Server (C2S):
```json
{ "v": 1, "type": "<TYPE>", "reqId": "uuid", "d": { ... } }
```
Server→Client (S2C):
```json
{ "v": 1, "type": "<TYPE>", "seq": 42, "d": { ... } }
```
- `v` protocol version (reject mismatches)
- `reqId` client-generated id; server echoes it in the matching `ACK`/`ERROR` (idempotency key)
- `seq` monotonically increasing per room; clients track `lastSeq` and request `SYNC_REQ`
  when they detect a gap

## C2S messages

| type | d | notes |
|---|---|---|
| `HELLO` | `{ token }` | first message after connect; auth or close |
| `JOIN_ROOM` | `{ code }` | HTTP alternative: `POST /room/join` |
| `PLAY_CARD` | `{ actionId, cardId, chosenColor? }` | wilds require `chosenColor` inline |
| `DRAW_CARD` | `{ actionId }` | |
| `PASS` | `{ actionId }` | only after drawing a playable card |
| `CALL_UNO` | `{ actionId }` | offender, inside the 5 s window |
| `CATCH_UNO` | `{ actionId, targetPlayerId }` | others, while the window is open |
| `READY` | `{}` | rematch vote |
| `LEAVE` | `{}` | graceful leave |
| `CHAT_SEND` | `{ body }` | 1–280 chars after trim |
| `SYNC_REQ` | `{ sinceSeq }` | gap recovery → SNAPSHOT |
| `PING` | `{}` | keepalive (server also has auto-response) |

## S2C messages

| type | d | notes |
|---|---|---|
| `WELCOME` | `{ you: {userId, seat}, roomSeq }` | after HELLO+JOIN |
| `SNAPSHOT` | `{ room, game? , seq }` | full sanitized view for **you** |
| `EVENT` | `{ kind, seq, ... }` | room/game events (below) |
| `ACK` | `{ reqId, ok, applied? }` | your action was applied |
| `ERROR` | `{ reqId?, code }` | stable enum codes only |
| `PONG` | `{}` | |

### EVENT kinds
`PLAYER_JOINED` · `PLAYER_LEFT` · `PLAYER_DISCONNECTED` · `PLAYER_RECONNECTED` ·
`HOST_CHANGED` · `GAME_STARTED` · `TURN_CHANGED` · `CARD_PLAYED` (public part: player, cardId,
kind, value, new active color, counts) · `CARD_DRAWN` (to drawer: the card; to others: count
only — **sanitization by construction**) · `COLOR_CHOSEN` · `UNO_CALLED` · `UNO_CAUGHT` ·
`PENALTY_APPLIED` · `ROUND_ENDED` (scores) · `CHAT` (id, senderId, senderName, body, ts) ·
`DEALING` (card counts) · `ROOM_CLOSED`

## ERROR codes (stable enum)

`AUTH_REQUIRED` · `AUTH_EXPIRED` · `BAD_MESSAGE` · `RATE_LIMITED` · `ROOM_NOT_FOUND` ·
`ROOM_FULL` · `NOT_MEMBER` · `GAME_NOT_STARTED` · `NOT_YOUR_TURN` · `CARD_NOT_OWNED` ·
`CARD_NOT_PLAYABLE` · `WILD_COLOR_REQUIRED` · `DRAW4_ILLEGAL` ·`ALREADY_DRAWN` · `UNO_WINDOW_INACTIVE` · `ALREADY_READY` · `BANNED` · `SERVER_BUSY`

## Limits (server-enforced)

- WS text frame ≤ 4 KB; C2S rate 10 msg/s per socket (burst 20)
- Chat: 5 msgs / 10 s per user; messages trimmed to 280 chars
- Room create: 3/hour/user; quick-play ticket: 1 active per user
- HELLO timeout 10 s after connect; heartbeat: client ping ≤ 45 s, server auto-response
- Payloads strictly schema-validated; unknown fields dropped; no free-form strings except
  display name (2–24 chars, trimmed) and chat body (280)
