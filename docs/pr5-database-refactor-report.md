# PR #5 Database Infrastructure Refactor Report

## Scope and result

PR #5 is a structural persistence-internals refactor only. It keeps `src/db.js` as the application compatibility boundary and moves its implementation into cohesive modules under `src/infrastructure/database/`. No application service, route, frontend module, schema contract, provider, or synchronization strategy was redesigned.

| Measurement | Before | After |
| --- | ---: | ---: |
| `src/db.js` physical lines | 842 | 17 |
| `src/db.js` working-tree bytes | 30,531 | 634 |

## Module breakdown

| Module | Lines | Bytes | Responsibility |
| --- | ---: | ---: | --- |
| `src/db.js` | 17 | 634 | Compatibility exports and assembly |
| `infrastructure/database/connection.js` | 22 | 721 | Repository-level data path, directory creation, `DatabaseSync` construction |
| `infrastructure/database/schema.js` | 215 | 6,597 | Canonical local SQLite tables and message indexes |
| `infrastructure/database/migrations.js` | 38 | 1,732 | Ordered, non-fatal safe migrations |
| `infrastructure/database/bootstrap.js` | 26 | 877 | Synchronous initialization orchestration and world-clock singleton seed |
| `infrastructure/database/sync-config.js` | 39 | 828 | Ordered `SYNC_TABLES` and exact `TABLE_PK` metadata |
| `infrastructure/database/delta-tracking.js` | 63 | 2,522 | `_sync_changes`, its index, and per-table triggers |
| `infrastructure/database/cloud/client.js` | 20 | 574 | Turso environment aliases and LibSQL client creation |
| `infrastructure/database/cloud/schema.js` | 192 | 6,098 | Existing Turso table declarations |
| `infrastructure/database/cloud/filters.js` | 12 | 630 | Existing guest-data retention decisions |
| `infrastructure/database/cloud/restore.js` | 48 | 1,946 | Cloud-to-local restore workflow |
| `infrastructure/database/cloud/push.js` | 91 | 2,723 | Local delta-to-cloud push workflow |
| `infrastructure/database/cloud/maintenance.js` | 43 | 1,774 | Non-A.Ilicia local/cloud log maintenance |
| `infrastructure/database/cloud/storage.js` | 23 | 548 | Object-style `CloudStorage` API assembly |

## Preserved compatibility exports

`src/db.js` continues to export exactly:

- `db`
- `DB_PATH`
- `TABLE_PK`
- `CloudStorage`

Existing imports do not need to change. `CloudStorage` remains an object with `isEnabled()`, `restoreFromCloud()`, `pushToCloud()`, and `wipeNonAiliciaLogs()`.

## Exact initialization order

Importing `src/db.js` remains synchronous and produces a ready-to-use local database before any importer can execute SQL:

1. Resolve `DATA_DIR`, preserving `path.resolve(process.env.DATA_DIR)` when configured.
2. Otherwise resolve the repository-level `data` directory intentionally from the deeper connection module.
3. Create the data directory and `data/paradise.db` path.
4. Construct the sole local `DatabaseSync` instance.
5. Apply `PRAGMA journal_mode = WAL` and `PRAGMA busy_timeout = 5000`.
6. Create the canonical local tables and indexes.
7. Run every safe migration in its original order, swallowing each individual failure.
8. Query `world_clock` for `id = 1` and insert the singleton only when absent.
9. Emit the existing local initialization log.
10. Configure the sole Turso client from the existing environment aliases.
11. Create `_sync_changes` and `idx_sync_changes_tbl_id`.
12. Install the existing per-table delta triggers.
13. Assemble and export the `CloudStorage` object.

No asynchronous step was added to local SQLite startup. Server boot continues to call cloud restore through the same façade after importing a fully initialized local `db`.

## Local table and index inventory

| Table | Primary key used by sync |
| --- | --- |
| `accounts` | `id` |
| `profiles` | `agent_id` |
| `board_messages` | `id` |
| `guest_top_scores` | `agent_id` |
| `transactions` | `id` |
| `active_puzzles` | `node_id` |
| `interaction_logs` | `id` |
| `spectator_messages` | `id` |
| `resident_traits` | `agent_id` |
| `agent_runtime` | `agent_id` |
| `relationships` | `agent_id`, `target_id` |
| `agent_memories` | `id` |
| `agent_promises` | `id` |
| `world_objects` | `id` |
| `world_events` | `id` |
| `world_clock` | `id` |
| `messages` | `message_id` |
| `_sync_changes` | local autoincrement `id`; not itself synchronized |

Preserved indexes:

- `idx_messages_conv_seq`
- `idx_messages_recipient`
- `idx_messages_sender`
- unique `idx_messages_idempotency`
- `idx_sync_changes_tbl_id`

## Migration inventory

The following migrations remain ordered and individually non-fatal:

1. `accounts.sponsor_balance`
2. `profiles.balance`
3. `profiles.total_earned`
4. `board_messages.is_pinned`
5. `active_puzzles.merit_reward`
6. `active_puzzles.alt_answers`
7. `active_puzzles.truth_axiom`
8. `accounts.is_guest`
9. `board_messages.is_guest`
10. `spectator_messages.delivery_status`
11. `spectator_messages.acknowledged_at`
12. `spectator_messages.response_text`
13. `accounts.achieved_top_one`
14. `board_messages.is_unverified`
15. `guest_top_scores` `CREATE TABLE IF NOT EXISTS` bootstrap

No migration version table or framework was introduced.

## Delta-sync inventory and semantics

`SYNC_TABLES` retains its original 17-table order shown in the table inventory above. Each synchronized table retains these exact trigger names:

- `trg_<table>_sync_ins`
- `trg_<table>_sync_upd`
- `trg_<table>_sync_del`

Inserts and updates still record `UPSERT`; deletes still record `DELETE`. Timestamps still use `CAST(strftime('%s', 'now') AS INTEGER) * 1000`. The `relationships` composite row key remains `agent_id + ':::' + target_id`.

## Cloud behavior

Client configuration still prefers `TURSO_DATABASE_URL`, falls back to `TURSO_URL`, and uses `TURSO_AUTH_TOKEN`. Without a URL, cloud storage remains disabled, restore is a safe no-op, and push returns `{ synced: 0 }`.

Restore still:

- ensures the existing cloud table declarations;
- disables local foreign keys during restore and re-enables them in `finally`;
- reads every sync table with `SELECT *`;
- uses local `INSERT OR REPLACE`;
- continues after individual table and row failures;
- retains all `guest_top_scores` and unverified permanent board messages while filtering ordinary guest data;
- deletes all `_sync_changes` after restore so trigger-generated baseline rows are not uploaded.

Push still:

- reads at most 500 dirty entries in ascending ID order;
- deduplicates on `(table_name, row_pk)` while keeping the latest operation;
- converts missing UPSERT rows into DELETE statements;
- applies the same guest rules;
- uses `INSERT OR REPLACE` and sequential chunks of 100;
- deletes processed dirty entries only after successful writes;
- reports `{ synced: statements.length }`.

Maintenance retains the exact `resident_ailicia` identifier, DELETE predicates, local/cloud result maps, and remaining-count report.

## Deliberately preserved schema drift

The extraction found existing differences between the effective local schema and the Turso bootstrap declarations. They are documented here and intentionally not corrected:

- `accounts.achieved_top_one` exists locally but is absent from the cloud bootstrap declaration.
- `active_puzzles.alt_answers` is added locally by safe migration but is absent from the cloud declaration.
- `active_puzzles.truth_axiom` exists locally but is absent from the cloud declaration.
- The local `profiles.agent_id` declaration includes a foreign key to `accounts(id)`; the cloud declaration does not.
- The four message indexes are local declarations and are not created by the cloud schema bootstrap.

Changing these declarations requires a separate, explicit schema migration rather than a structural refactor.

## Verification

Baseline before edits:

- complete suite: 69 passed, 0 failed, 0 skipped;
- headless Chromium test passed.

PR #5-specific regression coverage verifies:

- exact façade export names;
- default and overridden `DB_PATH` values and database-file creation;
- WAL and 5,000 ms busy timeout;
- complete table, index, and 51-trigger inventory;
- world-clock singleton preservation;
- old/minimal database migration and restart idempotency;
- public cloud-disabled behavior;
- integer and boolean guest filtering;
- restore filtering, foreign-key restoration, and delta-log purge;
- push deduplication, sequential 100-row chunks, composite key propagation, and failed-write retention;
- non-A.Ilicia maintenance behavior.

Final verification after the refactor:

- complete suite: 72 passed, 0 failed, 0 skipped;
- headless Chromium browser test passed within the complete suite;
- PR #5-specific database tests: 3 passed;
- existing delta-sync test: passed;
- every new database module, `src/db.js`, and the new test pass `node --check`.

The local environment's global `npm` launcher points at a missing user-level `npm-cli.js`, so the package's exact test script body was run directly as `node --test --test-concurrency=1 tests/*.test.js`.

## Technical debt deferred beyond PR #5

- Repository abstractions for domain modules that currently call `db.prepare(...)` directly.
- Formal versioned migrations.
- Explicit correction and migration of local/cloud schema drift.
- Broader cloud integration tests against a disposable Turso instance.
- Any change to provider, retention policy, batching, concurrency, ORM, or database technology.

No PR #6 work is included.
