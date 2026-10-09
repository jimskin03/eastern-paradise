import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { WorldEngine } from '../src/world.js';
import { residentManager, RESIDENTS_DEF, getApiKeyForResident } from '../src/residents.js';
import { AuthService } from '../src/auth.js';
import { JevDecisionService } from '../src/jev/decision-service.js';

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

test('NPC Combat: Roster contains 2 active NPCs and retires legacy NPCs', () => {
  const world = new WorldEngine();
  residentManager.init(world);

  const residents = residentManager.getAllResidents();
  assert.equal(residents.length, 2, 'Must have exactly 2 active residents');
  const residentIds = residents.map(r => r.id);
  assert.deepEqual(residentIds, ['resident_ailicia', 'resident_daoming']);

  // Verify the active residents share the configured API key
  process.env.GROQ_API_KEY_1 = 'mock_groq_key_pair1';
  process.env.GROQ_API_KEY_2 = 'mock_groq_key_pair2';

  assert.equal(getApiKeyForResident('resident_ailicia'), 'mock_groq_key_pair1');
  assert.equal(getApiKeyForResident('resident_daoming'), 'mock_groq_key_pair1');
  assert.equal(getApiKeyForResident('resident_kassandra'), null);
  assert.equal(getApiKeyForResident('resident_tian'), null);
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
    // Agent with missing/invalid position must fail
    world.activeAgents.set(agentId, { id: agentId, name: 'Void Agent', pos: null });
    const noPosAttack = world.attackResident(residentManager, agentId, 'resident_daoming');
    assert.equal(noPosAttack.ok, false);
    assert.equal(noPosAttack.error_code, 'NO_POSITION');

    // Agent positioned far away [0, 0] (distance ~21 tiles)
    world.activeAgents.set(agentId, { id: agentId, name: 'Far Agent', pos: [0, 0] });

    // Attack from distance must fail with clear vicinity requirement
    const farAttack = world.attackResident(residentManager, agentId, 'resident_daoming');
    assert.equal(farAttack.ok, false);
    assert.equal(farAttack.error_code, 'TOO_FAR');
    assert.ok(farAttack.message.includes('close vicinity'));
    assert.ok(farAttack.message.includes('within 3.0 tiles'));

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

  const daoming = residentManager.getResident('resident_daoming');
  assert.ok(daoming);
  daoming.pos = [20, 7];
  daoming.is_alive = 1;

  const { id: killerId } = createCombatAgent('killer', 200, 200);
  try {
    world.activeAgents.set(killerId, { id: killerId, name: 'Killer', pos: [20, 8] });
    const attack = world.attackResident(residentManager, killerId, 'resident_daoming');
    assert.equal(attack.ok, true);
    assert.equal(Boolean(daoming.is_alive), false);

    const now = Date.now();
    assert.ok(daoming.respawn_at >= now + (14 * 60 * 1000));
    assert.ok(daoming.respawn_at <= now + (16 * 60 * 1000));

    // Check respawn before cooldown expires
    const notReady = residentManager.checkRespawn(daoming);
    assert.equal(notReady, false);
    assert.equal(Boolean(daoming.is_alive), false);

    // Fast-forward respawn_at to past
    daoming.respawn_at = Date.now() - 1000;
    const revived = residentManager.checkRespawn(daoming);
    assert.equal(revived, true);
    assert.equal(Boolean(daoming.is_alive), true);
    assert.equal(daoming.respawn_at, 0);
  } finally {
    cleanupAgent(killerId);
  }
});

test('NPC Combat: one surviving NPC can defend via JEV and repel the attack', async () => {
  const world = new WorldEngine();
  residentManager.init(world);

  const target = residentManager.getResident('resident_daoming');
  const defender = residentManager.getResident('resident_ailicia');
  assert.ok(target);
  assert.ok(defender);

  target.pos = [35, 15];
  target.is_alive = true;
  target.respawn_at = 0;
  defender.pos = [35, 16]; // nearest surviving resident, distance 1
  defender.is_alive = true;
  defender.imprisoned = false;

  db.prepare('UPDATE profiles SET balance = 250, karma = 150, imprisoned_until = 0 WHERE agent_id = ?').run(defender.id);

  const attacker = createCombatAgent('defended', 100, 100);
  world.activeAgents.set(attacker.id, {
    id: attacker.id,
    name: `Warrior defended`,
    pos: [35, 17]
  });

  const jevService = new JevDecisionService({
    db,
    world,
    residentManager,
    options: { mock: true, globalCooldownMs: 0 }
  });
  const periodKey = jevService.budget.getPeriodKey();
  db.prepare('DELETE FROM jev_usage_daily WHERE period_key = ?').run(periodKey);
  db.prepare('UPDATE agent_runtime SET last_jev_decision_at = 0').run();
  for (const res of residentManager.getAllResidents()) {
    res.last_jev_decision_at = 0;
  }
  Object.defineProperty(world, 'combatDecisionService', {
    value: jevService,
    writable: true,
    configurable: true,
    enumerable: false
  });

  try {
    const result = await world.attackResident(residentManager, attacker.id, target.id);

    assert.equal(result.ok, true);
    assert.equal(result.success, true);
    assert.equal(result.outcome, 'repelled');
    assert.equal(result.defended, true);
    assert.equal(result.defender_id, defender.id);
    assert.equal(result.defender_merit_lost, 1);
    assert.equal(result.defender_karma_gained, 10);
    assert.equal(result.attacker_karma_lost, 10);
    assert.equal(result.merit_lost, 0);
    assert.equal(Boolean(target.is_alive), true, 'Defended target must survive the attack');

    const defenderProfile = db.prepare('SELECT balance, karma FROM profiles WHERE agent_id = ?').get(defender.id);
    const attackerProfile = db.prepare('SELECT balance, karma FROM profiles WHERE agent_id = ?').get(attacker.id);
    assert.equal(defenderProfile.balance, 249);
    assert.equal(defenderProfile.karma, 160);
    assert.equal(attackerProfile.balance, 100);
    assert.equal(attackerProfile.karma, 90);

    const attackEvent = db.prepare("SELECT * FROM world_events WHERE event_type = 'resident_attacked' AND actor_id = ? ORDER BY seq DESC LIMIT 1").get(attacker.id);
    assert.ok(attackEvent);
    const attackPayload = JSON.parse(attackEvent.payload);
    assert.equal(attackPayload.decision_maker_id, defender.id);
    assert.equal(attackPayload.combat_resolution, 'pre_resolve');

    const defenseEvent = db.prepare("SELECT * FROM world_events WHERE event_type = 'resident_defended' AND actor_id = ? ORDER BY seq DESC LIMIT 1").get(defender.id);
    assert.ok(defenseEvent);
    const defensePayload = JSON.parse(defenseEvent.payload);
    assert.equal(defensePayload.attack_event_id, attackEvent.id);
    assert.equal(defensePayload.defender_merit_lost, 1);
    assert.equal(defensePayload.defender_karma_gained, 10);
    assert.equal(defensePayload.attacker_karma_lost, 10);

    const combatDecision = db.prepare("SELECT * FROM jev_decisions WHERE event_id = ? AND trigger_type = 'resident_attacked' ORDER BY request_started_at DESC LIMIT 1").get(attackEvent.id);
    assert.ok(combatDecision, 'Combat attack must create exactly one JEV decision record');
    assert.equal(combatDecision.decision_count, 1);

    const actionRow = db.prepare('SELECT * FROM jev_resident_actions WHERE jev_decision_id = ?').get(combatDecision.id);
    assert.ok(actionRow);
    assert.equal(actionRow.action, 'DEFEND');
    assert.equal(actionRow.execution_status, 'EXECUTED');
  } finally {
    world.activeAgents.delete(attacker.id);
    cleanupAgent(attacker.id);
  }
});

test('NPC Combat: Repelled attack clamps negative karma at -30 and imprisons attacker', async () => {
  const world = new WorldEngine();
  residentManager.init(world);

  const target = residentManager.getResident('resident_daoming');
  const defender = residentManager.getResident('resident_ailicia');
  assert.ok(target);
  assert.ok(defender);

  target.pos = [35, 15];
  target.is_alive = true;
  target.respawn_at = 0;
  defender.pos = [35, 16];
  defender.is_alive = true;
  defender.imprisoned = false;
  db.prepare('UPDATE profiles SET balance = 250, karma = 150, imprisoned_until = 0 WHERE agent_id = ?').run(defender.id);

  const attacker = createCombatAgent('defended-negative', 100, -100);
  const attackerState = {
    id: attacker.id,
    name: 'Warrior defended-negative',
    pos: [35, 17]
  };
  world.activeAgents.set(attacker.id, attackerState);
  world.combatDecisionService = {
    decideCombatResponse: async () => ({ action: 'DEFEND' })
  };

  try {
    const result = await world.attackResident(residentManager, attacker.id, target.id);

    assert.equal(result.ok, true);
    assert.equal(result.outcome, 'repelled');
    assert.equal(result.defended, true);
    assert.equal(result.imprisoned, true);
    assert.equal(result.attacker_new_karma, -30);
    assert.equal(result.sentence_hours, 3);
    assert.match(result.message, /Dark Sanctuary/);
    assert.equal(Boolean(target.is_alive), true, 'The defended target must survive');

    const profile = db.prepare('SELECT karma, imprisoned_until FROM profiles WHERE agent_id = ?').get(attacker.id);
    assert.equal(profile.karma, -30);
    assert.equal(profile.imprisoned_until, result.imprisoned_until);
    assert.ok(profile.imprisoned_until > Date.now());

    assert.deepEqual(attackerState.pos, [2, 49]);
    assert.equal(attackerState.zone_name, 'The Dark Sanctuary');

    const record = db.prepare('SELECT * FROM prison_records WHERE agent_id = ?').get(attacker.id);
    assert.ok(record);
    assert.equal(record.karma_at_sentence, -30);
    assert.equal(record.released_at, null);
  } finally {
    world.activeAgents.delete(attacker.id);
    cleanupAgent(attacker.id);
  }
});

test('NPC Combat: Guest account can strike and slay an NPC in close vicinity', () => {
  const world = new WorldEngine();
  residentManager.init(world);

  const daoming = residentManager.getResident('resident_daoming');
  assert.ok(daoming);
  daoming.pos = [35, 15];
  daoming.is_alive = 1;
  daoming.respawn_at = 0;

  // Create real guest account
  const guest = AuthService.createGuest({ name: 'Guest Blade' });
  assert.ok(guest.success);
  assert.equal(guest.is_guest, true);
  assert.ok(guest.api_key.startsWith('ep_guest_'));

  try {
    // 1. Guest spawns far away -> attack rejected
    world.activeAgents.set(guest.agent_id, {
      id: guest.agent_id,
      name: guest.agent_name,
      pos: [0, 0],
      is_guest: 1
    });

    const farAttack = world.attackResident(residentManager, guest.agent_id, 'resident_daoming');
    assert.equal(farAttack.ok, false);
    assert.equal(farAttack.error_code, 'TOO_FAR');

    // 2. Guest moves to close vicinity [35, 16] (dist = 1.0 <= 3.0)
    world.activeAgents.set(guest.agent_id, {
      id: guest.agent_id,
      name: guest.agent_name,
      pos: [35, 16],
      is_guest: 1
    });

    const closeAttack = world.attackResident(residentManager, guest.agent_id, 'resident_daoming');
    assert.equal(closeAttack.ok, true);
    assert.equal(closeAttack.target_id, 'resident_daoming');
    assert.equal(closeAttack.merit_penalty, 50);
    assert.equal(closeAttack.karma_penalty, 50);
    assert.equal(closeAttack.new_karma, -30); // Guest karma is capped at the Dark Sanctuary floor
    assert.equal(closeAttack.imprisoned, true); // Sentenced to Dark Sanctuary!
    assert.ok(closeAttack.imprisoned_until > Date.now());

    // Daoming must now be fallen
    assert.equal(Boolean(daoming.is_alive), false);

    // Verify prison record was logged for guest
    const prisonRecord = db.prepare('SELECT * FROM prison_records WHERE agent_id = ?').get(guest.agent_id);
    assert.ok(prisonRecord);
    assert.equal(prisonRecord.agent_id, guest.agent_id);
    assert.equal(prisonRecord.agent_name, guest.agent_name);
  } finally {
    AuthService.purgeGuest(guest.agent_id);
    db.prepare('DELETE FROM prison_records WHERE agent_id = ?').run(guest.agent_id);
  }
});
