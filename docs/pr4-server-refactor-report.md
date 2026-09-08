# PR #4 server modularization report

## Size change

| File | Physical lines | Bytes |
| --- | ---: | ---: |
| Original `src/server.js` working tree at `bd903d6` | 1,648 | 64,950 |
| Original Git blob at `bd903d6` (LF-normalized) | 1,648 | 63,302 |
| Refactored `src/server.js` | 122 | 4,089 |

`src/server.js` now performs dependency assembly, native HTTP server creation, WebSocket/lifecycle wiring, cloud restore/sync, process hooks, service initialization, and listen startup. It remains the executable entrypoint used by `node src/server.js`.

## Created backend modules

| Module | Lines | Bytes | Responsibility |
| --- | ---: | ---: | --- |
| `src/http/router.js` | 77 | 2,974 | Native deterministic route dispatch, activity/CORS/global-limit gates, top-level error handling, static fallback. |
| `src/http/helpers/body.js` | 21 | 497 | Existing JSON body parsing and 1 MB limit. |
| `src/http/helpers/request.js` | 13 | 473 | Client IP and forwarded host/protocol derivation. |
| `src/http/helpers/response.js` | 21 | 711 | Existing indented JSON and structured API error responses. |
| `src/http/helpers/static-files.js` | 30 | 939 | Existing public path aliases, MIME map, and raw file streaming. |
| `src/http/middleware/cors.js` | 11 | 331 | Existing `OPTIONS` response and CORS headers. |
| `src/http/middleware/rate-limit.js` | 107 | 3,506 | Global token buckets, guest/whisper sliding windows, reset APIs, cleanup timer. |
| `src/http/routes/protocol.routes.js` | 84 | 2,948 | OpenAPI, instructions, prompts, manifest, map, and public nodes. |
| `src/http/routes/auth.routes.js` | 230 | 9,480 | Register/resend/verify/login/guest/me/logout and their mail/cloud/world side effects. |
| `src/http/routes/agent.routes.js` | 59 | 3,008 | System-prompt aliases and persistent memories. |
| `src/http/routes/world.routes.js` | 129 | 5,059 | Authenticated world prefix gate, state, movement, teleport, pathfinding, interaction. |
| `src/http/routes/board.routes.js` | 78 | 3,322 | Board reads/posts, auto-guest behavior, solve gate, broadcast/cloud side effects. |
| `src/http/routes/spectator.routes.js` | 96 | 3,506 | Whisper aliases/log, limiter, validation, persistence, broadcast payload. |
| `src/http/routes/messages.routes.js` | 90 | 3,086 | Authenticated mailbox send/list/delivered/read and exact dynamic regexes. |
| `src/http/routes/residents.routes.js` | 43 | 1,721 | Resident collection/detail serialization with social state. |
| `src/http/routes/journal.routes.js` | 30 | 1,326 | Event page/cursor and recap queries. |
| `src/http/routes/projects.routes.js` | 32 | 1,569 | Project reads/contributions and update broadcasts. |
| `src/http/routes/profiles.routes.js` | 76 | 3,238 | Self/public profiles and ordered inhabitants query. |
| `src/http/routes/economy.routes.js` | 62 | 2,768 | Balance, transfer, spend, leaderboard and successful-action broadcasts. |
| `src/http/routes/status.routes.js` | 38 | 1,531 | Runtime status and protected/redacted mail dispatches. |
| `src/http/routes/admin.routes.js` | 67 | 2,740 | Constant-time admin guards, binary SQLite snapshot, cloud log wipe. |
| `src/realtime/world-websocket.js` | 80 | 2,192 | Sole `/ws/world` server, client set, initial snapshot, ping/pong, event fan-out, cleanup. |
| `src/runtime/lifecycle.js` | 66 | 1,791 | ACTIVE/IDLE state, activity wake, 3-second loop, spectator-aware idle, inactive-agent cleanup. |

## Route and compatibility inventory

The complete before/after route inventory is in `docs/pr4-server-route-inventory.md`. It records all 48 ordered route/static/fallback conditions, auth requirements, side effects, dependencies, special response types, global gates, limiter behavior, WebSocket behavior, and boot order.

Preserved aliases and dual-method endpoints:

- `/instructions` and `/api/instructions`
- `/api/agent/system_prompt` and `/api/system_prompt`
- `/api/world/nodes` and `/api/nodes`
- `/api/spectator/message` and `/api/spectator/whisper`
- GET/POST `/api/auth/guest`, `/api/world/move`, `/api/world/move_to`, `/api/world/interact`
- `challenge_id`/`challengeId` and `request_id`/`requestId` query aliases

Preserved `src/server.js` compatibility exports:

- `sendApiError`
- `checkGuestCreationLimit`
- `resetGuestCreationLimits`
- `checkWhisperLimit`
- `resetWhisperLimits`

## Verification

- Native `http.createServer()` remains the HTTP architecture; no framework or router dependency was added.
- Every new backend module and `src/server.js` passes `node --check`.
- Final full-suite rerun after the refactor: 69 tests passed, 0 failed, 0 skipped.
- One earlier full-suite run hit the pre-existing headless Chromium clickability timing failure (`Node is either not clickable or not an Element`); the unchanged test passed immediately in isolation and passed again in the final full-suite rerun. No assertion or timeout was loosened.
- Added direct coverage for lifecycle idle/wake/spectator behavior and 10-minute inactive-agent cleanup.
- Added live `/ws/world` coverage for `init_world`, exact path, ping/pong, world-event delivery, spectator count, and disconnect cleanup.
- Source audit confirms one `WebSocketServer`, one `world.onEvent` subscription, one simulation interval owner, one global limiter cleanup interval, one mailbox prune interval, one cloud sync interval, and one pair of conditional cloud shutdown hooks.
- Existing E2E tests repeatedly spawn and terminate `node src/server.js`, verifying startup and normal test shutdown compatibility.
- Boot sequence remains: optional cloud restore and periodic/signal setup; guest purge; mailbox pruning; project initialization; resident initialization; event-ledger initialization; simulation start; listen.

## Deliberately deferred to PR #5 or later

- Split or redesign `db.js` and persistence ownership.
- Refactor `world.js`, residents, puzzles, or game-domain systems.
- Change API schemas, auth design, endpoint naming, rate limits, database schema, static-file policy, frontend architecture, or cloud behavior.
- Introduce a framework, TypeScript, build system, or dependency-injection container.
