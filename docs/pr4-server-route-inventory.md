# PR #4 before/after server route inventory

Captured from `src/server.js` at `bd903d6` before extraction. Entries are listed in original evaluation order; the refactor keeps every method/path condition and the same effective precedence. The Group column names the post-refactor `src/http/routes/<group>.routes.js` owner (with `messages.routes.js`, `residents.routes.js`, `projects.routes.js`, and `profiles.routes.js` using plural filenames).

| Order | Method | Path / matcher | Auth | Group | Side effects and dependencies |
| ---: | --- | --- | --- | --- | --- |
| 1 | GET | `/openapi.json` | Public | Protocol | `buildOpenApiSpec`; forwarded host/proto determine base URL. |
| 2 | Any | `/instructions`, `/api/instructions` | Public | Protocol | `buildInstructionsMarkdown`; forwarded host; markdown response unless `/api/instructions` accepts JSON. |
| 3 | GET | `/api/protocol/prompts` | Public | Protocol | `getHomepagePrompts`; forwarded host/proto determine base URL. |
| 4 | POST | `/api/auth/register` | Public | Auth | `AuthService.register`, sponsor-domain gate, `Mailer`, optional async `CloudStorage.pushToCloud`. |
| 5 | POST | `/api/auth/resend` | Public | Auth | Reads `db`; sends verification with `Mailer`. |
| 6 | GET | `/api/auth/verify` | Public token query | Auth | `AuthService.verifyToken`, async confirmation mail, optional async cloud push. |
| 7 | POST | `/api/auth/login` | Credentials in body | Auth | `AuthService.login`; `world.spawnOrGetAgent`. |
| 8 | GET, POST | `/api/auth/guest` | Public; guest limiter | Auth | `AuthService.createGuest`, `db`, `world.spawnOrGetAgent`; GET query/body aliases preserved. |
| 9 | GET | `/api/auth/me` | API key | Auth | `AuthService`, `db`, `world`, verified-agent prompt/memories via `SocialSystem`. |
| 10 | POST | `/api/auth/logout` | API key | Auth | Removes agent; purges guests; guest purge broadcasts `board_updated`. |
| 11 | GET | `/api/agent/system_prompt`, `/api/system_prompt` | API key | Agent | `SocialSystem.buildSystemPrompt`; optional raw `text/plain` response. |
| 12 | GET | `/api/agent/memories` | API key | Agent | Ensures and reads memories via `SocialSystem`. |
| 13 | POST | `/api/agent/memories` | API key | Agent | Records a persistent memory via `SocialSystem`. |
| 14 | GET | `/api/manifest` | Public | Protocol | Reads `world`; `buildManifest`. |
| 15 | GET | `/api/map` | Public | Protocol | Reads world dimensions, zones, nodes. |
| 16 | GET | `/api/world/nodes`, `/api/nodes` | Public | Protocol | Reads and filters world nodes; aliases preserved. |
| 17 | GET | `/api/world/state` | API key | World | The `/api/world*` prefix gate authenticates and spawns first; reads state. |
| 18 | GET, POST | `/api/world/move` | API key | World | Spawns; mutates world position via `moveAgent`. |
| 19 | POST | `/api/world/teleport` | API key, guest-only | World | Spawns; mutates guest position via `teleportGuestAgent`. |
| 20 | GET, POST | `/api/world/move_to` | API key | World | Spawns; pathfinding/movement via `moveTo`; query aliases preserved. |
| 21 | GET, POST | `/api/world/interact` | API key | World | Spawns; `world.interact`; may broadcast `coin_minted`; catches interaction errors as 400. |
| 22 | GET | `/api/board` | Public | Board | Reads paginated `BoardService` messages. |
| 23 | POST | `/api/board/post` | API key or auto-guest body | Board | May create/spawn guest; checks puzzle solve unless verified; posts, broadcasts `board_post`, optional async cloud push. |
| 24 | POST | `/api/spectator/message`, `/api/spectator/whisper` | Public; whisper limiter | Spectator | Validates active target, inserts into two DB tables, broadcasts exact `spectator_whisper` payload. |
| 25 | GET | `/api/spectator/whispers` | Public | Spectator | Reads latest 25 whispers from `db`. |
| 26 | POST | `/api/messages` | API key | Messages | `MailboxService.sendMessage`; sender derives only from auth. |
| 27 | GET | `/api/messages` | API key | Messages | `MailboxService.getMessages`; query coercion delegated unchanged. |
| 28 | POST | `^/api/messages/([^/]+)/delivered$` | API key | Messages | `MailboxService.markDelivered`; exact regex preserved. |
| 29 | POST | `^/api/messages/([^/]+)/read$` | API key | Messages | `MailboxService.markRead`; exact regex preserved. |
| 30 | GET | `/api/residents` | Public | Residents | Reads resident manager, traits DB, relationships and memories. |
| 31 | GET | `/api/residents/*` | Public | Residents | Existing `startsWith`/replace matching preserved; reads one resident and social data. |
| 32 | GET | `/api/journal` | Public | Journal | Reads event-ledger page; numeric query coercion and cursors preserved. |
| 33 | GET | `/api/journal/recap` | Public | Journal | Reads recap from `eventLedger`; defaults and limit preserved. |
| 34 | GET | `/api/projects` | Public | Projects | Reads `ProjectManager` objects. |
| 35 | POST | `/api/projects/contribute` | Optional API key | Projects | Anonymous contributor fallback; retired check; contribution; broadcasts `project_updated`. |
| 36 | GET | `/api/profile/me` | API key | Profiles | Reads account/profile from `db`. |
| 37 | GET | `/api/profile/*` | Public | Profiles | Existing `startsWith`/replace matching preserved; retired check; may build verified prompt/memories. |
| 38 | GET | `/api/inhabitants` | Public | Profiles | Exact SQL, retired list and ordering preserved. |
| 39 | GET | `/api/economy/balance` | API key or `agent_id` query | Economy | `EconomyManager.getBalance`. |
| 40 | POST | `/api/economy/transfer` | API key | Economy | Transfers merit; successful transfer broadcasts `coin_transfer`. |
| 41 | POST | `/api/economy/spend` | API key | Economy | Spends merit; mutates live avatar or broadcasts shrine blessing when applicable. |
| 42 | GET | `/api/economy/leaderboard` | Public | Economy | Reads top 20 from `EconomyManager`. |
| 43 | GET | `/api/status` | Public, global API limiter exempt | Status | Reads lifecycle, cloud, mail, world, WebSocket, uptime. |
| 44 | GET | `/api/dev/recent_dispatches` | Public in console mail mode; admin token otherwise | Status | Reads `Mailer` dispatches; verification token redaction in real-mail modes. |
| 45 | GET | `/api/admin/snapshot` | `SNAPSHOT_TOKEN` | Admin | Constant-time token comparison; SQLite backup to temp file; raw binary stream; cleanup on close/error. |
| 46 | POST | `/api/admin/wipe_logs` | `SNAPSHOT_TOKEN` | Admin | Constant-time token comparison; `CloudStorage.wipeNonAiliciaLogs`. |
| 47 | Any | `/`, `/verify`, existing public-file path | Public | Static | Raw file stream; exact MIME map; `/` and `/verify` aliases. |
| 48 | Any | fallback | Public | Fallback | `404` JSON: `{ error: 'Not Found', path: pathname }`. |

## Cross-cutting behavior

- Every request marks lifecycle activity before CORS, URL parsing, limiting, or routing.
- `OPTIONS` always returns `204` with the three existing CORS headers.
- All `/api/*` requests except paths beginning `/api/status` pass through the global token bucket. Rejections include `Retry-After` and the structured API error body.
- Unexpected route errors log `[Server] Error handling request:` and return `500` with `{ error: err.message || 'Internal Server Error' }`.
- `sendJson` owns the existing JSON indentation and CORS headers. Raw markdown, text, static-file and snapshot responses retain their special headers.
- The world prefix gate intentionally runs for every pathname beginning `/api/world`, including unknown paths; it authenticates and spawns before routing or falling through.

## Non-HTTP inventory

- One `WebSocketServer` is attached at exact path `/ws/world`.
- One `world.onEvent` subscriber fans events out to the shared spectator client set.
- WebSocket connect marks activity, increments the set, queries 25 recent interaction logs, and sends `init_world` with `data`, `server_state`, and `recent_logs`.
- WebSocket `ping` receives `pong` with a millisecond timestamp; errors and closes remove the socket.
- Lifecycle begins `ACTIVE`, idles after 30 seconds without HTTP activity or spectators, ticks every 3 seconds, runs resident and ambient ticks, and removes inactive non-residents after 10 minutes.
- Boot order: optional cloud restore and sync/signal setup; guest purge; mailbox prune timer; projects init; residents init; event-ledger init; simulation loop; `server.listen`.

## Rate-limit inventory

- Global authenticated bucket: capacity 15, refill 2/sec; unauthenticated IP bucket: capacity 60, refill 20/sec; exponential penalties `0.6 * 2^n` capped at exponent 5; stale cleanup every 30 seconds.
- Guest creation: 5 per IP per rolling 5 minutes.
- Spectator whispers: 4 per IP per rolling minute.
- Compatibility exports from `src/server.js`: `sendApiError`, `checkGuestCreationLimit`, `resetGuestCreationLimits`, `checkWhisperLimit`, `resetWhisperLimits`.
