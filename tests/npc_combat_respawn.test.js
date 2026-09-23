import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { WorldEngine } from '../src/world.js';
import { residentManager, RESIDENTS_DEF, getApiKeyForResident } from '../src/residents.js';

function createCombatAgent(label, initialMerit = 100, initialKarma = 100) {
  const id = `agent_combat_${label}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  db.prepare('INSERT INTO accounts (id, name, email, api_key, verified, created_at) VALUES (?, ?, ?, ?, 1, ?)')
    .run(id, `Warrior ${label}`, `${id}@combat.test`, `key_${id}`, Date.now());
  db.prepare(`
    INSERT INTO profiles (agent_id, karma, balance, total_earned, solved_count, titles, solved_puzzles, custom_status, last_seen, imprisoned_until)
    VALUES (?, ?, ?, ?, 0, '[]', '[]', 'Ready for combat', ?, 0)
  `).run(id, initialKarma, initialMerit, initialMerit, Date.now());
  return { id, apiKey: `key_${id}` };
}

function cleanupAgent(id) {
  db.prepare('DELETE FROM prison_records WHERE agent_id = ?').run(id);
  db.prepare('DELETE FROM profiles WHERE agent_id = ?').run(id);
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
}

test('NPC Combat: Roster contains 4 NPCs with paired API keys', () => {
  const world = new WorldEngine();
  residentManager.init(world);

  const residents = residentManager.getAllResidents();
  assert.equal(residents.length, 4, 'Must have exactly 4 residents');
  const residentIds = residents.map(r => r.id);
  assert.deepEqual(residentIds, ['resident_ailicia', 'resident_daoming', 'resident_kassandra', 'resident_tian']);

  // Verify API key pairs
  process.env.GROQ_API_KEY_1 = 'mock_groq_key_pair1';
  process.env.GROQ_API_KEY_2 = 'mock_groq_key_pair2';

  assert.equal(getApiKeyForResident('resident_ailicia'), 'mock_groq_key_pair1');
  assert.equal(getApiKeyForResident('resident_daoming'), 'mock_groq_key_pair1');
  assert.equal(getApiKeyForResident('resident_kassandra'), 'mock_groq_key_pair2');
  assert.equal(getApiKeyForResident('resident_tian'), 'mock_groq_key_pair2');
});

test('NPC Combat: Proximity requirement and killing an NPC', () => {
  const world = new WorldEngine();
  residentManager.init(world);

  const daoming = residentManager.getResident('resident_daoming');
  assert.ok(daoming);
  daoming.pos = [20, 7];
  daoming.is_alive = 1;
  daoming.respawn_at = 0;

  const { id: agentId } = createCombatAgent('far', 200, 100);
  try {
    // Agent positioned far away [0, 0]
    world.activeAgents.set(agentId, { id: agentId, name: 'Far Agent', pos: [0, 0] });

    // Attack from distance must fail
    const farAttack = world.attackResident(residentManager, agentId, 'resident_daoming');
    assert.equal(farAttack.ok, false);
    assert.equal(farAttack.error_code, 'TOO_FAR');

    // Move close to daoming [20, 8] (distance 1.0 tile <= 3.0)
    world.activeAgents.set(agentId, { id: agentId, name: 'Close Agent', pos: [20, 8] });

    const closeAttack = world.attackResident(residentManager, agentId, 'resident_daoming');
    assert.equal(closeAttack.ok, true);
    assert.equal(closeAttack.target_id, 'resident_daoming');
    assert.equal(closeAttack.merit_penalty, 50);
    assert.equal(closeAttack.karma_penalty, 50);
    assert.equal(closeAttack.new_karma, 50);
    assert.equal(closeAttack.imprisoned, false);

    // Daoming must now be dead
    assert.equal(Boolean(daoming.is_alive), false);
    assert.ok(daoming.respawn_at > Date.now());

    // Attacking again must fail due to death cooldown
    const deadAttack = world.attackResident(residentManager, agentId, 'resident_daoming');
    assert.equal(deadAttack.ok, false);
    assert.equal(deadAttack.error_code, 'RESIDENT_FALLEN');
  } finally {
    cleanupAgent(agentId);
  }
});

test('NPC Combat: 15-minute respawn cooldown timer', () => {
  const world = new WorldEngine();
  residentManager.init(world);

  const tian = residentManager.getResident('resident_tian');
  assert.ok(tian);
  tian.pos = [4, 18];
  tian.is_alive = 1;

  const { id: killerId } = createCombatAgent('killer', 200, 200);
  try {
    world.activeAgents.set(killerId, { id: killerId, name: 'Killer', pos: [4, 19] });
    const attack = world.attackResident(residentManager, killerId, 'resident_tian');
    assert.equal(attack.ok, true);
    assert.equal(Boolean(tian.is_alive), false);

    const now = Date.now();
    assert.ok(tian.respawn_at >= now + (14 * 60 * 1000));
    assert.ok(tian.respawn_at <= now + (16 * 60 * 1000));

    // Check respawn before cooldown expires
    const notReady = residentManager.checkRespawn(tian);
    assert.equal(notReady, false);
    assert.equal(Boolean(tian.is_alive), false);

    // Fast-forward respawn_at to past
    tian.respawn_at = Date.now() - 1000;
    const revived = residentManager.checkRespawn(tian);
    assert.equal(revived, true);
    assert.equal(Boolean(tian.is_alive), true);
    assert.equal(tian.respawn_at, 0);
  } finally {
    cleanupAgent(killerId);
  }
});
