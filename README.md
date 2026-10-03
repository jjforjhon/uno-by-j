# UNO by J

Online multiplayer UNO-style card game for Android — authoritative server, free-tier
infrastructure, original visual identity.

## Status

| Phase | Scope | Status |
|---|---|---|
| 1 | Architecture & technology selection | ✅ done — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| 2 | Repository/project scaffold | ✅ done — Android app builds (`:app:assembleDebug` green) |
| 3 | Authentication — guest slice | ✅ done — 39 tests green (unit + integration on workerd/D1) |
| 4 | Room system — create/join/leave, host migration, quick-play | ✅ done — 58 tests green (unit + integration on real D1) |
| 5 | Authoritative UNO engine — full rule matrix, sanitized views | ✅ done — 95 tests green; engine is pure TS, deterministic |
| 6 | WebSocket sync & Durable Object lifecycle | ✅ done — hibernation, seq ordering, idempotency, snapshot recovery |
| 7 | Android client UI & navigation | ✅ done — Jetpack Compose, Material 3, card rendering, game & lobby views |
| 8 | In-game & lobby chat with moderation | ✅ done — real-time chat, blocking & reporting, unread badges |
| 9 | Hardening & abuse prevention | ✅ done — rate limits, oversized frame rejection, turn timeout alarms, client backoff & jitter |
| 10 | Performance, soak benchmarks & deploy readiness | ✅ done — 117/117 server tests green, 26KB gzipped worker, debug + release APKs built |
| 11 | Final polish, UX edge cases & feedback | ✅ done — haptic feedback, rematch lifecycle, round score breakdown, winner celebration |
| 12 | Final release packaging & distribution prep | ✅ done — [docs/RELEASE.md](docs/RELEASE.md), [docs/PRIVACY_POLICY.md](docs/PRIVACY_POLICY.md), [docs/STORE_LISTING.md](docs/STORE_LISTING.md) |

## Layout

```
android/    Gradle project (Kotlin 2.0, Compose, Hilt, minSdk 26)
docs/       ARCHITECTURE · RULES (normative gameplay) · PROTOCOL (normative wire) · BUILDING
protocol/   golden fixtures shared by TS server tests and Kotlin client tests (Phase 5+)
server/     Cloudflare Worker + Durable Objects (Phase 3+)
```

## Build

See [docs/BUILDING.md](docs/BUILDING.md). Quick version:

```bash
cd android && ./gradlew :app:assembleDebug
```

## Key invariants (from docs/ARCHITECTURE.md)

- The server is authoritative; clients render and suggest, never decide.
- Opponent hands never leave the server (sanitized per-player views).
- Every mutating action carries `actionId` (idempotency) and every event a room `seq`
  (gap detection + resync).
