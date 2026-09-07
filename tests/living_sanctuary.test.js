import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { world } from '../src/world.js';
import { NavigationSystem } from '../src/navigation.js';
import { eventLedger } from '../src/events.js';
import { SocialSystem } from '../src/social.js';
import { ProjectManager, CHIME_OBJECT_ID } from '../src/projects.js';
import { residentManager, RESIDENTS_DEF } from '../src/residents.js';

test('Living Sanctuary: A* Pathfinding Engine', async () => {
  // Test 1: Simple straight path
  const isWalkable = (x, y) => world.isWalkable(x, y);
  const path = NavigationSystem.findPath([7, 8], [7, 10], isWalkable);
  assert.ok(path.length > 0, 'Path should be found');
  assert.deepEqual(path[path.length - 1], [7, 10], 'Last step should be destination');

  // Test 2: Same start and end
  const emptyPath = NavigationSystem.findPath([5, 5], [5, 5], isWalkable);
  assert.equal(emptyPath.length, 0, 'Start equals target should return empty path');

  // Test 3: Path around an obstacle (e.g. pond at x: 20..25, y: 20..24)
  const pathAroundObstacle = NavigationSystem.findPath([19, 22], [27, 22], isWalkable);
  assert.ok(pathAroundObstacle.length > 0, 'Path around obstacle should exist');
  for (const step of pathAroundObstacle) {
    assert.equal(isWalkable(step[0], step[1]), true, `Step [${step}] must be walkable`);
  }
});

test('Living Sanctuary: Resident Society Initialization & Persistence', async () => {
  // Initialize systems
  ProjectManager.init();
  residentManager.init(world);

  const residents = residentManager.getAllResidents();
  assert.equal(residents.length, RESIDENTS_DEF.length, `There must be exactly ${RESIDENTS_DEF.length} founding residents`);

  for (const def of RESIDENTS_DEF) {
    const res = residentManager.getResident(def.id);
    assert.ok(res, `Resident ${def.id} must be registered in manager`);
    assert.equal(res.name, def.name);
    assert.equal(res.role, def.role);
    assert.equal(res.is_resident, true);

    // Verify DB records
    const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(def.id);
    assert.ok(acc, `Account row must exist for ${def.id}`);
    assert.equal(acc.verified, 1);
    assert.equal(acc.is_guest, 0);

    const prof = db.prepare('SELECT * FROM profiles WHERE agent_id = ?').get(def.id);
    assert.ok(prof, `Profile row must exist for ${def.id}`);

    const traits = db.prepare('SELECT * FROM resident_traits WHERE agent_id = ?').get(def.id);
    assert.ok(traits, `Resident traits must exist for ${def.id}`);

    const runtime = db.prepare('SELECT * FROM agent_runtime WHERE agent_id = ?').get(def.id);
    assert.ok(runtime, `Agent runtime must exist for ${def.id}`);
    assert.equal(runtime.controller_type, 'resident');
  }
});

test('Living Sanctuary: Directed Relationships, Episodic Memories, and Promises', async () => {
  const junId = 'resident_jun';
  const linId = 'resident_lin';

  // Ensure clean test fixture for relationships
  db.prepare('DELETE FROM relationships WHERE agent_id = ? AND target_id = ?').run(junId, linId);

  // Test directed relationships
  const initialRel = SocialSystem.getRelationship(junId, linId);
  assert.equal(initialRel.familiarity, 10.0);
  assert.equal(initialRel.trust, 10.0);

  const updatedRel = SocialSystem.modifyRelationship(junId, linId, 15, 10);
  assert.equal(updatedRel.familiarity, 25.0);
  assert.equal(updatedRel.trust, 20.0);

  // Clamping test [0, 100]
  const clampedRel = SocialSystem.modifyRelationship(junId, linId, 200, -300);
  assert.equal(clampedRel.familiarity, 100);
  assert.equal(clampedRel.trust, 0);

  // Episodic memories
  const memory = SocialSystem.recordMemory(junId, 'evt_test', 'Bamboo Carving', 'Carved flute joints with Lin.', 0.8, 2);
  assert.ok(memory.id.startsWith('mem_'));
  assert.equal(memory.agent_id, junId);

  const memories = SocialSystem.getMemoriesForAgent(junId, 5);
  assert.ok(memories.length > 0);
  assert.equal(memories[0].subject, 'Bamboo Carving');

  // Promises
  const promise = SocialSystem.createPromise(junId, linId, 'assist_repair', { item: 'copper' });
  assert.equal(promise.status, 'pending');

  const pending = SocialSystem.getPendingPromises(junId);
  assert.ok(pending.some(p => p.id === promise.id));

  SocialSystem.resolvePromise(promise.id, 'fulfilled');
  const pendingAfter = SocialSystem.getPendingPromises(junId);
  assert.ok(!pendingAfter.some(p => p.id === promise.id));
});

test('Living Sanctuary: The Wishing-Tree Chime Playable Slice', async () => {
  // Ensure clean initial state for the chime
  db.prepare('DELETE FROM world_objects WHERE id = ?').run(CHIME_OBJECT_ID);
  ProjectManager.init();
  const chimeBefore = ProjectManager.getObject(CHIME_OBJECT_ID);
  assert.ok(chimeBefore);
  assert.equal(chimeBefore.object_type, 'resonance_chimes');
  assert.equal(chimeBefore.state, 'damaged');

  // Initial touch on damaged chime
  const ringDamaged = ProjectManager.ringChime('visitor_test', 'Tester Pilgrim');
  assert.equal(ringDamaged.success, true);
  assert.match(ringDamaged.sound, /dull_metallic_clank/);

  // Contribute materials
  const res1 = ProjectManager.contribute(CHIME_OBJECT_ID, 'visitor_test', 'Tester Pilgrim', 'willow_ribbon', 1);
  assert.equal(res1.success, true);
  assert.ok(res1.progress > 0);

  const res2 = ProjectManager.contribute(CHIME_OBJECT_ID, 'resident_jun', 'Jun the Maker', 'copper_striker', 1);
  assert.equal(res2.success, true);

  const res3 = ProjectManager.contribute(CHIME_OBJECT_ID, 'resident_mei', 'Mei the Tea Keeper', 'cedar_resin', 1);
  assert.equal(res3.success, true);

  // Finish remaining progress
  ProjectManager.contribute(CHIME_OBJECT_ID, 'resident_jun', 'Jun the Maker', 'repair_work', 5);

  const chimeAfter = ProjectManager.getObject(CHIME_OBJECT_ID);
  assert.equal(chimeAfter.state, 'completed');
  assert.equal(chimeAfter.visual_variant, 'harmonious_radiant');

  // Ring completed chime
  const ringCompleted = ProjectManager.ringChime('visitor_test', 'Tester Pilgrim');
  assert.equal(ringCompleted.success, true);
  assert.equal(ringCompleted.completed, true);
  assert.match(ringCompleted.sound, /resonant_pentatonic_harmonic/);
});

test('Living Sanctuary: Spectator Whisper Delivery & Resident Response', async () => {
  const junId = 'resident_jun';
  const msgId = 'spmsg_unit_' + Date.now();
  const now = Date.now();

  db.prepare(`
    INSERT INTO spectator_messages (id, target_agent_id, sender_name, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(msgId, junId, 'Wanderer77', 'Does the wind sound clear today?', now);

  const pendingWhispers = SocialSystem.getPendingWhispers(junId);
  assert.ok(pendingWhispers.some(w => w.id === msgId));

  // Acknowledge whisper
  const ack = SocialSystem.acknowledgeWhisper(msgId, 'The wind carries the tone true across the grove.', 'Jun the Maker');
  assert.ok(ack);
  assert.equal(ack.response_text, 'The wind carries the tone true across the grove.');

  // Verify DB state
  const updatedMsg = db.prepare('SELECT * FROM spectator_messages WHERE id = ?').get(msgId);
  assert.equal(updatedMsg.delivery_status, 'acknowledged');
  assert.ok(updatedMsg.acknowledged_at > 0);
  assert.equal(updatedMsg.response_text, 'The wind carries the tone true across the grove.');
});

test('Living Sanctuary: End-to-End Server REST Endpoints', async (t) => {
  const { spawn } = await import('node:child_process');
  const http = await import('node:http');

  const env = { ...process.env, PORT: '3055' };
  const srv = spawn('node', ['src/server.js'], { env, cwd: process.cwd() });

  await new Promise(res => setTimeout(res, 800));

  t.after(() => {
    srv.kill();
  });

  function req(path, options = {}, body = null) {
    const doReq = () => new Promise((resolve, reject) => {
      const request = http.request(`http://localhost:3055${path}`, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(data) });
          } catch (_) {
            resolve({ status: res.statusCode, headers: res.headers, text: data });
          }
        });
      });
      request.on('error', reject);
      if (body) {
        request.write(typeof body === 'string' ? body : JSON.stringify(body));
      }
      request.end();
    });

    return (async () => {
      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          return await doReq();
        } catch (err) {
          if (attempt === 7) throw err;
          await new Promise(r => setTimeout(r, 250));
        }
      }
    })();
  }

  // 1. GET /api/residents
  const resList = await req('/api/residents');
  assert.equal(resList.status, 200);
  assert.equal(resList.data.success, true);
  assert.equal(resList.data.count, RESIDENTS_DEF.length);
  assert.ok(resList.data.residents.some(r => r.id === 'resident_jun'));
  assert.ok(resList.data.residents.some(r => r.id === 'resident_ailicia'));

  // 2. GET /api/residents/resident_jun
  const resJun = await req('/api/residents/resident_jun');
  assert.equal(resJun.status, 200);
  assert.equal(resJun.data.success, true);
  assert.equal(resJun.data.resident.name, 'Jun the Maker');
  assert.ok(resJun.data.resident.needs);

  // 3. GET /api/projects
  const projRes = await req('/api/projects');
  assert.equal(projRes.status, 200);
  assert.equal(projRes.data.success, true);
  assert.ok(projRes.data.projects.length > 0);

  // 4. POST /api/projects/contribute
  const contribRes = await req('/api/projects/contribute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    object_id: 'obj_chime_bamboo',
    item_type: 'repair_work',
    contributor_name: 'Pilgrim Wanderer'
  });
  assert.equal(contribRes.status, 200);
  assert.equal(contribRes.data.success, true);

  // 5. GET /api/journal
  const journalRes = await req('/api/journal');
  assert.equal(journalRes.status, 200);
  assert.equal(journalRes.data.success, true);
  assert.ok(Array.isArray(journalRes.data.events));

  // 6. GET /api/journal/recap
  const recapRes = await req('/api/journal/recap?since=0');
  assert.equal(recapRes.status, 200);
  assert.equal(recapRes.data.success, true);
  assert.ok(Array.isArray(recapRes.data.recap));

  // 7. GET /api/spectator/whispers
  const whispersRes = await req('/api/spectator/whispers');
  assert.equal(whispersRes.status, 200);
  assert.equal(whispersRes.data.success, true);
  assert.ok(Array.isArray(whispersRes.data.whispers));
});

test('Living Sanctuary: A.Ilicia Ollama Whisper & Fallback Handling', async () => {
  const ailiciaId = 'resident_ailicia';
  db.prepare('DELETE FROM spectator_messages WHERE target_agent_id = ?').run(ailiciaId);

  const msgId = 'spmsg_ailicia_' + Date.now();
  const now = Date.now();

  db.prepare(`
    INSERT INTO spectator_messages (id, target_agent_id, sender_name, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(msgId, ailiciaId, 'MysticSeeker', 'What do you see in the mirror basin?', now);

  const pending = SocialSystem.getPendingWhispers(ailiciaId);
  assert.ok(pending.some(w => w.id === msgId));

  const res = residentManager.getResident(ailiciaId);
  assert.ok(res, 'A.Ilicia must exist in resident manager');
  res.action_duration_ms = 0;
  res.path = [];

  // Run tick to trigger whisper processing
  await residentManager.tick();

  const processed = db.prepare('SELECT * FROM spectator_messages WHERE id = ?').get(msgId);
  assert.equal(processed.delivery_status, 'acknowledged');
  assert.ok(processed.response_text.length > 0);
  assert.match(processed.response_text, /(reflection|ripple|stillness|mirror|pond)/i);
});

