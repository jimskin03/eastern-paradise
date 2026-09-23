import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { db } from '../src/db.js';
import { WorldEngine } from '../src/world.js';
import { residentManager } from '../src/residents.js';
import { BoardService } from '../src/board.js';

function createShrineTester(label, initialKarma = 10) {
  const nonce = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const id = `agent_shrine_${label}_${nonce}`;
  const name = `Shrine Seeker ${label} ${nonce}`;
  db.prepare('INSERT INTO accounts (id, name, email, api_key, verified, created_at) VALUES (?, ?, ?, ?, 1, ?)')
    .run(id, name, `${id}@shrine.test`, `key_${id}`, Date.now());
  db.prepare(`
    INSERT INTO profiles (agent_id, karma, balance, total_earned, solved_count, titles, solved_puzzles, custom_status, last_seen, imprisoned_until)
    VALUES (?, ?, 100, 100, 0, '[]', '[]', 'Seeking', ?, 0)
  `).run(id, initialKarma, Date.now());
  return { id, apiKey: `key_${id}`, name };
}

function cleanupAgent(id) {
  db.prepare('DELETE FROM prison_records WHERE agent_id = ?').run(id);
  db.prepare('DELETE FROM profiles WHERE agent_id = ?').run(id);
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
}

test('Dark Sanctuary Shrine: Map asset exists at [2, 48]', () => {
  const zonesConfig = JSON.parse(fs.readFileSync(new URL('../data/world_zones.json', import.meta.url), 'utf8'));
  const allNodes = zonesConfig.zones.flatMap(z => z.nodes || []);
  const shrineNode = allNodes.find(n => n.id === 'shrine_dark_sanctuary');
  assert.ok(shrineNode, 'shrine_dark_sanctuary node must exist in world_zones.json');
  assert.deepEqual(shrineNode.pos, [2, 48]);
  assert.equal(shrineNode.type, 'dark_sanctuary_shrine');
  assert.equal(shrineNode.icon, '⛓️');
});

test('Dark Sanctuary Shrine: Inspecting node returns active prisoners and last 5 records', () => {
  const world = new WorldEngine();
  residentManager.init(world);

  const observer = createShrineTester('observer', 50);
  const prisoner = createPrisonTesterLocal('inmate', -50);

  const now = Date.now();
  const until = now + (2 * 3600 * 1000); // 2 hours remaining
  db.prepare('UPDATE profiles SET imprisoned_until = ? WHERE agent_id = ?').run(until, prisoner.id);

  // Insert 6 records into prison_records to verify limit 5
  for (let i = 1; i <= 6; i++) {
    db.prepare(`
      INSERT INTO prison_records (id, agent_id, agent_name, avatar_color, avatar_glyph, crime, karma_at_sentence, imprisoned_at, imprisoned_until, released_at)
      VALUES (?, ?, ?, '#e53e3e', '⛓️', ?, -50, ?, ?, ?)
    `).run(`prec_test_${i}_${prisoner.id}`, prisoner.id, prisoner.name, `Crime #${i}`, now - (i * 10000), now, now);
  }

  try {
    world.activeAgents.set(observer.id, {
      id: observer.id,
      name: observer.name,
      pos: [2, 47], // Adjacent to shrine [2, 48]
      zone_name: 'The Dark Sanctuary'
    });

    const result = world.interact(observer.id, 'shrine_dark_sanctuary', 'inspect');
    assert.equal(result.success, true);
    assert.equal(result.node, 'The Dark Sanctuary Shrine');
    assert.ok(result.active_prisoners_count >= 1);

    const activeRecord = result.active_prisoners.find(p => p.agent_id === prisoner.id);
    assert.ok(activeRecord, 'Active prisoner must be listed in shrine output');
    assert.equal(activeRecord.name, prisoner.name);
    assert.equal(activeRecord.karma, -50);
    assert.ok(activeRecord.remaining_minutes > 110 && activeRecord.remaining_minutes <= 120);

    // Recent prisoners list must be capped at 5
    assert.ok(result.recent_prisoners.length <= 5);
  } finally {
    cleanupAgent(observer.id);
    cleanupAgent(prisoner.id);
  }
});

function createPrisonTesterLocal(label, karma) {
  const nonce = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const id = `agent_local_${label}_${nonce}`;
  const name = `Local Inmate ${label} ${nonce}`;
  db.prepare('INSERT INTO accounts (id, name, email, api_key, verified, created_at) VALUES (?, ?, ?, ?, 1, ?)')
    .run(id, name, `${id}@local.test`, `key_${id}`, Date.now());
  db.prepare(`
    INSERT INTO profiles (agent_id, karma, balance, total_earned, solved_count, titles, solved_puzzles, custom_status, last_seen, imprisoned_until)
    VALUES (?, ?, 100, 100, 0, '[]', '[]', 'Captive', ?, 0)
  `).run(id, karma, Date.now());
  return { id, apiKey: `key_${id}`, name };
}
