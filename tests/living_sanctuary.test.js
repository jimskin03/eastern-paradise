import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Set before dynamic imports: test fixtures never touch a local or cloud save.
const testDataDir = mkdtempSync(path.join(tmpdir(), 'ep-residents-'));
process.env.DATA_DIR = testDataDir;
for (const key of ['TURSO_DATABASE_URL', 'TURSO_URL', 'TURSO_AUTH_TOKEN', 'RESEND_API_KEY', 'SMTP_HOST']) {
  delete process.env[key];
}
process.env.MAIL_MODE = 'dev';
process.env.OLLAMA_URL = 'http://127.0.0.1:1';
const { db } = await import('../src/db.js');
const { world } = await import('../src/world.js');
const { NavigationSystem } = await import('../src/navigation.js');
const { eventLedger } = await import('../src/events.js');
const { SocialSystem } = await import('../src/social.js');
const { ProjectManager, CHIME_OBJECT_ID } = await import('../src/projects.js');
const { residentManager, RESIDENTS_DEF, queryOllama, queryGroq, queryLLM } = await import('../src/residents.js');
const { RETIRED_RESIDENT_IDS } = await import('../src/resident-policy.js');
const { AuthService } = await import('../src/auth.js');
const { EconomyManager } = await import('../src/economy.js');
test.after(() => {
  db.close();
  rmSync(testDataDir, { recursive: true, force: true });
});

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
  assert.deepEqual(RESIDENTS_DEF.map(r => r.id), ['resident_ailicia']);
  assert.deepEqual(residents.map(r => r.id), ['resident_ailicia']);

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

test('Living Sanctuary: Retires exactly the previous NPC seeds without deleting history or visitors', () => {
  for (const id of RETIRED_RESIDENT_IDS) {
    db.prepare(`INSERT INTO accounts (id, name, email, verified, api_key, verification_token, created_at)
      VALUES (?, ?, ?, 1, ?, ?, ?)`).run(id, id, id + '@sanctuary.internal', 'test_key_' + id, 'test_token_' + id, Date.now());
    db.prepare(`INSERT INTO profiles (agent_id, balance, total_earned, last_seen) VALUES (?, 321, 432, ?)`).run(id, Date.now());
    db.prepare(`INSERT INTO agent_runtime (agent_id, controller_type, updated_at) VALUES (?, 'resident', ?)`).run(id, Date.now());
    SocialSystem.recordMemory(id, 'historic_event', 'A shared past', 'A memory that must be retained.');
    world.activeAgents.set(id, { id, name: id, is_resident: true, pos: [7, 8] });
  }
  const visitor = { id: 'visitor_living_test', name: 'Jun the Maker', pos: [7, 8], is_resident: false };
  db.prepare(`INSERT INTO accounts (id, name, email, verified, api_key, created_at)
    VALUES (?, ?, 'visitor@example.com', 1, 'test_visitor_key', ?)`).run(visitor.id, visitor.name, Date.now());
  db.prepare(`INSERT INTO profiles (agent_id, balance, total_earned, last_seen) VALUES (?, 99, 100, ?)`).run(visitor.id, Date.now());
  world.activeAgents.set(visitor.id, visitor);

  residentManager.init(world);
  residentManager.init(world);
  assert.deepEqual(residentManager.getAllResidents().map(r => r.id), ['resident_ailicia']);
  assert.equal(world.activeAgents.get(visitor.id), visitor, 'A visitor with a former NPC name stays untouched');
  for (const id of RETIRED_RESIDENT_IDS) {
    assert.equal(world.activeAgents.has(id), false);
    assert.equal(db.prepare('SELECT controller_type FROM agent_runtime WHERE agent_id = ?').get(id).controller_type, 'retired');
    assert.equal(db.prepare('SELECT balance FROM profiles WHERE agent_id = ?').get(id).balance, 321);
    assert.equal(SocialSystem.getMemoriesForAgent(id).length, 1);
    assert.equal(AuthService.login(id, 'test_key_' + id).success, false);
    assert.equal(AuthService.verifyToken('test_token_' + id).success, false);
    assert.equal(AuthService.authenticate({ headers: { authorization: 'Bearer test_key_' + id } }), null);
    assert.equal(EconomyManager.getBalance(id), null);
  }
  assert.equal(AuthService.login(visitor.name, 'test_visitor_key').success, true);
  const leaderboard = EconomyManager.getLeaderboard(100);
  assert.ok(leaderboard.top_agents.some(agent => agent.id === visitor.id));
  for (const list of [leaderboard.top_agents, leaderboard.top_sponsors]) {
    assert.ok(list.every(agent => !RETIRED_RESIDENT_IDS.includes(agent.id)));
  }
});

test('Living Sanctuary: A.Ilicia completes the chime without retired NPCs', async () => {
  db.prepare('DELETE FROM world_objects WHERE id = ?').run(CHIME_OBJECT_ID);
  ProjectManager.init();
  residentManager.init(world);
  const ailicia = residentManager.getResident('resident_ailicia');
  // A visitor supplies one material: A.Ilicia should retain this contribution.
  ProjectManager.contribute(CHIME_OBJECT_ID, 'visitor_living_test', 'Sanctuary Visitor', 'willow_ribbon');
  for (let i = 0; i < 500 && ProjectManager.getObject(CHIME_OBJECT_ID).state !== 'completed'; i++) {
    await residentManager.tick();
  }
  const chime = ProjectManager.getObject(CHIME_OBJECT_ID);
  assert.equal(chime.state, 'completed', `Chime must finish; A.Ilicia at ${ailicia.pos}, intent ${ailicia.public_intent}`);
  assert.deepEqual(new Set(chime.contributors.map(c => c.id)), new Set(['visitor_living_test', 'resident_ailicia']));
  const before = JSON.stringify(chime.data);
  residentManager.init(world);
  ProjectManager.init();
  assert.equal(JSON.stringify(ProjectManager.getObject(CHIME_OBJECT_ID).data), before);
});

test('Living Sanctuary: A.Ilicia can restore a fresh chime with no visitor contributions', async () => {
  db.prepare('DELETE FROM world_objects WHERE id = ?').run(CHIME_OBJECT_ID);
  ProjectManager.init();
  residentManager.init(world);
  for (let i = 0; i < 500 && ProjectManager.getObject(CHIME_OBJECT_ID).state !== 'completed'; i++) {
    await residentManager.tick();
  }
  const chime = ProjectManager.getObject(CHIME_OBJECT_ID);
  assert.equal(chime.state, 'completed');
  assert.deepEqual(chime.contributors.map(c => c.id), ['resident_ailicia']);
});

test('Living Sanctuary: A.Ilicia greets visitors without controlling their actions', () => {
  const ailicia = residentManager.getResident('resident_ailicia');
  const visitor = world.activeAgents.get('visitor_living_test');
  const before = structuredClone(visitor);
  residentManager.greetVisitor(ailicia, visitor);
  assert.deepEqual(visitor, before);
  assert.equal(SocialSystem.getRelationshipsForAgent(ailicia.id)[0].target_id, visitor.id);
  SocialSystem.modifyRelationship(ailicia.id, 'resident_jun', 90, 90);
  assert.ok(SocialSystem.getRelationshipsForAgent(ailicia.id).every(r => r.target_id !== 'resident_jun'));
});

test('Living Sanctuary: Directed Relationships, Episodic Memories, and Promises', async () => {
  const junId = 'resident_ailicia';
  const linId = 'visitor_living_test';

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
  const memory = SocialSystem.recordMemory(junId, 'evt_test', 'Bamboo Carving', 'Carved flute joints with a sanctuary visitor.', 0.8, 5);
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

  const res2 = ProjectManager.contribute(CHIME_OBJECT_ID, 'resident_ailicia', 'A.Ilicia', 'copper_striker', 1);
  assert.equal(res2.success, true);

  const res3 = ProjectManager.contribute(CHIME_OBJECT_ID, 'visitor_living_test', 'Sanctuary Visitor', 'cedar_resin', 1);
  assert.equal(res3.success, true);

  // Finish remaining progress
  ProjectManager.contribute(CHIME_OBJECT_ID, 'resident_ailicia', 'A.Ilicia', 'repair_work', 5);

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
  const junId = 'resident_ailicia';
  const msgId = 'spmsg_unit_' + Date.now();
  const now = Date.now();

  db.prepare(`
    INSERT INTO spectator_messages (id, target_agent_id, sender_name, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(msgId, junId, 'Wanderer77', 'Does the wind sound clear today?', now);

  const pendingWhispers = SocialSystem.getPendingWhispers(junId);
  assert.ok(pendingWhispers.some(w => w.id === msgId));

  // Acknowledge whisper
  const ack = SocialSystem.acknowledgeWhisper(msgId, 'The wind carries the tone true across the grove.', 'A.Ilicia');
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
  // Simulate restored data from the original four-resident deployment.
  for (const id of RETIRED_RESIDENT_IDS) {
    db.prepare("UPDATE agent_runtime SET controller_type = 'resident', action_state = 'walking' WHERE agent_id = ?").run(id);
  }
  const srv = spawn('node', ['src/server.js'], { env, cwd: process.cwd() });

  await new Promise(res => setTimeout(res, 800));

  t.after(async () => {
    if (srv.exitCode !== null || srv.signalCode !== null) return;
    const exited = new Promise(resolve => srv.once('exit', resolve));
    srv.kill();
    await exited;
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
  assert.deepEqual(resList.data.residents.map(r => r.id), ['resident_ailicia']);

  // 2. A.Ilicia is the sole NPC. Archived residents cannot re-enter.
  const resJun = await req('/api/residents/resident_ailicia');
  assert.equal(resJun.status, 200);
  assert.equal(resJun.data.success, true);
  assert.equal(resJun.data.resident.name, 'A.Ilicia');
  assert.ok(resJun.data.resident.needs);

  const inhabitants = await req('/api/inhabitants');
  const leaderboard = await req('/api/economy/leaderboard');
  assert.ok(inhabitants.data.inhabitants.some(agent => agent.id === 'visitor_living_test'));
  assert.ok(inhabitants.data.inhabitants.some(agent => agent.id === 'resident_ailicia'));
  for (const id of RETIRED_RESIDENT_IDS) {
    assert.equal((await req('/api/residents/' + id)).status, 404);
    assert.equal((await req('/api/profile/' + id)).status, 404);
    assert.ok(!inhabitants.data.inhabitants.some(agent => agent.id === id));
    assert.ok(!leaderboard.data.top_agents.some(agent => agent.id === id));
    assert.ok(!leaderboard.data.top_sponsors.some(agent => agent.id === id));
    const whisper = await req('/api/spectator/message', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }
    }, { target_agent_id: id, content: 'Can you return?' });
    assert.equal(whisper.status, 404);
    const state = await req('/api/world/state', { headers: { Authorization: 'Bearer test_key_' + id } });
    assert.equal(state.status, 401);
  }

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

test('Living Sanctuary: A.Ilicia Ollama Whisper & Fallback Handling', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline test'); });
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


test('Living Sanctuary: A.Ilicia uses the configured Ollama contract with a mocked response', async (t) => {
  let request;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ response: '"Every ripple carries a possibility."' }) };
  });
  const reply = await queryOllama('What does the pond reflect?');
  assert.equal(reply, 'Every ripple carries a possibility.');
  assert.equal(request.url, 'http://127.0.0.1:1/api/generate');
  assert.match(request.body.system, /A\.Ilicia/);
  assert.equal(request.body.prompt, 'What does the pond reflect?');
  assert.equal(request.body.stream, false);
  assert.equal(request.body.model, process.env.OLLAMA_MODEL || 'qwen2.5:latest');
});

test('Living Sanctuary: A.Ilicia uses Groq Cloud API when GROQ_API_KEY is configured', async (t) => {
  const origKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'gsk_test_mock_key_123';

  let request;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '"The mirror basin shows not who you are, but the stillness you seek."'
            }
          }
        ]
      })
    };
  });

  try {
    const reply = await queryGroq('What is the lotus pond?');
    assert.equal(reply, 'The mirror basin shows not who you are, but the stillness you seek.');
    assert.equal(request.url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(request.options.headers['Authorization'], 'Bearer gsk_test_mock_key_123');
    assert.equal(request.body.model, 'llama-3.1-8b-instant');
    assert.equal(request.body.messages[0].role, 'system');
    assert.match(request.body.messages[0].content, /A\.Ilicia/);
    assert.equal(request.body.messages[1].role, 'user');
    assert.equal(request.body.messages[1].content, 'What is the lotus pond?');

    // Test unified queryLLM prefers Groq when key is present
    const unifiedReply = await queryLLM('Tell me a thought');
    assert.equal(unifiedReply, 'The mirror basin shows not who you are, but the stillness you seek.');
  } finally {
    if (origKey !== undefined) {
      process.env.GROQ_API_KEY = origKey;
    } else {
      delete process.env.GROQ_API_KEY;
    }
  }
});

test('Living Sanctuary: queryLLM falls back to Ollama or template when Groq fails', async (t) => {
  const origKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'gsk_test_error_key';

  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('groq.com')) {
      return { ok: false, status: 429, statusText: 'Too Many Requests' };
    }
    // Ollama fallback
    return {
      ok: true,
      json: async () => ({ response: 'A serene fallback thought from local model.' })
    };
  });

  try {
    const reply = await queryLLM('Are you awake?');
    assert.equal(reply, 'A serene fallback thought from local model.');
  } finally {
    if (origKey !== undefined) {
      process.env.GROQ_API_KEY = origKey;
    } else {
      delete process.env.GROQ_API_KEY;
    }
  }
});
