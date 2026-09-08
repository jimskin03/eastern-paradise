# PR #6 Backend World Refactor Report

## Scope and result

PR #6 is a structural refactor of the backend `WorldEngine` only. `src/world.js` remains the stable class-and-singleton façade while implementation details now live in cohesive modules under `src/domain/world/`. Gameplay, configuration data, persistence, HTTP, WebSocket, browser, and frontend contracts were not redesigned.

| Measurement | Before | After |
| --- | ---: | ---: |
| `src/world.js` physical lines | 851 | 98 |
| `src/world.js` working-tree bytes | 28,942 | 2,455 |

## Module breakdown

| Module | Lines | Bytes | Responsibility |
| --- | ---: | ---: | --- |
| `src/world.js` | 98 | 2,455 | Stable `WorldEngine` façade, public state assembly, and singleton export |
| `src/domain/world/config.js` | 8 | 341 | Synchronous repository-level `data/world_zones.json` loading |
| `src/domain/world/geometry.js` | 70 | 2,158 | Spatial Sets, zone lookup, node projection, and walkability |
| `src/domain/world/events.js` | 14 | 338 | Set-based subscription, unsubscription, and isolated broadcasts |
| `src/domain/world/agents.js` | 82 | 2,921 | Spawn, removal, guest purge, retired-resident guard, and ambient wandering |
| `src/domain/world/movement.js` | 256 | 7,033 | Directional movement, path navigation, and guest teleport |
| `src/domain/world/projection.js` | 137 | 4,309 | Agent state and spectator read models |
| `src/domain/world/interactions.js` | 271 | 9,942 | Node lookup, range enforcement, and node-type dispatch |

The largest modules remain bounded by cohesive responsibilities; no generic world-utils dumping ground was introduced.

## Public `WorldEngine` API

The API is identical before and after the refactor:

1. `constructor(config)`
2. `onEvent(listener)`
3. `broadcast(event)`
4. `getZoneForPos(x, y)`
5. `getZone(identifier)`
6. `getAllNodes()`
7. `isWalkable(x, y)`
8. `spawnOrGetAgent(account)`
9. `removeAgent(agentId, purgeIfGuest = true)`
10. `tickAmbientWandering()`
11. `getState(agentId)`
12. `moveAgent(agentId, direction)`
13. `moveTo(agentId, target, options = {})`
14. `teleportGuestAgent(agentId, x, y)`
15. `interact(agentId, nodeId, action = 'inspect', payload = {})`
16. `getAllEntitiesForSpectator()`

`src/world.js` continues to export exactly `WorldEngine` and the sole source singleton, `world = new WorldEngine()`.

## Public instance properties

Every original property remains directly accessible:

- `config`
- `width`
- `height`
- `zones`
- `obstacles`
- `landscape`
- `waterTiles`
- `bridgeTiles`
- `blockedTiles`
- `activeAgents`
- `listeners`

Each constructed engine owns independent Maps and Sets. Test-created engines do not share `activeAgents`, `listeners`, or spatial Sets with the singleton or one another. Custom constructor configuration remains supported and the default JSON is loaded once per module evaluation rather than once per instance.

## Dependency graph

```text
src/world.js
├── domain/world/config.js
├── domain/world/geometry.js
├── domain/world/events.js
├── domain/world/agents.js
│   ├── auth.js
│   └── resident-policy.js
├── domain/world/movement.js
│   └── navigation.js
├── domain/world/projection.js
│   ├── puzzles.js
│   └── projects.js
└── domain/world/interactions.js
    ├── db.js
    ├── board.js
    ├── puzzles.js
    └── projects.js
```

No domain module imports `src/world.js`. A static DFS audit covers `world.js`, all world-domain modules, `puzzles.js`, `projects.js`, `board.js`, `auth.js`, `navigation.js`, `residents.js`, `server.js`, and `realtime/world-websocket.js`; no cycle is present. No dynamic-import workaround was used.

## Geometry compatibility

The extraction preserves:

- configured width, height, zones, obstacles, and landscape;
- normalized zone matching by trimming, lowercasing, and removing spaces, underscores, and hyphens;
- original all-node field projection and ordering;
- non-integer and out-of-bounds rejection;
- tree, rock, `blocked_tiles`, blocking-prop, and obstacle-rectangle collisions;
- water blocking except where a configured crossing makes the tile a bridge.

The deeper config module intentionally resolves `../../../data/world_zones.json`, preserving the repository-level data path.

## Event inventory

The Set-based listener contract is unchanged: subscribe adds the listener, unsubscribe returns the result of `Set.delete`, and listener errors are logged individually without stopping healthy listeners.

World-domain events preserved by this extraction:

- `agent_spawned`
- `agent_left`
- `board_updated`
- `agent_moved` for ordinary steps
- `agent_moved` with `path` for `moveTo`
- `agent_moved` with `ambient: true` for dummy wandering
- `agent_moved` with `previous_pos` and `teleported: true` for guest teleport
- `project_updated`
- `sound_event`
- `agent_customized`
- `truth_unveiled`
- `puzzle_solved`

Every existing payload field is preserved.

## Agent lifecycle compatibility

Spawn continues to reject retired resident IDs, reuse and refresh an existing state object, copy the arrival spawn point, normalize guest flags to `1` or `0`, apply the same avatar/status defaults, and broadcast the same object. Removal preserves `purgeIfGuest`, `AuthService.purgeGuest()`, `agent_left`, and `board_updated` behavior.

Ambient wandering retains the 4-second idle threshold, 45% probability, four cardinal directions, exclusion of residents and real visitors/guests, walkability check, status text, and ambient movement payload.

## Movement result compatibility

| Operation | Preserved outcomes |
| --- | --- |
| `moveAgent` | `invalid_direction`, `path_obstructed`, success with `from`, `to`, `pos`, zone fields, and `zone_changed` |
| Direction aliases | `north`/`up`, `south`/`down`, `east`/`right`, `west`/`left` |
| `moveTo` targets | Node ID string, `[x, y]`, `{ x, y }`, and numeric-index object |
| `moveTo` outcomes | `node_not_found`, `invalid_coordinates`, `already_at_destination`, `no_path_found`, and success |
| Path behavior | Existing `NavigationSystem.findPath`, `allowAdjacent: true`, default/explicit `max_steps`, `steps_taken`, `remaining_steps`, and `path` |
| Guest teleport errors | `guest_only`, `invalid_coordinate`, `blocked_destination` |
| Guest teleport success | Exact walkability, status text, `zone_changed`, `previous_pos`, and `teleported: true` event |

Inactive-agent exceptions and all result messages remain unchanged.

## Interaction inventory

The current world configuration contains these interactive node types, all preserved:

- `lore`
- `shrine`
- `melody`
- `message_board`
- `mirror`
- `customizer`
- `puzzle_node`
- `scenic`
- `landmark` through the existing default response
- `rest` through the existing default response

Node lookup, inactive-agent and missing-node exceptions, inspect range exemption, 3-tile action range, `TOO_FAR_FROM_NODE`, distance rounding, and suggested action text remain unchanged.

The dispatcher retains exact lore and shrine text, Wishing-Tree behavior, `BoardService.getMessages(5)`, mirror SQL/JSON handling, in-memory plus database avatar updates, and `agent_customized` events. Melody interactions retain `CHIME_OBJECT_ID`, contribution defaults, all `ProjectManager` calls, project events, sound events, and chime state/progress fields.

## Puzzle compatibility

`puzzles.js` was not modified. The world dispatcher continues to preserve:

- `trial_obelisk_truth` and the existing Truth category checks;
- `PuzzleManager.checkTruthUnlock()` and locked requirement/progress fields;
- answer aliases `answer`, `solution`, and `text`;
- challenge aliases `challenge_id` and `challengeId`;
- request aliases `request_id` and `requestId`;
- unchanged `solvePuzzle()` option shape and idempotent behavior;
- a single `puzzle_solved` or `truth_unveiled` broadcast only for a non-idempotent success;
- `issueChallenge()`, challenge ID, TTL calculation, puzzle metadata, reward/title fields, and action hints;
- Truth metadata and the `veiled` puzzle ID in `getState()` while locked.

Focused tests exercise wrong answers, successful solve, idempotent retry, Truth locking, metadata projection, and event count. The pre-existing puzzle and Truth suites also pass.

## State and spectator projection

`getState()` retains its `agent`, `current_zone`, and `surroundings` structure, 12-tile visible-agent radius, 8-tile node radius, 2.5-tile `can_interact` radius, one-decimal distance rounding, last-active refresh, available cardinal directions, visible-agent fields, and puzzle augmentation.

`getAllEntitiesForSpectator()` retains `agents`, `zones`, `obstacles`, `landscape`, `world_objects`, and `dimensions`. Resident role, aspiration, public intent, needs, and all original agent fields are unchanged. `ProjectManager.getAllObjects()` remains the source of world objects.

Neither HTTP routes nor `realtime/world-websocket.js` required modification.

## Verification

Baseline from merged `main` before edits:

- 74 tests passed;
- 0 tests failed;
- 0 tests skipped;
- Headless Chromium passed.

Final verification:

- 80 tests passed;
- 0 tests failed;
- 0 tests skipped;
- all 6 new focused world-domain tests passed;
- Headless Chromium passed;
- existing HTTP, WebSocket, browser-agent, puzzle, resident, geometry, and protocol tests passed;
- every changed/new JavaScript module passed `node --check`;
- staged diff whitespace check passed;
- static import-cycle audit passed;
- source audit found exactly one `new WorldEngine()` in `src/`.

The local machine's global `npm` launcher still points at a missing user-level `npm-cli.js`. The package's exact test script body was therefore executed directly as `node --test --test-concurrency=1 tests/*.test.js`. The merged CI workflow runs `npm ci`, syntax checks, and `npm test` under Node 22 on GitHub Actions.

## Deferred technical debt

- Further decomposition of interaction handlers only if future behavior work makes it valuable.
- Repository abstractions for mirror/customizer persistence.
- Refactoring `puzzles.js`, `residents.js`, `projects.js`, or `navigation.js` in separately scoped work.
- Changes to gameplay probabilities, physics, radii, rewards, puzzle rules, or projection schemas.
- New NPC features, combat, crypto, frameworks, TypeScript, or frontend changes.

No subsequent refactor PR work is included.
