# ARCHITECTURE — Online Multiplayer UNO-style Android Game

Status: **Phase 5 complete** (authoritative engine + auth + rooms: 95 tests green).
The engine is pure, platform-free TypeScript with seeded-RNG determinism, sanitized
per-viewer projections, and the full rule matrix from RULES.md. Phases 1–4 done
previously. Verified facts are dated. Nothing else here should be trusted as "done"
until the corresponding phase is implemented and tested.

Game title: **UNO by J** (user-confirmed). Trademark note: "UNO" is a Mattel trademark —
acceptable for a hobby build; revisit naming before any Play Store release.

---

## 0. Verified free-tier facts (checked 2026-10-01)

| Provider | Fact | Source |
|---|---|---|
| Cloudflare Workers Free | 100,000 req/day; **10 ms CPU per invocation** (exceeding → error 1102) | developers.cloudflare.com/workers/platform/pricing · /limits |
| Cloudflare DO Free | 100,000 req/day (WS *incoming* messages billed 20:1, outgoing messages **free**); 13,000 GB-s/day duration; 5M SQLite row reads/day; 100k row writes/day; 5 GB storage | developers.cloudflare.com/durable-objects/platform/pricing |
| Cloudflare DO hibernation | Hibernating WebSockets incur **no duration cost**; `setWebSocketAutoResponse` pings are free | DO pricing doc |
| Cloudflare D1 Free | 5M rows read/day, 100k rows written/day, 5 GB | workers pricing doc |
| Oracle Always Free | **Halved June 2026**: Ampere A1 now 2 OCPU / 12 GB RAM (was 4/24), 200 GB block storage total | docs.oracle.com + InfoQ 2026-07-03 |
| SimpleWebAuthn | MIT-licensed, WebAuthn server lib that runs on Workers (uses WebCrypto) | github.com/MasterKale/SimpleWebAuthn |

Consequences that shaped the design:

1. **10 ms CPU limit → no JS password-hashing libraries on the Free plan.** bcrypt/argon2 JS
   blow the CPU budget. WebCrypto-native PBKDF2 (~5–15 ms at 600k iterations, native code, no
   JS loop) fits, and passkeys (WebAuthn) are even cheaper. This is why auth is
   passkey-first + guest, with optional PBKDF2 passwords.
2. **WS hibernation makes a room essentially free while idle**, and outgoing server pushes cost
   nothing. A full 4-player game session is well inside the free daily budget.
3. **Oracle is a real fallback but weaker than older articles claim** (2 OCPU/12 GB). The
   fallback is designed but Cloudflare-first.

---

## 1. Recommended architecture (summary diagram)

```
┌─────────────────────────── Android app (Kotlin, Jetpack Compose) ───────────────────────────┐
│  UI (Compose) · GameClient · StateStore · Net (OkHttp WSS) · SecureStore (Keystore)         │
└──────────────────────────────── HTTPS / WSS (TLS only) ─────────────────────────────────────┘
                                          │
                     ┌────────────────────▼─────────────────────┐
                     │      Cloudflare Worker (TypeScript)      │
                     │  router · authn/authz · rate limiting    │
                     │  /auth/* /profile/* /room/* /ws/room/:code│
                     └──────┬─────────────────────┬─────────────┘
                            │ (D1 SQL)            │ (stub fetch, validated session)
                  ┌─────────▼─────────┐   ┌───────▼──────────────────────┐
                  │  D1 (SQLite, free)│   │  RoomDO (Durable Object)     │
                  │  users, creds,    │   │  1 DO per room = per game    │
                  │  refresh tokens,  │   │  authoritative game state    │
                  │  memberships,     │   │  hibernating WebSockets      │
                  │  chat rows,       │   │  turn timers (alarms)        │
                  │  reports, blocks  │   │  seq numbers, idempotency    │
                  └───────────────────┘   └──────────────────────────────┘
```

- **One Durable Object per room** (`RoomDO`, idFromName(roomCode)). A DO is single-threaded, so
  all game mutations are serialized for free — no race conditions on turn state. This is the
  core reason DOs beat "stateless Workers + KV" for turn-based games.
- The Worker is stateless: it authenticates, authorizes, rate-limits, then forwards the
  authenticated request/WebSocket to the right DO.
- D1 stores durable facts only (accounts, tokens, room membership, chat log, reports). The DO's
  own SQLite keeps live game state (deal, hands, discard, seq, idempotency window).
- **Google Drive: not used at all** in the real-time path. Not needed for v1; optional later for
  exporting backups of D1 dumps (non-real-time only).

Why this is the right shape: turn-based card games need *a single consistent writer per room*.
DOs give exactly that, plus native WebSocket hibernation designed for this workload, on a free
tier that is genuinely sufficient for a hobby/mid-size player base.

---

## 2. Android stack (all open source)

| Concern | Choice | Notes |
|---|---|---|
| Language | Kotlin 2.x | |
| UI | Jetpack Compose + Material 3 | single-Activity, no Fragments |
| Architecture | MVVM + unidirectional data flow (state in `StateFlow`) | ViewModel per screen, `GameClient` owns live game state |
| DI | Hilt | |
| Networking | OkHttp + Kotlinx Serialization | WSS for game, HTTPS for auth/lobby |
| Async | Coroutines + Flow | |
| Secure storage | EncryptedSharedPreferences (androidx.security-crypto) backed by Android Keystore | refresh token never in plain prefs |
| Images/avatars | Compose Canvas + vector drawables (procedural, original) | no image-loading lib needed |
| Animations | Compose animation APIs (`animateContentSize`, `Animatable`, transitions) | all state-driven, never blocking input |
| Tests | JUnit + Turbine + Compose UI tests | |
| Min SDK | 26 | Compose + EncryptedSharedPreferences comfort |

Rendering the hand is the only performance-sensitive area: use a fan layout with lazy
composition; avoid `Modifier.graphicsLayer` overdraw; keep 60 fps on mid-range via state-driven
recomposition only.

---

## 3. Backend stack

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Cloudflare Worker (TypeScript) | free tier, global edge |
| Live rooms | Durable Objects (SQLite backend, WS hibernation) | free tier |
| Durable DB | Cloudflare D1 (SQLite) | free tier |
| Validation | hand-rolled TS schemas (no heavy deps) | tiny bundle = faster cold start |
| Password hash | WebCrypto PBKDF2-SHA-256, 600k iterations, per-user 16-byte salt | native, fits 10 ms CPU |
| Passkeys | SimpleWebAuthn (server) + Android Credential Manager (client) | MIT |
| Tokens | HS256 JWT access (15 min) + opaque rotating refresh (30 d, hashed at rest) | |
| Tests | Vitest (engine is pure TS, no worker runtime needed) + `@cloudflare/vitest-pool-workers` for DO integration | |
| Deploy | Wrangler, single command | |

### Oracle fallback (designed, not primary)
Single ARM VM (2 OCPU/12 GB): Nginx (TLS via Let's Encrypt) → Node 22 + the **same** engine
package (pure TS, zero CF-specific code) + SQLite (WAL) or Postgres. The engine and protocol
packages are deliberately platform-agnostic so only the "host adapter" layer changes
(DO ↔ single-process in-memory room registry + loopback WS server). This is a Phase 9+ contingency,
not v1 work.

---

## 4. Database (D1 schema — normalizing only what is durable)

```sql
users            (id TEXT PK, handle TEXT UNIQUE, display_name TEXT, avatar_id INT,
                  is_guest INT, created_at INT, last_seen_at INT, state TEXT)  -- state: ACTIVE/BANNED
auth_credentials (id TEXT PK, user_id TEXT FK, kind TEXT,        -- 'PASSKEY'|'PASSWORD'
                  secret BLOB,                                   -- passkey pubkey or PBKDF2 hash
                  salt BLOB, iterations INT, sign_count INT, transports TEXT, created_at INT)
refresh_tokens   (id TEXT PK, user_id TEXT FK, token_hash TEXT UNIQUE, family_id TEXT,
                  expires_at INT, revoked_at INT, created_at INT)   -- rotation + reuse detection
rooms            (code TEXT PK, host_user_id TEXT, is_public INT, settings_json TEXT,
                  created_at INT, closed_at INT)
room_members     (room_code TEXT FK, user_id TEXT FK, role TEXT, joined_at INT,
                  left_at INT, PRIMARY KEY(room_code, user_id))
game_sessions    (id TEXT PK, room_code TEXT, status TEXT, started_at INT, ended_at INT,
                  winner_user_id TEXT, scores_json TEXT, event_count INT)
chat_messages    (id TEXT PK, room_code TEXT, sender_user_id TEXT, body TEXT,
                  created_at INT)                                  -- capped length, indexed by room+time
blocks           (blocker_user_id TEXT, blocked_user_id TEXT, created_at INT, PK(blocker,blocked))
reports          (id TEXT PK, reporter_user_id TEXT, target_user_id TEXT, room_code TEXT,
                  category TEXT, message_id TEXT, created_at INT, status TEXT)
auth_attempts    (id TEXT PK, user_handle TEXT, ip_hash TEXT, ok INT, at INT)  -- brute-force data
security_events  (id TEXT PK, kind TEXT, user_id TEXT, room_code TEXT, detail TEXT, at INT)
```

Live game state is **not** in D1 — it lives in the RoomDO (in memory + its own SQLite for
crash recovery). D1 gets one row per finished game (`game_sessions`).

Abstraction layer: `db/repo/*.ts` repositories are the only code touching SQL; swapping D1 for
Postgres later touches only that layer + the DO host adapter.

---

## 5. Real-time protocol (over WSS, JSON, TLS)

### Client → Server
| type | payload | notes |
|---|---|---|
| `HELLO` | `{token}` | sent on every WS connect; server authenticates before anything else |
| `JOIN_ROOM` | `{code}` | server verifies membership/seat |
| `PLAY_CARD` | `{actionId, cardId, chosenColor?}` | wild requires `chosenColor` |
| `DRAW_CARD` | `{actionId}` | |
| `PASS` | `{actionId}` | after drawing a playable card (if draw-to-play off) |
| `CALL_UNO` | `{actionId}` | |
| `CATCH_UNO` | `{actionId, targetPlayerId}` | |
| `CHOOSE_COLOR` | `{actionId, color}` | wild sub-state |
| `READY` / `LEAVE` / `CHAT_SEND` | … | |
| `SYNC_REQ` | `{sinceSeq}` | gap recovery |

### Server → Client
| type | payload |
|---|---|
| `WELCOME` | `{you: {userId, seat}, roomSeq}` |
| `SNAPSHOT` | full *sanitized* state + `seq` (on join, reconnect, or gap) |
| `EVENT` | `{seq, kind, ...}` — e.g. `CARD_PLAYED` (public info only), `CARD_DRAWN` (to the drawer: the card; to others: count only), `TURN_CHANGED`, `COLOR_CHOSEN`, `UNO_CALLED`, `UNO_CAUGHT`, `ROUND_ENDED`, `PLAYER_JOINT/LEFT/DISCONNECTED/RECONNECTED`, `CHAT` |
| `ERROR` | `{reqId, code}` — never internal details |
| `PONG` | heartbeat ack |

Rules that make this safe & robust:

- **Sanitization by construction**: the DO builds per-connection views. Your `SNAPSHOT` contains
  your hand; everyone else's hand is `cardCount`. Hidden cards never leave the server.
- **Sequence numbers**: every `EVENT` carries a monotonically increasing room `seq` (persisted in
  DO SQLite). Client tracks `lastSeq`; gap → `SYNC_REQ` → fresh `SNAPSHOT`. No client-side
  extrapolation is ever authoritative.
- **Idempotency**: every mutating client action carries `actionId` (UUID). DO keeps a
  recent-action window per player; a duplicate gets the original result, not a second execution.
- **Heartbeat**: client ping every 20 s; server `setWebSocketAutoResponse` replies without waking
  the DO (free). No ping in 45 s → server marks player disconnected (seat retained).

---

## 6. Authentication design

- **Primary: passkeys** (WebAuthn) via Android Credential Manager ↔ SimpleWebAuthn on the
  server. No password exists; nothing to leak; free; open source. Handles/username are chosen at
  registration. Fallback: **guest accounts** (server-generated identity, credential stored in
  Keystore; can be upgraded to a passkey later — same `users` row gains a credential).
- **Optional: password** for users who insist: PBKDF2-SHA-256, 600k iterations, 16-byte random
  salt (WebCrypto, native, fits the 10 ms CPU budget — measured-class, will be verified in
  Phase 3 with a real benchmark; if it exceeds budget the client performs an iteration-count
  negotiation or password auth ships disabled rather than weaken KDF).
- **Tokens**: access JWT (HS256, 15 min, secret in a Wrangler *secret*, never in the APK) +
  rotating refresh token (30 d): each use rotates it; presenting a rotated-out token revokes the
  whole token family (reuse detection = stolen-token containment). Refresh tokens stored
  SHA-256-hashed in D1.
- **Brute force**: `auth_attempts` log keyed by handle + salted-hash-of-IP; exponential backoff
  per handle and per IP bucket in the Worker (no paid WAF needed).
- Android stores the refresh token in EncryptedSharedPreferences; access token in memory only.

### Android security
No secrets in the APK (verified in review: only the public API base URL ships). No third-party
analytics SDKs (data minimization, §20). `INTERNET` is the only dangerous permission.

---

## 7. Chat architecture

- **Room chat** lives in the same RoomDO (free fan-out to connected sockets) and is persisted to
  D1 (`chat_messages`, capped 280 chars, 5 msg/10 s per user, burst bucket). Reconnect gets last
  50 messages from D1.
- **Direct messages**: architecture reserved (per-conversation DO + D1 rows) but **not built in
  v1** — stated explicitly, not silently dropped. It rides the same auth + block lists.
- **Not E2E encrypted.** Server-mediated transport encryption only (TLS/WSS). The server sees
  message content by design (it must, for moderation/reporting). No false claims anywhere in UI
  or docs.
- **Block**: prevents the blocked user from DMing you (future) and excludes you both from
  matching into the same public quick-play room. It does not eject someone from an already-joined
  private room (documented scope decision).
- **Report**: stored with room + optional message id; reviewed via admin SQL; abusive handle
  → `users.state='BANNED'` (auth rejects banned users).

---

## 8. Security model & threat model

**Principle: the client is hostile.** All state transitions are computed server-side in the DO.

| Threat | Mitigation |
|---|---|
| Forged turn / forged card (modified APK) | DO owns game state; `PLAY_CARD` validated against authoritative hand + turn + rules; client hints are ignored |
| Seeing other hands (packet sniff or malicious client) | per-connection sanitized views; other hands are never serialized |
| Replay / duplicate actions | `actionId` idempotency window + room `seq`; stale seq actions rejected |
| Token theft | short access TTL, rotating refresh + family revocation, TLS-only, Keystore storage |
| Brute force / credential stuffing | PBKDF2 server-side, per-handle & per-IP backoff, generic error messages (no user enumeration: same error for unknown user and wrong password) |
| Unauthorized room access | room codes are 6-char unguessable; private rooms require code + join; membership checked on every action; WS upgrade re-checks token + membership |
| DoS / spam | WS message size caps (e.g. 4 KB), 10 msgs/s per socket, chat 5/10 s, room-create 3/hour/user, connection cap 2/device... (per-user), payload schema validation, fast rejects (cheap CPU) |
| Hostile payloads | strict schema decode, enum-only fields, integer bounds; unknown fields dropped |
| Information leakage | `ERROR` codes are stable enum values; internal exceptions logged server-side only (`security_events`), never returned |
| Admin abuse | no admin surface in v1; moderation = D1 queries from the dashboard (access protected by CF Access later) |

Known residual risks (honest list): Cloudflare account compromise = game over (mitigate with 2FA
on the CF account); a banned user can re-register free guests (mitigation: device-attestation is
a possible later add-on using Play Integrity — free tier — but not planned for v1); chat
moderation is reactive only.

---

## 9. Free-hosting strategy

**Primary: Cloudflare Free** — Workers + DO (SQLite) + D1. Cost at realistic hobby load (≈
50 concurrent games, ≈ 2 actions/s/player, hibernating between turns): a few thousand
billing-request-units/day and near-zero duration (hibernation) → far below 100k req/day and
13k GB-s/day. Verified math above; will be re-verified with real metrics in Phase 10.

**Not used**: Google Drive (wrong tool for real-time; and even for assets it adds fragility) —
instead, app assets ship **inside the APK** (vector art, tiny). If remote assets/config are ever
needed: Cloudflare R2/KV free tier or a static file on Workers — not Drive.

**Fallback: Oracle Always Free** (2 OCPU/12 GB ARM) with the platform-agnostic engine.
Migration is a host-adapter swap, documented in §3.

Risk of free tiers changing: they demonstrably do (Oracle halved in 2026). The mitigations are
(b) provider-agnostic engine/protocol packages, (b) D1-repository abstraction, and (c) the
documented Oracle path. No architecture decision may hard-code Cloudflare beyond `db/`, `room/`
and `index.ts`.

---

## 10. Project folder structure (monorepo)

```
/                      repo root
├─ docs/               ARCHITECTURE.md · PROTOCOL.md · RULES.md · SECURITY.md
├─ server/             Cloudflare Worker (TypeScript)
│  ├─ src/
│  │  ├─ index.ts          Worker entry: routes, CORS, rate limits, WS upgrade
│  │  ├─ auth/             passkey + password + tokens + attempts
│  │  ├─ db/               D1 repos + migrations (schema.sql)
│  │  ├─ room/RoomDO.ts    Durable Object: sockets, timers, persistence, views
│  │  ├─ engine/           ★ pure UNO engine (no CF imports at all)
│  │  │   ├─ types.ts deck.ts state.ts rules.ts actions.ts views.ts
│  │  ├─ protocol/         message codecs shared with Android golden tests
│  │  └─ util/             ids, rng, token bucket, logging
│  ├─ migrations/0001_init.sql
│  ├─ test/                engine unit + DO integration + security tests
│  └─ wrangler.toml
├─ protocol/           JSON message reference + golden fixtures (parity tests)
├─ android/            Gradle project
│  ├─ app/             UI layer (screens, design system, animations)
│  ├─ core:network     WSS/HTTPS client, reconnection manager
│  ├─ core:game        GameClient, state store, event reducer
│  ├─ core:model       Kotlin mirrors of protocol types
│  └─ core:design      theme, typography, card renderer, avatar system
└─ scripts/            deploy.sh · seed.ts · loadtest (k6-free alternative: custom WS harness)
```

Parity strategy: protocol messages have golden JSON fixtures; both TS and Kotlin codecs are
tested against the same fixtures, so a desync is caught in CI, not in production.

---

## 11. Data model (live game state, inside the RoomDO)

```ts
GameState {
  gameId: string; roomCode: string
  status: 'WAITING' | 'PLAYING' | 'ROUND_OVER' | 'MATCH_OVER'
  direction: 1 | -1
  currentPlayerIndex: number          // seat order
  currentColor: Color                 // active color (≠ topCard color when wild was last)
  topCard: Card
  drawPileCount: number
  players: PlayerState[]              // seat order
  turnSeq: number                     // increments per action; basis for idempotency & timers
  awaiting: null | { kind: 'CHOOSE_COLOR', playerId } 
                    | { kind: 'UNO_WINDOW', offenderId, deadlineAt }
                    | { kind: 'PENDING_DRAW', playerId, count }   // only if stacking enabled
  timers: { turnDeadlineAt: number }
}
PlayerState {
  userId, seat, displayName, avatarId
  hand: Card[]                        // server-only; never serialized to others
  connected: boolean; isHost: boolean
  score: number                       // match mode
  hasCalledUno: boolean
}
Card { id: string; color: R|G|B|Y|W; kind: NUMBER|SKIP|REVERSE|DRAW2|WILD|WILD4; value?: 0..9 }
```

Server → client `SNAPSHOT` strips `hand` for everyone but you and replaces it with `cardCount`.

---

## 12. UNO state machine & rule decisions (full rules in docs/RULES.md)

States: `WAITING → PLAYING → ROUND_OVER → (MATCH_OVER | PLAYING(rematch))`, `CLOSED` on abandon.

Action sub-states inside `PLAYING`:
```
TURN_IDLE ──PLAY_CARD(number/action)──► advance turn ──► TURN_IDLE(next)
TURN_IDLE ──PLAY_CARD(WILD)──► AWAIT_COLOR(same player, 15 s) ──CHOOSE_COLOR─► advance
TURN_IDLE ──PLAY_CARD(WILD4)──► legality check (no card of currentColor in hand) ─► AWAIT_COLOR
TURN_IDLE ──PLAY_CARD(DRAW2/DRAW4)──► penalty auto-applies to next player (official: draw & skip)
TURN_IDLE ──DRAW_CARD──► card added; playable? player may play it (official) or PASS
penultimate card played ──► UNO_WINDOW(deadline) ──CALL_UNO by offender──► cleared
                                      ──CATCH_UNO by other + timer expires/next action──► +2 penalty
TURN_IDLE ──turn timer (30 s) expires──► auto-draw 1 + pass (AFK rule; documented)
```

Explicit rule decisions (all configurable per-room where marked):
1. Deck: official 108 cards.
2. Starting flip: if an action/wild card is flipped, **reshuffle until a number card** (documented deviation from official start-of-game handling; keeps resolution deterministic).
3. Draw-then-must-play: **off** by default (official allows keeping the drawn card).
4. Stacking (+2 on +2, +4 on +4): **off** by default, room toggle (documented deviation).
5. Wild Draw 4 legality enforced server-side; **challenge mechanic omitted in v1** (documented simplification — will be listed on the roadmap, not hidden).
6. Reverse with 2 players acts as skip (official).
7. UNO call window: until the offender's next action or 5 s elapse, whichever first; caught → draw 2.
8. Turn timeout: 30 s → server auto-draw+pass. AFK players cannot stall games.
9. Scoring: number = face value, actions = 20, wilds = 50. Match mode: first to 500 (toggle; default single-round).
10. Reshuffle when the draw pile empties (discard minus top card, random order).
11. Disconnect mid-game: seat is kept; turn timer still runs (auto-draw+pass) so a game never
    stalls. After the round the seat is freed if the player hasn't returned.
12. Leave mid-game: hand is returned to the bottom of the draw pile; play continues; fewer than
    2 active players ends the round (remaining players share the win by points).

The engine is a set of pure functions: `apply(state, action, playerId, now) → { state', events[] }`
plus `views(state, viewerId)`. All validation lives there; the DO only handles sockets, timers
and persistence. This is what makes the engine unit-testable on any runtime.

---

## 13. Development phases (each ends with verification gate)

| Phase | Deliverable | Gate |
|---|---|---|
| 1 | this document + decisions | user sign-off |
| 2 | monorepo scaffold, CI, golden fixtures, docs/RULES+PROTOCOL | `pnpm test` + `gradle build` green |
| 3 | auth (passkey+guest+password, tokens, rate limits) + tests | integration tests vs DO/D1 |
| 4 | rooms (create/join/codes/membership/host migration) | integration tests |
| 5 | authoritative engine + full rules test suite | ~40 engine tests green |
| 6 | WS sync (hibernation, seq, idempotency, reconnect) | 2-client integration test incl. reconnect |
| 7 | Android UI (design system, lobby, game screen, animations) | manual + compose tests on 2 sizes |
| 8 | chat + block/report | unit + integration tests |
| 9 | hardening pass (limits, abuse, security tests) | security test suite green |
| 10 | performance + device matrix + real deploy | deployed to CF free, soak test |
| 11–12 | polish, release prep (signing, privacy policy, store listing) | release checklist |

---

## 14. Major risks

| Risk | Impact | Mitigation |
|---|---|---|
| Cloudflare free-tier terms change again | hosting breaks | provider-agnostic engine; documented Oracle path; D1 repo abstraction |
| 10 ms CPU budget exceeded by PBKDF2 | password auth fails | verify early (Phase 3 benchmark); passkeys are primary anyway; ship password only if benchmark passes |
| DO request-per-day ceiling at scale | outages at ~100k req/day | hibernation + 20:1 WS billing keeps us far below; load test in Phase 10 gives a real ceiling number |
| Protocol drift TS↔Kotlin | subtle bugs | golden fixtures tested on both sides |
| Chat abuse on a free backend | moderation burden | strict limits, block/report, ban state; no open DMs in v1 |
| Single-maintainer scope creep | abandonment | phased gates, everything vertical-slice shippable |
| Oracle "always free" reclamation/availability | fallback weaker than hoped | it is a fallback, not the plan; engine is portable |

---

## 15. Alternatives considered and why rejected

| Option | Verdict | Reason |
|---|---|---|
| Firebase Realtime DB / Firestore | ✗ | closed source, paid beyond small quotas, vendor lock-in on rules-based security |
| Supabase (Postgres + Realtime) | ✗ for real-time | generous free tier but Realtime auth for per-room game state is awkward (Postgres RLS as game validator), projects pause after inactivity — bad for a game |
| Colyseus self-hosted | ✗ as primary | needs an always-on VM; that's the Oracle fallback role, not primary |
| Play games services (real-time multiplayer) | ✗ | deprecated real-time MP APIs, Android-only, no chat control |
| Stateless Workers + KV only | ✗ | KV is eventually consistent; turn order needs a single writer (race conditions on concurrent plays) |
| WebSocket server on Oracle only | ✗ as primary | single region, ops burden (TLS, patching, uptime); great as fallback |
| Google Drive as sync server | ✗ | violates latency, consistency, rate limits, TOS-shaped misuse; explicitly excluded by requirements |
| gRPC instead of JSON WSS | ✗ | adds client weight + codegen for marginal gain on ~10 message types |
| MQTT (e.g. free public broker) | ✗ | no authoritative compute, no per-room security |

---

## 16. Evidence status (per requirement 24)

- Verified (2026-10-01, official docs): CF free limits incl. 10 ms CPU, DO pricing/hibernation,
  D1 quotas, Oracle A1 reduction, SimpleWebAuthn Workers compatibility.
- Designed but unverified: PBKDF2-at-600k fitting 10 ms on real CF runtime (Phase 3 benchmark);
  actual DO request/day consumption under load (Phase 10 soak test); reconnect UX on real mobile
  networks (Phase 7 device testing).
- Theoretical/roadmap: DMs, +4 challenge mechanic, quick-match pairing with block-avoidance,
  Play Integrity attestation, end-to-end anything (explicitly out of scope for chat v1).

Nothing will be labeled "secure"/"production-ready" in code or docs until Phases 9–10 gates pass.
