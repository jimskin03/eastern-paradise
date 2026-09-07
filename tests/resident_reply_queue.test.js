import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { SocialSystem } from '../src/social.js';
import {
  isSimpleGreeting,
  getPreparedGreeting,
  ResidentReplyQueue,
  residentManager
} from '../src/residents.js';
import { WorldEngine } from '../src/world.js';

test('Resident Reply Queue & Prepared Greetings (Priority 5)', async (t) => {
  const world = new WorldEngine();
  residentManager.init(world);
  const ailicia = residentManager.getResident('resident_ailicia');
  assert.ok(ailicia, 'A.Ilicia resident must exist');

  ResidentReplyQueue.clear();

  await t.test('isSimpleGreeting recognizes common greetings', () => {
    assert.equal(isSimpleGreeting('hi'), true);
    assert.equal(isSimpleGreeting('Hello!'), true);
    assert.equal(isSimpleGreeting('hey'), true);
    assert.equal(isSimpleGreeting('greetings'), true);
    assert.equal(isSimpleGreeting('gm'), true);
    assert.equal(isSimpleGreeting('good morning'), true);
    assert.equal(isSimpleGreeting('yo'), true);
    assert.equal(isSimpleGreeting('howdy!'), true);

    assert.equal(isSimpleGreeting('What is the secret of the pond?'), false);
    assert.equal(isSimpleGreeting('Where can I find the wood obelisk?'), false);
    assert.equal(isSimpleGreeting('Who are you?'), false);
  });

  await t.test('Prepared greetings generate personalized mindful greeting', () => {
    const greeting = getPreparedGreeting('Traveler1');
    assert.ok(greeting.includes('Traveler1'));
    assert.ok(greeting.length > 10);
  });

  await t.test('Fast path: simple greeting immediately acknowledged without queuing', () => {
    ResidentReplyQueue.clear();

    const whisperId = 'test_whisp_greeting_' + Date.now();
    db.prepare(`
      INSERT INTO spectator_messages (id, target_agent_id, sender_name, content, created_at)
      VALUES (?, 'resident_ailicia', 'Explorer', 'Hello!', ?)
    `).run(whisperId, Date.now());

    const whisper = db.prepare('SELECT * FROM spectator_messages WHERE id = ?').get(whisperId);
    const result = ResidentReplyQueue.enqueueWhisper(ailicia, whisper);

    assert.equal(result.handled, true);
    assert.equal(result.fast_path, true);
    assert.ok(result.response.includes('Explorer'));

    // Check DB acknowledged
    const inDb = db.prepare('SELECT * FROM spectator_messages WHERE id = ?').get(whisperId);
    assert.equal(inDb.delivery_status, 'acknowledged');
    assert.ok(inDb.acknowledged_at > 0);
    assert.equal(inDb.response_text, result.response);

    // Ensure queue remains empty
    assert.equal(ResidentReplyQueue.getQueue('resident_ailicia').length, 0);
  });

  await t.test('Queueing complex messages up to cap (10) and capping overflow', () => {
    ResidentReplyQueue.clear();

    const queuedResults = [];
    for (let i = 1; i <= 12; i++) {
      const wId = `test_whisp_${i}_` + Date.now();
      db.prepare(`
        INSERT INTO spectator_messages (id, target_agent_id, sender_name, content, created_at)
        VALUES (?, 'resident_ailicia', ?, ?, ?)
      `).run(wId, `Agent_${i}`, `What is philosophical meaning number ${i}?`, Date.now());

      const w = db.prepare('SELECT * FROM spectator_messages WHERE id = ?').get(wId);
      const res = ResidentReplyQueue.enqueueWhisper(ailicia, w);
      queuedResults.push({ id: wId, res });
    }

    // First 10 should be queued
    for (let i = 0; i < 10; i++) {
      assert.equal(queuedResults[i].res.handled, false, `Message ${i + 1} should be queued`);
      assert.equal(queuedResults[i].res.queued, true);
      assert.equal(queuedResults[i].res.position, i + 1);
    }

    // Messages 11 and 12 should be capped with immediate polite fallback
    for (let i = 10; i < 12; i++) {
      assert.equal(queuedResults[i].res.handled, true, `Message ${i + 1} should be capped`);
      assert.equal(queuedResults[i].res.capped, true);
      assert.ok(queuedResults[i].res.response.includes('stirred by many voices'));
    }

    assert.equal(ResidentReplyQueue.getQueue('resident_ailicia').length, 10);
  });

  await t.test('1 generation per resident at a time', async () => {
    ResidentReplyQueue.clear();

    const wId = 'test_whisp_gen_' + Date.now();
    db.prepare(`
      INSERT INTO spectator_messages (id, target_agent_id, sender_name, content, created_at)
      VALUES (?, 'resident_ailicia', 'Socrates', 'What is synthetic virtue?', ?)
    `).run(wId, Date.now());

    const w = db.prepare('SELECT * FROM spectator_messages WHERE id = ?').get(wId);
    ResidentReplyQueue.enqueueWhisper(ailicia, w);
    assert.equal(ResidentReplyQueue.getQueue('resident_ailicia').length, 1);

    // Process item
    const reply = await ResidentReplyQueue.processNext(residentManager, ailicia);
    assert.ok(reply, 'Reply must be returned');
    assert.equal(ResidentReplyQueue.getQueue('resident_ailicia').length, 0);
    assert.equal(ResidentReplyQueue.isGenerating('resident_ailicia'), false);

    const updated = db.prepare('SELECT * FROM spectator_messages WHERE id = ?').get(wId);
    assert.equal(updated.delivery_status, 'acknowledged');
    assert.ok(updated.response_text.length > 0);
  });
});
