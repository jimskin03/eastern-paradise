import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { initializeDatabase } from '../src/infrastructure/database/bootstrap.js';
import { pushToCloud } from '../src/infrastructure/database/cloud/push.js';
import { restoreFromCloud } from '../src/infrastructure/database/cloud/restore.js';
import { shouldRetainCloudRow } from '../src/infrastructure/database/cloud/filters.js';
import { wipeNonAiliciaLogs } from '../src/infrastructure/database/cloud/maintenance.js';
import { SYNC_TABLES, TABLE_PK } from '../src/infrastructure/database/sync-config.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const EXPECTED_TABLES = [
  '_sync_changes',
  'accounts',
  'profiles',
  'board_messages',
  'guest_top_scores',
  'transactions',
  'active_puzzles',
  'interaction_logs',
  'agent_badges',
  'agent_world_quests',
  'spectator_messages',
  'resident_traits',
  'agent_runtime',
  'relationships',
  'agent_memories',
  'agent_promises',
  'world_objects',
  'world_events',
  'world_clock',
  'messages',
  'first_flame_quests',
  'first_flame_hearths',
  'wallet_links',
  'wallet_challenges',
  'land_grids',
  'land_purchases'
];

const EXPECTED_INDEXES = [
  'idx_messages_conv_seq',
  'idx_messages_recipient',
  'idx_messages_sender',
  'idx_messages_idempotency',
  'idx_agent_world_quests_status',
  'idx_wallet_challenges_expiry',
  'idx_land_grids_owner_wallet',
  'idx_land_grids_status',
  'idx_land_purchases_recovery',
  'idx_sync_changes_tbl_id'
];

function createTempDatabase() {
  const directory = mkdtempSync(path.join(tmpdir(), 'ep-db-modules-'));
  const databasePath = path.join(directory, 'paradise.db');
  const database = new DatabaseSync(databasePath);
  initializeDatabase({ db: database, dbPath: databasePath, configureCloud: () => null });
  return { database, databasePath, directory };
}

function closeAndRemove({ database, directory }) {
  database.close();
  rmSync(directory, { recursive: true, force: true });
}

test('database facade preserves exports, paths, local bootstrap, and cloud-disabled behavior', () => {
  const overrideDirectory = mkdtempSync(path.join(tmpdir(), 'ep-data-dir-'));
  const defaultPathEnv = { ...process.env };
  delete defaultPathEnv.DATA_DIR;
  const defaultPathRun = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', "const { DB_PATH } = await import('./src/infrastructure/database/connection.js'); console.log(DB_PATH);"],
    { cwd: repositoryRoot, env: defaultPathEnv, encoding: 'utf8' }
  );
  assert.equal(defaultPathRun.status, 0, defaultPathRun.stderr);
  assert.equal(defaultPathRun.stdout.trim(), path.join(repositoryRoot, 'data', 'paradise.db'));

  const script = `
    const module = await import('./src/db.js');
    const tables = module.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
    const indexes = module.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
    const triggers = module.db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all().map(row => row.name);
    const result = {
      exports: Object.keys(module).sort(),
      dbPath: module.DB_PATH,
      fileExists: (await import('node:fs')).existsSync(module.DB_PATH),
      journalMode: module.db.prepare('PRAGMA journal_mode').get().journal_mode,
      busyTimeout: module.db.prepare('PRAGMA busy_timeout').get().timeout,
      tables,
      indexes,
      triggers,
      clock: module.db.prepare('SELECT * FROM world_clock WHERE id = 1').get(),
      enabled: module.CloudStorage.isEnabled(),
      pushed: await module.CloudStorage.pushToCloud(),
      restored: await module.CloudStorage.restoreFromCloud(),
      tablePk: module.TABLE_PK
    };
    console.log('RESULT:' + JSON.stringify(result));
    module.db.close();
  `;
  const env = { ...process.env, DATA_DIR: overrideDirectory };
  delete env.TURSO_DATABASE_URL;
  delete env.TURSO_URL;
  delete env.TURSO_AUTH_TOKEN;

  try {
    const run = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: repositoryRoot,
      env,
      encoding: 'utf8'
    });
    assert.equal(run.status, 0, run.stderr);
    const resultLine = run.stdout.split(/\r?\n/).find(line => line.startsWith('RESULT:'));
    assert.ok(resultLine, run.stdout);
    const result = JSON.parse(resultLine.slice('RESULT:'.length));

    assert.deepEqual(result.exports, ['CloudStorage', 'DB_PATH', 'TABLE_PK', 'db']);
    assert.equal(result.dbPath, path.join(overrideDirectory, 'paradise.db'));
    assert.equal(result.fileExists, true);
    assert.equal(result.journalMode, 'wal');
    assert.equal(result.busyTimeout, 5000);
    assert.deepEqual(result.tables, [...EXPECTED_TABLES].sort());
    assert.deepEqual(result.indexes, [...EXPECTED_INDEXES].sort());
    assert.equal(result.clock.id, 1);
    assert.equal(result.enabled, false);
    assert.deepEqual(result.pushed, { synced: 0 });
    assert.equal(result.restored, undefined);
    assert.deepEqual(result.tablePk, TABLE_PK);

    const expectedTriggers = SYNC_TABLES.flatMap(table => [
      `trg_${table}_sync_del`,
      `trg_${table}_sync_ins`,
      `trg_${table}_sync_upd`
    ]).sort();
    assert.deepEqual(result.triggers, expectedTriggers);
  } finally {
    rmSync(overrideDirectory, { recursive: true, force: true });
  }
});

test('safe migrations and world-clock bootstrap remain idempotent without losing data', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ep-old-db-'));
  const databasePath = path.join(directory, 'paradise.db');
  let database = new DatabaseSync(databasePath);

  try {
    database.exec(`
      CREATE TABLE accounts (id TEXT PRIMARY KEY);
      CREATE TABLE profiles (agent_id TEXT PRIMARY KEY);
      CREATE TABLE board_messages (id TEXT PRIMARY KEY);
      CREATE TABLE active_puzzles (node_id TEXT PRIMARY KEY);
      CREATE TABLE spectator_messages (id TEXT PRIMARY KEY);
      INSERT INTO accounts (id) VALUES ('legacy-account');
    `);

    initializeDatabase({ db: database, dbPath: databasePath, configureCloud: () => null });
    database.prepare('UPDATE world_clock SET tick_count = 77 WHERE id = 1').run();
    initializeDatabase({ db: database, dbPath: databasePath, configureCloud: () => null });

    database.close();
    database = new DatabaseSync(databasePath);
    initializeDatabase({ db: database, dbPath: databasePath, configureCloud: () => null });

    assert.equal(database.prepare("SELECT id FROM accounts WHERE id = 'legacy-account'").get().id, 'legacy-account');
    assert.equal(database.prepare('SELECT tick_count FROM world_clock WHERE id = 1').get().tick_count, 77);

    const expectedColumns = {
      accounts: ['sponsor_balance', 'is_guest', 'achieved_top_one'],
      profiles: ['balance', 'total_earned'],
      board_messages: ['is_pinned', 'is_guest', 'is_unverified'],
      active_puzzles: ['merit_reward', 'alt_answers', 'truth_axiom'],
      spectator_messages: ['delivery_status', 'acknowledged_at', 'response_text']
    };
    for (const [table, columns] of Object.entries(expectedColumns)) {
      const actual = database.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
      for (const column of columns) assert.ok(actual.includes(column), `${table}.${column}`);
    }
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('cloud restore, push, filtering, and maintenance retain existing semantics', async () => {
  assert.equal(shouldRetainCloudRow('guest_top_scores', { is_guest: true }), true);
  assert.equal(shouldRetainCloudRow('board_messages', { is_guest: 1, is_unverified: 1 }), true);
  assert.equal(shouldRetainCloudRow('board_messages', { is_guest: true, is_unverified: true }), true);
  assert.equal(shouldRetainCloudRow('accounts', { is_guest: 1 }), false);
  assert.equal(shouldRetainCloudRow('accounts', { agent_id: 'guest_123' }), false);
  assert.equal(shouldRetainCloudRow('messages', { sender_id: 'guest_123' }), false);
  assert.equal(shouldRetainCloudRow('messages', { recipient_id: 'guest_123' }), false);
  assert.equal(shouldRetainCloudRow('spectator_messages', { target_agent_id: 'guest_123' }), false);

  const state = createTempDatabase();
  const { database } = state;
  try {
    database.exec('DELETE FROM _sync_changes');
    const now = Date.now();
    const cloudRows = {
      accounts: [{
        id: 'cloud-resident', name: 'Cloud Resident', email: 'cloud@example.com',
        avatar_color: '#48bb78', avatar_glyph: '☯', sponsor_balance: 0,
        verified: 1, is_guest: 0, achieved_top_one: 0, verification_token: null,
        token_expires_at: null, api_key: 'cloud-key', created_at: now
      }, {
        id: 'guest_cloud', name: 'Guest Cloud', email: 'guest@example.com',
        avatar_color: '#48bb78', avatar_glyph: '☯', sponsor_balance: 0,
        verified: 0, is_guest: true, achieved_top_one: 0, verification_token: null,
        token_expires_at: null, api_key: null, created_at: now
      }],
      board_messages: [{
        id: 'unverified-permanent', agent_id: 'guest_cloud', agent_name: 'Guest Cloud',
        avatar_glyph: '☯', category: 'General', is_pinned: 0, is_guest: 1,
        is_unverified: 1, content: 'Retain me', created_at: now
      }],
      guest_top_scores: [{
        agent_id: 'guest_champion', name: 'Champion', avatar_color: '#48bb78',
        avatar_glyph: '☯', balance: 1, total_earned: 2, karma: 3,
        solved_count: 4, is_unverified: 1, achieved_at: now
      }]
    };
    const restoreClient = {
      async execute(sql) {
        const match = /^SELECT \* FROM (\w+)$/.exec(sql);
        return { rows: match ? (cloudRows[match[1]] || []) : [] };
      }
    };

    await restoreFromCloud({ db: database, cloudClient: restoreClient });
    assert.ok(database.prepare("SELECT id FROM accounts WHERE id = 'cloud-resident'").get());
    assert.equal(database.prepare("SELECT id FROM accounts WHERE id = 'guest_cloud'").get(), undefined);
    assert.ok(database.prepare("SELECT id FROM board_messages WHERE id = 'unverified-permanent'").get());
    assert.ok(database.prepare("SELECT agent_id FROM guest_top_scores WHERE agent_id = 'guest_champion'").get());
    assert.equal(database.prepare('SELECT count(*) AS count FROM _sync_changes').get().count, 0);
    assert.equal(database.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);

    for (let index = 0; index < 101; index++) {
      database.prepare(`
        INSERT INTO accounts (id, name, email, verified, is_guest, created_at)
        VALUES (?, ?, ?, 1, 0, ?)
      `).run(`push-${index}`, `Push ${index}`, `push-${index}@example.com`, now + index);
    }
    database.prepare("UPDATE accounts SET name = 'Push Zero Updated' WHERE id = 'push-0'").run();
    database.prepare(`
      INSERT INTO accounts (id, name, email, verified, is_guest, created_at)
      VALUES ('guest_skip', 'Guest Skip', 'guest-skip@example.com', 0, 1, ?)
    `).run(now);

    const chunks = [];
    const pushClient = {
      async batch(statements, mode) {
        chunks.push({ statements, mode });
      }
    };
    const pushed = await pushToCloud({ db: database, cloudClient: pushClient });
    assert.deepEqual(chunks.map(chunk => chunk.statements.length), [100, 1]);
    assert.ok(chunks.every(chunk => chunk.mode === 'write'));
    assert.equal(pushed.synced, 101);
    assert.equal(database.prepare('SELECT count(*) AS count FROM _sync_changes').get().count, 0);

    database.prepare(`
      INSERT INTO relationships (agent_id, target_id, familiarity, trust, last_interaction_at)
      VALUES ('push-agent', 'resident_ailicia', 10, 10, ?)
    `).run(now);
    const relationshipBatches = [];
    const relationshipClient = {
      async batch(statements) {
        relationshipBatches.push(...statements);
      }
    };
    assert.deepEqual(await pushToCloud({ db: database, cloudClient: relationshipClient }), { synced: 1 });
    assert.match(relationshipBatches[0].sql, /^INSERT OR REPLACE INTO relationships/);
    assert.deepEqual(relationshipBatches[0].args.slice(0, 2), ['push-agent', 'resident_ailicia']);

    database.prepare("DELETE FROM relationships WHERE agent_id = 'push-agent' AND target_id = 'resident_ailicia'").run();
    relationshipBatches.length = 0;
    assert.deepEqual(await pushToCloud({ db: database, cloudClient: relationshipClient }), { synced: 1 });
    assert.equal(relationshipBatches[0].sql, 'DELETE FROM relationships WHERE agent_id = ? AND target_id = ?');
    assert.deepEqual(relationshipBatches[0].args, ['push-agent', 'resident_ailicia']);

    database.prepare(`
      INSERT INTO accounts (id, name, email, verified, is_guest, created_at)
      VALUES ('push-failure', 'Push Failure', 'push-failure@example.com', 1, 0, ?)
    `).run(now);
    const dirtyBeforeFailure = database.prepare('SELECT count(*) AS count FROM _sync_changes').get().count;
    await assert.rejects(
      pushToCloud({ db: database, cloudClient: { batch: async () => { throw new Error('write failed'); } } }),
      /write failed/
    );
    assert.equal(database.prepare('SELECT count(*) AS count FROM _sync_changes').get().count, dirtyBeforeFailure);

    database.prepare(`
      INSERT OR REPLACE INTO interaction_logs (id, agent_id, node_id, action_type, result, created_at)
      VALUES ('keep-log', 'resident_ailicia', 'node', 'inspect', 'kept', ?),
             ('wipe-log', 'resident_other', 'node', 'inspect', 'wiped', ?)
    `).run(now, now);
    const maintenance = await wipeNonAiliciaLogs({ db: database, cloudClient: null });
    assert.ok(database.prepare("SELECT id FROM interaction_logs WHERE id = 'keep-log'").get());
    assert.equal(database.prepare("SELECT id FROM interaction_logs WHERE id = 'wipe-log'").get(), undefined);
    assert.equal(maintenance.remaining.interaction_logs, 1);
  } finally {
    closeAndRemove(state);
  }
});
