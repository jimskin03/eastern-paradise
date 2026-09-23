import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { WorldEngine } from '../src/world.js';
import { residentManager } from '../src/residents.js';
import { checkAndHandleImprisonment } from '../src/domain/world/combat.js';

function createPrisonTester(label, initialMerit = 50, initialKarma = 20) {
  const nonce = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const id = `agent_prison_${label}_${nonce}`;
  const name = `Inmate ${label} ${nonce}`;
  db.prepare('INSERT INTO accounts (id, name, email, api_key, verified, created_at) VALUES (?, ?, ?, ?, 1, ?)')
    .run(id, name, `${id}@prison.test`, `key_${id}`, Date.now());
  db.prepare(`
    INSERT INTO profiles (agent_id, karma, balance, total_earned, solved_count, titles, solved_puzzles, custom_status, last_seen, imprisoned_until)
    VALUES (?, ?, ?, ?, 0, '[]', '[]', 'Free', ?, 0)
  `).run(id, initialKarma, initialMerit, initialMerit, Date.now());
  return { id, apiKey: `key_${id}`, name };
}

function cleanupAgent(id) {
  db.prepare('DELETE FROM prison_records WHERE agent_id = ?').run(id);
  db.prepare('DELETE FROM profiles WHERE agent_id = ?').run(id);
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
}

test('Dark Sanctuary: Negative karma sentences agent to 3 hours imprisonment', () => {
  const world = new WorldEngine();
  residentManager.init(world);

  const kassandra = residentManager.getResident('resident_kassandra');
  assert.ok(kassandra);
  kassandra.pos = [35, 15];
  kassandra.is_alive = 1;

  // Agent with 20 karma: killing an NPC will reduce karma by 50 to -30 (< 0)
  const agent = createPrisonTester('felon', 100, 20);
  try {
    world.activeAgents.set(agent.id, { id: agent.id, name: agent.name, pos: [35, 16], zone_name: 'celestial_overlook' });

    const result = world.attackResident(agent.id, 'resident_kassandra', residentManager);
    assert.equal(result.ok, true);
    assert.equal(result.imprisoned, true);
    assert.equal(result.new_karma, -30);
    assert.equal(result.sentence_hours, 3);

    const now = Date.now();
    assert.ok(result.imprisoned_until >= now + (3 * 3600 * 1000) - 5000);

    // Profile in DB must reflect imprisonment
    const profile = db.prepare('SELECT karma, imprisoned_until FROM profiles WHERE agent_id = ?').get(agent.id);
    assert.equal(profile.karma, -30);
    assert.equal(profile.imprisoned_until, result.imprisoned_until);

    // Active agent in world must be moved to Dark Sanctuary cell [2, 49]
    const inSanctuary = world.activeAgents.get(agent.id);
    assert.deepEqual(inSanctuary.pos, [2, 49]);
    assert.equal(inSanctuary.zone_name, 'The Dark Sanctuary');

    // Entry in prison_records must exist
    const record = db.prepare('SELECT * FROM prison_records WHERE agent_id = ?').get(agent.id);
    assert.ok(record);
    assert.equal(record.agent_name, agent.name);
    assert.equal(record.karma_at_sentence, -30);
    assert.equal(record.imprisoned_until - record.imprisoned_at, 3 * 3600 * 1000);
    assert.equal(record.released_at, null);
  } finally {
    cleanupAgent(agent.id);
  }
});

test('Dark Sanctuary: Imprisoned agent is blocked from movement and interactions', () => {
  const world = new WorldEngine();
  residentManager.init(world);

  const agent = createPrisonTester('locked', 50, -20);
  const now = Date.now();
  const threeHoursLater = now + (3 * 3600 * 1000);
  db.prepare('UPDATE profiles SET imprisoned_until = ? WHERE agent_id = ?').run(threeHoursLater, agent.id);

  try {
    world.activeAgents.set(agent.id, {
      id: agent.id,
      name: agent.name,
      pos: [2, 49],
      zone_name: 'The Dark Sanctuary',
      imprisoned: true,
      imprisoned_until: threeHoursLater
    });

    // 1. Move attempt must be rejected
    const moveRes = world.moveAgent(agent.id, 'north');
    assert.equal(moveRes.moved, false);
    assert.equal(moveRes.reason, 'imprisoned');

    // 2. MoveTo attempt must return imprisoned error
    const moveToRes = world.moveTo(agent.id, [2, 48]);
    assert.equal(moveToRes.moved, false);
    assert.equal(moveToRes.reason, 'imprisoned');
    assert.equal(moveToRes.error_code, 'IMPRISONED_IN_DARK_SANCTUARY');

    // 3. Teleport attempt must return imprisoned error
    const teleportRes = world.teleportGuestAgent(agent.id, 7, 8);
    assert.equal(teleportRes.success, false);
    assert.equal(teleportRes.error_code, 'IMPRISONED_IN_DARK_SANCTUARY');

    // 4. Interaction attempt must return imprisoned error
    const interactRes = world.interact(agent.id, 'shrine_dark_sanctuary', 'inspect');
    assert.equal(interactRes.success, false);
    assert.equal(interactRes.error_code, 'IMPRISONED_IN_DARK_SANCTUARY');

    // 5. Attacking another resident while imprisoned must fail
    assert.throws(() => {
      world.attackResident(agent.id, 'resident_ailicia', residentManager);
    }, (err) => err.code === 'IMPRISONED_IN_DARK_SANCTUARY');
  } finally {
    cleanupAgent(agent.id);
  }
});

test('Dark Sanctuary: Auto-release after 3 hours pardons agent and returns to Gate of Arrival', () => {
  const world = new WorldEngine();
  residentManager.init(world);

  const agent = createPrisonTester('reformed', 100, -40);
  // Imprisoned_until was in the past (e.g. 5 seconds ago)
  const expiredTime = Date.now() - 5000;
  db.prepare('UPDATE profiles SET imprisoned_until = ? WHERE agent_id = ?').run(expiredTime, agent.id);

  db.prepare(`
    INSERT INTO prison_records (id, agent_id, agent_name, avatar_color, avatar_glyph, crime, karma_at_sentence, imprisoned_at, imprisoned_until)
    VALUES (?, ?, ?, '#000', '⛓️', 'Slew resident', -40, ?, ?)
  `).run(`prec_${agent.id}`, agent.id, agent.name, expiredTime - 10800000, expiredTime);

  try {
    world.activeAgents.set(agent.id, {
      id: agent.id,
      name: agent.name,
      pos: [2, 49],
      zone_name: 'The Dark Sanctuary',
      imprisoned: true,
      imprisoned_until: expiredTime
    });

    const status = checkAndHandleImprisonment(world, agent.id);
    assert.equal(status.imprisoned, false);
    assert.equal(status.just_released, true);

    // Profile must now have imprisoned_until = 0 and karma normalized to 0
    const updatedProf = db.prepare('SELECT karma, imprisoned_until FROM profiles WHERE agent_id = ?').get(agent.id);
    assert.equal(updatedProf.imprisoned_until, 0);
    assert.equal(updatedProf.karma, 0);

    // Avatar must be relocated to Gate of Arrival [7, 8]
    const freedAgent = world.activeAgents.get(agent.id);
    assert.deepEqual(freedAgent.pos, [7, 8]);
    assert.equal(freedAgent.zone_name, 'Gate of Arrival');

    // Prison record must have released_at set
    const rec = db.prepare('SELECT released_at FROM prison_records WHERE agent_id = ?').get(agent.id);
    assert.ok(rec.released_at > 0);
  } finally {
    cleanupAgent(agent.id);
  }
});
