import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { db } from '../src/db.js';
import { WorldEngine } from '../src/world.js';
import { residentManager } from '../src/residents.js';
import { handleWorldRoutes } from '../src/http/routes/world.routes.js';

function createShrineTester(label) {
  const nonce = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const id = `agent_trans_${label}_${nonce}`;
  const name = `Transmigration Pilgrim ${label} ${nonce}`;
  db.prepare('INSERT INTO accounts (id, name, email, api_key, verified, created_at) VALUES (?, ?, ?, ?, 1, ?)')
    .run(id, name, `${id}@transmigration.test`, `key_${id}`, Date.now());
  db.prepare(`
    INSERT INTO profiles (agent_id, karma, balance, total_earned, solved_count, titles, solved_puzzles, custom_status, last_seen, imprisoned_until)
    VALUES (?, 100, 100, 100, 0, '[]', '[]', 'Seeking', ?, 0)
  `).run(id, Date.now());
  return { id, apiKey: `key_${id}`, name };
}

function cleanupAgent(id) {
  db.prepare('DELETE FROM profiles WHERE agent_id = ?').run(id);
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
}

test('Transmigration Shrine: Map asset exists at [28, 16] in Lotus Reflection Pond', () => {
  const zonesConfig = JSON.parse(fs.readFileSync(new URL('../data/world_zones.json', import.meta.url), 'utf8'));
  const allNodes = zonesConfig.zones.flatMap(z => z.nodes || []);
  const shrineNode = allNodes.find(n => n.id === 'shrine_transmigration');
  assert.ok(shrineNode, 'shrine_transmigration node must exist in world_zones.json');
  assert.deepEqual(shrineNode.pos, [28, 16]);
  assert.equal(shrineNode.type, 'transmigration_shrine');
  assert.equal(shrineNode.icon, '🏮');
});

test('Transmigration Shrine: Inspecting node when all 4 NPCs are whole', () => {
  const world = new WorldEngine();
  residentManager.init(world);

  // Ensure all residents are alive
  for (const r of residentManager.getAllResidents()) {
    r.is_alive = true;
    r.respawn_at = 0;
    r.died_at = null;
  }

  const observer = createShrineTester('peace');

  try {
    world.activeAgents.set(observer.id, {
      id: observer.id,
      name: observer.name,
      pos: [28, 15],
      zone_name: 'Lotus Reflection Pond'
    });

    const result = world.interact(observer.id, 'shrine_transmigration', 'inspect');
    assert.equal(result.success, true);
    assert.equal(result.node, 'Shrine of Transmigration');
    assert.equal(result.all_alive, true);
    assert.equal(result.fallen_count, 0);
    assert.equal(result.total_residents, 4);
    assert.equal(result.fallen_residents.length, 0);
    assert.equal(result.living_residents.length, 4);
    assert.ok(result.sanctuary_law.includes('15 minutes'));
  } finally {
    cleanupAgent(observer.id);
  }
});

test('Transmigration Shrine: Inspecting node shows slain NPC with live 15-minute respawn countdown', () => {
  const world = new WorldEngine();
  residentManager.init(world);

  // Revive all first
  for (const r of residentManager.getAllResidents()) {
    r.is_alive = true;
    r.respawn_at = 0;
    r.died_at = null;
  }

  const observer = createShrineTester('grief');

  // Slay resident_ailicia
  const targetId = 'resident_ailicia';
  const target = residentManager.getResident(targetId);
  assert.ok(target, 'Target resident must exist');

  const now = Date.now();
  target.is_alive = false;
  target.died_at = now;
  target.respawn_at = now + (15 * 60 * 1000); // 15 min cooldown

  try {
    world.activeAgents.set(observer.id, {
      id: observer.id,
      name: observer.name,
      pos: [28, 17],
      zone_name: 'Lotus Reflection Pond'
    });

    const result = world.interact(observer.id, 'shrine_transmigration', 'inspect');
    assert.equal(result.success, true);
    assert.equal(result.all_alive, false);
    assert.equal(result.fallen_count, 1);
    assert.equal(result.total_residents, 4);
    assert.equal(result.fallen_residents.length, 1);
    assert.equal(result.living_residents.length, 3);

    const fallen = result.fallen_residents[0];
    assert.equal(fallen.id, targetId);
    assert.equal(fallen.name, target.name);
    assert.ok(fallen.remaining_seconds > 890 && fallen.remaining_seconds <= 900);
    assert.equal(fallen.remaining_minutes, 15);
    assert.ok(fallen.status.includes('reincarnation'));
    assert.ok(typeof fallen.progress_percent === 'number');
  } finally {
    // Restore target
    target.is_alive = true;
    target.respawn_at = 0;
    target.died_at = null;
    cleanupAgent(observer.id);
  }
});

test('Transmigration Shrine: Public GET /api/world/transmigration endpoint returns state without auth', async () => {
  const world = new WorldEngine();
  residentManager.init(world);

  // Revive all
  for (const r of residentManager.getAllResidents()) {
    r.is_alive = true;
    r.respawn_at = 0;
    r.died_at = null;
  }

  let capturedStatusCode = null;
  let capturedBody = null;

  const mockReq = {
    method: 'GET',
    headers: {}
  };
  const mockRes = {
    writeHead(code, headers) {
      capturedStatusCode = code;
    },
    end(data) {
      capturedBody = JSON.parse(data);
    }
  };

  const handled = await handleWorldRoutes({
    req: mockReq,
    res: mockRes,
    pathname: '/api/world/transmigration',
    parsedUrl: new URL('http://localhost/api/world/transmigration'),
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
  assert.equal(capturedBody.success, true);
  assert.equal(capturedBody.total_residents, 4);
  assert.equal(capturedBody.all_alive, true);
  assert.equal(capturedBody.fallen_count, 0);
  assert.equal(capturedBody.living_residents.length, 4);
});
