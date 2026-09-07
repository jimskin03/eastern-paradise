import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, CloudStorage, TABLE_PK } from '../src/db.js';

test('Delta-Based Cloud Sync: Change Tracking, Triggers, and Deletions', async () => {
  // 1. Verify change tracking table and schema
  const tableCheck = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='_sync_changes'`).get();
  assert.ok(tableCheck, '_sync_changes table must exist');

  // Clear any existing test changes
  db.exec('DELETE FROM _sync_changes');

  const testAgentId = 'agent_test_sync_' + Date.now();
  const testEmail = `sync_${Date.now()}@example.com`;

  // 2. Insert triggers logging
  db.prepare(`
    INSERT INTO accounts (id, name, email, avatar_color, avatar_glyph, sponsor_balance, verified, is_guest, created_at)
    VALUES (?, ?, ?, '#48bb78', '☯', 0, 1, 0, ?)
  `).run(testAgentId, 'SyncTestAgent', testEmail, Date.now());

  let pending = db.prepare('SELECT * FROM _sync_changes WHERE table_name = ? AND row_pk = ?').all('accounts', testAgentId);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].op, 'UPSERT');

  // 3. Update triggers logging
  db.prepare(`UPDATE accounts SET sponsor_balance = 50 WHERE id = ?`).run(testAgentId);
  pending = db.prepare('SELECT * FROM _sync_changes WHERE table_name = ? AND row_pk = ?').all('accounts', testAgentId);
  assert.equal(pending.length, 2);
  assert.equal(pending[1].op, 'UPSERT');

  // 4. Delete triggers logging
  db.prepare(`DELETE FROM accounts WHERE id = ?`).run(testAgentId);
  pending = db.prepare('SELECT * FROM _sync_changes WHERE table_name = ? AND row_pk = ?').all('accounts', testAgentId);
  assert.equal(pending.length, 3);
  assert.equal(pending[2].op, 'DELETE');

  // 5. Composite PK table triggers (relationships)
  const relTarget = 'resident_ailicia';
  db.prepare(`
    INSERT OR REPLACE INTO relationships (agent_id, target_id, familiarity, trust, last_interaction_at)
    VALUES (?, ?, 15.0, 12.0, ?)
  `).run(testAgentId, relTarget, Date.now());

  const relKey = `${testAgentId}:::${relTarget}`;
  const relPending = db.prepare('SELECT * FROM _sync_changes WHERE table_name = ? AND row_pk = ?').all('relationships', relKey);
  assert.ok(relPending.length >= 1);
  assert.equal(relPending[relPending.length - 1].op, 'UPSERT');

  db.prepare(`DELETE FROM relationships WHERE agent_id = ? AND target_id = ?`).run(testAgentId, relTarget);
  const relDelPending = db.prepare('SELECT * FROM _sync_changes WHERE table_name = ? AND row_pk = ?').all('relationships', relKey);
  assert.equal(relDelPending[relDelPending.length - 1].op, 'DELETE');

  // 6. Clean up test records from _sync_changes
  db.exec('DELETE FROM _sync_changes');

  // 7. Test pushToCloud when empty returns 0 synced without network requests
  const emptyRes = await CloudStorage.pushToCloud();
  assert.equal(emptyRes.synced, 0);
});
