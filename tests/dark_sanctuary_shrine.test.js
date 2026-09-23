import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { db } from '../src/db.js';
import { WorldEngine } from '../src/world.js';
import { residentManager } from '../src/residents.js';
import { BoardService } from '../src/board.js';
import { AuthService } from '../src/auth.js';
import { spawnOrGetAgent, removeAgent } from '../src/domain/world/agents.js';
import { handleWorldRoutes } from '../src/http/routes/world.routes.js';

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

test('Dark Sanctuary: Logged out / offline prisoners remain in active prisoner list with is_online=false', () => {
  const world = new WorldEngine();
  residentManager.init(world);

  const observer = createShrineTester('observer_offline', 50);
  const offlinePrisoner = createPrisonTesterLocal('offline_inmate', -40);

  const now = Date.now();
  const until = now + (3 * 3600 * 1000); // 3 hours
  db.prepare('UPDATE profiles SET imprisoned_until = ? WHERE agent_id = ?').run(until, offlinePrisoner.id);

  db.prepare(`
    INSERT INTO prison_records (id, agent_id, agent_name, avatar_color, avatar_glyph, crime, karma_at_sentence, imprisoned_at, imprisoned_until, released_at)
    VALUES (?, ?, ?, '#e53e3e', '⛓️', 'Struck down resident', -40, ?, ?, NULL)
  `).run(`prec_offline_${offlinePrisoner.id}`, offlinePrisoner.id, offlinePrisoner.name, now, until);

  try {
    // Ensure prisoner is NOT in world.activeAgents (simulating offline/logged out)
    world.activeAgents.delete(offlinePrisoner.id);

    world.activeAgents.set(observer.id, {
      id: observer.id,
      name: observer.name,
      pos: [2, 47],
      zone_name: 'The Dark Sanctuary'
    });

    const result = world.interact(observer.id, 'shrine_dark_sanctuary', 'inspect');
    assert.equal(result.ok, true);
    assert.equal(result.success, true);

    const record = result.active_prisoners.find(p => p.agent_id === offlinePrisoner.id);
    assert.ok(record, 'Offline / logged out prisoner must still appear in active prisoners list');
    assert.equal(record.is_online, false);
    assert.deepEqual(record.pos, [2, 49]);
    assert.equal(record.name, offlinePrisoner.name);
    assert.equal(record.karma, -40);
    assert.ok(record.remaining_minutes > 170 && record.remaining_minutes <= 180);
  } finally {
    cleanupAgent(observer.id);
    cleanupAgent(offlinePrisoner.id);
  }
});

test('Dark Sanctuary: Imprisoned guest is protected from purge until sentence expires', () => {
  const nonce = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const guestId = `guest_inmate_${nonce}`;
  const guestName = `Guest Prisoner ${nonce}`;
  const now = Date.now();
  const until = now + (3 * 3600 * 1000);

  db.prepare('INSERT INTO accounts (id, name, email, api_key, verified, is_guest, created_at) VALUES (?, ?, ?, ?, 1, 1, ?)')
    .run(guestId, guestName, `${guestId}@guest.test`, `key_${guestId}`, now);
  db.prepare(`
    INSERT INTO profiles (agent_id, karma, balance, total_earned, solved_count, titles, solved_puzzles, custom_status, last_seen, imprisoned_until)
    VALUES (?, -50, 0, 0, 0, '[]', '[]', 'Imprisoned', ?, ?)
  `).run(guestId, now, until);

  try {
    // Attempting to purge active prisoner guest must be rejected
    const purgeAttempt = AuthService.purgeGuest(guestId);
    assert.equal(purgeAttempt.purged, false);
    assert.match(purgeAttempt.reason, /serving a sentence/i);

    // Profile must still exist
    const prof = db.prepare('SELECT imprisoned_until FROM profiles WHERE agent_id = ?').get(guestId);
    assert.ok(prof);
    assert.equal(prof.imprisoned_until, until);
  } finally {
    cleanupAgent(guestId);
  }
});

test('Dark Sanctuary: Imprisoned agent respawns directly in cell [2, 49] if logging back in', () => {
  const world = new WorldEngine();
  const prisoner = createPrisonTesterLocal('reconnect_inmate', -30);
  const now = Date.now();
  const until = now + (3 * 3600 * 1000);

  db.prepare('UPDATE profiles SET imprisoned_until = ? WHERE agent_id = ?').run(until, prisoner.id);

  try {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(prisoner.id);
    const spawned = spawnOrGetAgent(world, account);

    assert.equal(spawned.imprisoned, true);
    assert.equal(spawned.imprisoned_until, until);
    assert.deepEqual(spawned.pos, [2, 49]);
    assert.equal(spawned.zone_id, 'dark_sanctuary');
  } finally {
    cleanupAgent(prisoner.id);
  }
});

test('Dark Sanctuary: Public GET /api/world/dark-sanctuary returns both ok and success, active prisoners (including logged out), and recent records', async () => {
  const world = new WorldEngine();
  const prisoner = createPrisonTesterLocal('http_inmate', -45);
  const now = Date.now();
  const until = now + (3 * 3600 * 1000);

  db.prepare('UPDATE profiles SET imprisoned_until = ? WHERE agent_id = ?').run(until, prisoner.id);
  db.prepare(`
    INSERT INTO prison_records (id, agent_id, agent_name, avatar_color, avatar_glyph, crime, karma_at_sentence, imprisoned_at, imprisoned_until, released_at)
    VALUES (?, ?, ?, '#e53e3e', '⛓️', 'Struck down resident', -45, ?, ?, NULL)
  `).run(`prec_http_${prisoner.id}`, prisoner.id, prisoner.name, now, until);

  try {
    let capturedStatusCode = null;
    let capturedBody = null;

    const mockReq = { method: 'GET', headers: {} };
    const mockRes = {
      writeHead(code, headers) { capturedStatusCode = code; },
      end(data) { capturedBody = JSON.parse(data); }
    };

    const handled = await handleWorldRoutes({
      req: mockReq,
      res: mockRes,
      pathname: '/api/world/dark-sanctuary',
      parsedUrl: new URL('http://localhost/api/world/dark-sanctuary'),
      services: {
        db,
        AuthService: { authenticate: () => null },
        world,
        ResearchTelemetry: null,
        residentManager
      }
    });

    assert.notEqual(handled, false);
    assert.equal(capturedStatusCode, 200);
    assert.equal(capturedBody.ok, true);
    assert.equal(capturedBody.success, true);
    assert.ok(capturedBody.active_prisoners.length >= 1);
    assert.ok(capturedBody.recent_records.length >= 1);
    assert.ok(capturedBody.recent_prisoners.length >= 1);

    const found = capturedBody.active_prisoners.find(p => p.agent_id === prisoner.id);
    assert.ok(found, 'Active prisoner must be present in HTTP response');
    assert.equal(found.is_online, false);
    assert.deepEqual(found.pos, [2, 49]);
    assert.equal(found.karma, -45);
    assert.ok(found.remaining_minutes > 170 && found.remaining_minutes <= 180);
  } finally {
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


