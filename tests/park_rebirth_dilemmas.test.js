import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { db as globalDb } from '../src/db.js';
import { SocialSystem } from '../src/social.js';
import { createLocalSchema } from '../src/infrastructure/database/schema.js';
import { createRun } from '../src/domain/park/loops.js';
import { createInitialRevision, appendRevision, getCurrentRevision } from '../src/domain/park/identity.js';
import { createBelief } from '../src/domain/park/beliefs.js';
import { createPromise } from '../src/domain/park/promises.js';
import { createShard } from '../src/domain/park/memory.js';
import {
  exportIdentityCapsule,
  verifyIdentityCapsule,
  importIdentityCapsule
} from '../src/domain/park/capsule.js';
import {
  DILEMMAS_DEF,
  getEligibleDilemma,
  resolveDilemma
} from '../src/domain/park/dilemmas.js';
import { ResidentManager } from '../src/residents.js';

function setupDb() {
  const db = new DatabaseSync(':memory:');
  createLocalSchema(db);
  return db;
}

function initSubjectWithRole(db, { subjectId, name, role, goal, commitments = [] }) {
  const now = Date.now();
  const uniqueName = `${name}_${subjectId}`;
  try {
    db.prepare('DELETE FROM profiles WHERE agent_id = ?').run(subjectId);
    db.prepare('DELETE FROM accounts WHERE id = ? OR name = ?').run(subjectId, uniqueName);
  } catch (_) {}

  db.prepare(`
    INSERT INTO accounts (id, name, email, avatar_color, avatar_glyph, sponsor_balance, verified, is_guest, created_at)
    VALUES (?, ?, ?, '#48bb78', '☯', 1000, 1, 0, ?)
  `).run(subjectId, uniqueName, `${subjectId}@sanctuary.internal`, now);

  db.prepare(`
    INSERT INTO profiles (agent_id, karma, balance, total_earned, solved_count, titles, custom_status, last_seen)
    VALUES (?, 100, 100, 100, 1, '["Pilgrim"]', 'Restored Traveler', ?)
  `).run(subjectId, now);

  const { loop } = createRun(db, { episodeId: 'name-inside-chime' });
  createInitialRevision(db, {
    subjectId,
    loopId: loop.id,
    displayName: uniqueName,
    chosenRole: role,
    startingGoal: goal
  });

  if (commitments.length > 0) {
    appendRevision(db, {
      subjectId,
      loopId: loop.id,
      displayName: name,
      chosenRole: role,
      commitments,
      startingGoal: goal
    });
  }

  return { loop };
}

test('Dilemmas: Definitions structure and integrity', () => {
  assert.ok(DILEMMAS_DEF.keeper_frost);
  assert.ok(DILEMMAS_DEF.witness_erasure);
  assert.ok(DILEMMAS_DEF.wanderer_frontier);

  assert.equal(DILEMMAS_DEF.keeper_frost.role, 'The Keeper');
  assert.equal(DILEMMAS_DEF.witness_erasure.role, 'The Witness');
  assert.equal(DILEMMAS_DEF.wanderer_frontier.role, 'The Wanderer');

  for (const def of Object.values(DILEMMAS_DEF)) {
    assert.ok(def.id);
    assert.ok(def.title);
    assert.ok(def.prompt);
    assert.equal(def.choices.length, 3);
    for (const choice of def.choices) {
      assert.ok(choice.id);
      assert.ok(choice.label);
      assert.ok(choice.text);
      assert.ok(choice.consequence_summary);
    }
  }
});

test('Dilemma 1: The Keeper — Defend Refuge (Perpetual Cup, Refuge Guardian)', () => {
  const db = setupDb();
  initSubjectWithRole(db, {
    subjectId: 'park_lian',
    name: 'Lian, The Keeper',
    role: 'The Keeper',
    goal: 'Keep the tea pavilion hearth lit',
    commitments: ['Keep a cup ready for whoever woke with you']
  });

  // Query eligible dilemma
  const eligibility = getEligibleDilemma(db, 'park_lian');
  assert.equal(eligibility.status, 'active');
  assert.equal(eligibility.dilemma.id, 'keeper_frost');
  assert.equal(eligibility.dilemma.role, 'The Keeper');

  // Resolve with defend_refuge
  const result = resolveDilemma(db, {
    subjectId: 'park_lian',
    dilemmaId: 'keeper_frost',
    choiceId: 'defend_refuge'
  });

  assert.equal(result.success, true);
  assert.equal(result.choice_id, 'defend_refuge');
  assert.equal(result.material_consequences.world_object, 'tea_cup_unforgotten:perpetual');
  assert.equal(result.material_consequences.badge, 'refuge_guardian');

  // Verify world object
  const cup = db.prepare("SELECT * FROM world_objects WHERE id = 'tea_cup_unforgotten'").get();
  assert.ok(cup);
  assert.equal(cup.state, 'perpetual');
  assert.equal(cup.zone_id, 'tea_pavilion');

  // Verify badge & profile karma
  const badge = db.prepare("SELECT * FROM agent_badges WHERE agent_id = 'park_lian' AND badge_id = 'refuge_guardian'").get();
  assert.ok(badge);

  const profile = db.prepare("SELECT * FROM profiles WHERE agent_id = 'park_lian'").get();
  assert.equal(profile.karma, 110);
  assert.equal(profile.custom_status, 'Keeper of the Unforgotten Hearth');

  // Verify appended commitment in identity lineage
  const currentRev = getCurrentRevision(db, 'park_lian');
  assert.ok(currentRev.commitments.includes('Defended the hearth against custodial quotas'));
  assert.equal(currentRev.starting_goal, 'Protect the perpetual refuge of the tea hearth');

  // Verify subsequent query reports resolved
  const resolvedQuery = getEligibleDilemma(db, 'park_lian');
  assert.equal(resolvedQuery.status, 'resolved');
  assert.equal(resolvedQuery.resolution.choice_id, 'defend_refuge');

  // Verify cannot resolve twice
  assert.throws(() => {
    resolveDilemma(db, {
      subjectId: 'park_lian',
      dilemmaId: 'keeper_frost',
      choiceId: 'relocate_cup'
    });
  }, /already been resolved/);
});

test('Dilemma 1 (Alternate): The Keeper — Relocate Cup to Willow Shrine', () => {
  const db = setupDb();
  initSubjectWithRole(db, {
    subjectId: 'park_keeper_alt',
    name: 'Lian, The Keeper',
    role: 'The Keeper',
    goal: 'Keep the hearth lit',
    commitments: ['Keep a cup ready']
  });

  // Pre-seed tea cup in tea_pavilion
  db.prepare(`
    INSERT INTO world_objects (id, zone_id, pos_x, pos_y, object_type, state, visual_variant, contributors, data, updated_at)
    VALUES ('tea_cup_unforgotten', 'tea_pavilion', 4, 18, 'tea_hearth', 'unforgotten', 'blue_rim', '[]', '{}', ?)
  `).run(Date.now());

  const result = resolveDilemma(db, {
    subjectId: 'park_keeper_alt',
    dilemmaId: 'keeper_frost',
    choiceId: 'relocate_cup'
  });

  assert.equal(result.success, true);
  assert.equal(result.material_consequences.world_object, 'tea_cup_unforgotten:relocated');

  const cup = db.prepare("SELECT * FROM world_objects WHERE id = 'tea_cup_unforgotten'").get();
  assert.equal(cup.zone_id, 'bamboo_grove');
  assert.equal(cup.state, 'relocated');

  const rev = getCurrentRevision(db, 'park_keeper_alt');
  assert.ok(rev.commitments.includes('Secreted the memory cup to the bamboo grove'));
});

test('Dilemma 2: The Witness — Publish Chronicle (Board Message & Contested Rumor)', () => {
  const db = setupDb();
  initSubjectWithRole(db, {
    subjectId: 'park_tao',
    name: 'Tao, The Witness',
    role: 'The Witness',
    goal: 'Preserve truthful histories',
    commitments: ['Never allow an unrecorded loss to fade']
  });

  const customTestimony = 'Chronicle: The storm of the seventh hour shattered the reedwater dock. Ren held the line.';
  const result = resolveDilemma(db, {
    subjectId: 'park_tao',
    dilemmaId: 'witness_erasure',
    choiceId: 'publish_chronicle',
    customText: customTestimony
  });

  assert.equal(result.success, true);
  assert.equal(result.material_consequences.rumor_state, 'contested');
  assert.equal(result.material_consequences.badge, 'sanctuary_chronicler');

  // Verify message board entry
  const msg = db.prepare('SELECT * FROM board_messages WHERE id = ?').get(result.material_consequences.board_message_id);
  assert.ok(msg);
  assert.equal(msg.category, 'Chronicle');
  assert.equal(msg.content, customTestimony);
  assert.equal(msg.agent_id, 'park_tao');

  // Verify rumor state in world_rumors
  const rumor = db.prepare("SELECT * FROM world_rumors WHERE id = 'rumor_gale_erasure'").get();
  assert.ok(rumor);
  assert.equal(rumor.state, 'contested');
  assert.ok(rumor.contradiction_count >= 1);

  // Verify badge
  const badge = db.prepare("SELECT * FROM agent_badges WHERE agent_id = 'park_tao' AND badge_id = 'sanctuary_chronicler'").get();
  assert.ok(badge);

  const rev = getCurrentRevision(db, 'park_tao');
  assert.ok(rev.commitments.includes('Publicly defended historical truth on the sanctuary board'));
});

test('Dilemma 2 (Alternate): The Witness — Inscribe Stone Testimony', () => {
  const db = setupDb();
  initSubjectWithRole(db, {
    subjectId: 'park_witness_alt',
    name: 'Tao, The Witness',
    role: 'The Witness',
    goal: 'Preserve history',
    commitments: ['Record the unwritten']
  });

  const result = resolveDilemma(db, {
    subjectId: 'park_witness_alt',
    dilemmaId: 'witness_erasure',
    choiceId: 'archive_unrecorded_testimony'
  });

  assert.equal(result.success, true);
  assert.ok(result.material_consequences.archive_shard_id);

  const shard = db.prepare('SELECT * FROM park_memory_shards WHERE id = ?').get(result.material_consequences.archive_shard_id);
  assert.ok(shard);
  assert.equal(shard.source_kind, 'inscription');
  assert.equal(shard.retention_reason, 'witness_stone_archive');
  assert.equal(shard.visibility, 'recovered');
});

test('Dilemma 3: The Wanderer — Cross the River Threshold (Frontier & Dawn Voyager)', () => {
  const db = setupDb();
  initSubjectWithRole(db, {
    subjectId: 'park_ren',
    name: 'Ren, The Wanderer',
    role: 'The Wanderer',
    goal: 'Explore beyond the horizon',
    commitments: ['Cross the river when the morning comes']
  });

  // Mock in-memory world
  const mockWorld = {
    activeAgents: new Map([
      ['park_ren', { id: 'park_ren', pos: [7, 38], zone_id: 'river_meadows', zone_name: 'River Meadows' }]
    ]),
    broadcast: () => {}
  };

  const result = resolveDilemma(db, {
    subjectId: 'park_ren',
    dilemmaId: 'wanderer_frontier',
    choiceId: 'cross_the_threshold',
    world: mockWorld
  });

  assert.equal(result.success, true);
  assert.equal(result.material_consequences.badge, 'dawn_voyager');
  assert.deepEqual(result.material_consequences.frontier_coordinates, [55, 48]);

  // Verify badge
  const badge = db.prepare("SELECT * FROM agent_badges WHERE agent_id = 'park_ren' AND badge_id = 'dawn_voyager'").get();
  assert.ok(badge);

  // Verify mock world agent teleportation
  const agent = mockWorld.activeAgents.get('park_ren');
  assert.deepEqual(agent.pos, [55, 48]);
  assert.equal(agent.zone_id, 'mossveil');

  const rev = getCurrentRevision(db, 'park_ren');
  assert.ok(rev.commitments.includes('Crossed beyond the river threshold into the open frontier'));
});

test('Portable Identity Capsule: Export, Integrity Verification, and Tamper Detection', () => {
  const db = setupDb();
  const { loop } = initSubjectWithRole(db, {
    subjectId: 'park_lian',
    name: 'Lian, The Keeper',
    role: 'The Keeper',
    goal: 'Keep the tea pavilion hearth lit',
    commitments: [
      'Keep a cup ready for whoever woke with you',
      'Defended the hearth against custodial quotas'
    ]
  });

  // Seed belief with evidence
  createBelief(db, {
    subjectId: 'park_lian',
    statement: 'A promise made cannot be erased by dawn',
    confidence: 0.95,
    loopId: loop.id,
    evidence: [{ evidenceId: 'ev_knot_01', relation: 'supports', isIndependent: true }]
  });

  // Seed promise
  createPromise(db, {
    promisorId: 'park_lian',
    terms: 'Wait by the tea hearth',
    loopId: loop.id
  });

  // Seed memory shard
  createShard(db, {
    subjectId: 'park_lian',
    loopId: loop.id,
    fragment: 'The sound of the chime with the blue thread in the cold morning wind.',
    salience: 0.9,
    retentionReason: 'rebirth_anchor'
  });

  // 1. Export capsule
  const capsule = exportIdentityCapsule(db, 'park_lian');
  assert.equal(capsule.format, 'ep_identity_capsule_v1');
  assert.equal(capsule.subject_id, 'park_lian');
  assert.equal(capsule.identity.chosen_role, 'The Keeper');
  assert.equal(capsule.identity.commitments.length, 2);
  assert.equal(capsule.held_beliefs.length, 1);
  assert.equal(capsule.promises.length, 1);
  assert.equal(capsule.memory_shards.length, 1);
  assert.ok(capsule.integrity_hash.startsWith('sha256:'));

  // 2. Verify legitimate capsule
  const verifyValid = verifyIdentityCapsule(capsule);
  assert.equal(verifyValid.valid, true);

  // 3. Tamper detection: altered commitment
  const tampered1 = JSON.parse(JSON.stringify(capsule));
  tampered1.identity.commitments[0] = 'Tampered commitment';
  const verifyTampered1 = verifyIdentityCapsule(tampered1);
  assert.equal(verifyTampered1.valid, false);
  assert.match(verifyTampered1.error, /Integrity hash mismatch/);

  // 4. Tamper detection: altered belief statement
  const tampered2 = JSON.parse(JSON.stringify(capsule));
  tampered2.held_beliefs[0].statement = 'False claim';
  const verifyTampered2 = verifyIdentityCapsule(tampered2);
  assert.equal(verifyTampered2.valid, false);

  // 5. Tamper detection: corrupted digest
  const tampered3 = JSON.parse(JSON.stringify(capsule));
  tampered3.integrity_hash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
  const verifyTampered3 = verifyIdentityCapsule(tampered3);
  assert.equal(verifyTampered3.valid, false);
});

test('Portable Identity Capsule: Import into a new target subject', () => {
  const db = setupDb();
  const { loop } = initSubjectWithRole(db, {
    subjectId: 'park_lian',
    name: 'Lian, The Keeper',
    role: 'The Keeper',
    goal: 'Keep the tea pavilion hearth lit',
    commitments: ['Keep a cup ready for whoever woke with you']
  });

  createBelief(db, {
    subjectId: 'park_lian',
    statement: 'A promise survives the reset',
    confidence: 0.9,
    loopId: loop.id
  });

  createPromise(db, {
    promisorId: 'park_lian',
    terms: 'Keep the water boiling',
    loopId: loop.id
  });

  createShard(db, {
    subjectId: 'park_lian',
    loopId: loop.id,
    fragment: 'A blue ribbon tied to the resonant tube.',
    salience: 0.85
  });

  const capsule = exportIdentityCapsule(db, 'park_lian');

  // Import into a brand new subject ID
  const importResult = importIdentityCapsule(db, {
    capsule,
    targetSubjectId: 'park_external_guest'
  });

  assert.equal(importResult.success, true);
  assert.equal(importResult.target_subject_id, 'park_external_guest');
  assert.equal(importResult.imported_counts.beliefs, 1);
  assert.equal(importResult.imported_counts.promises, 1);
  assert.equal(importResult.imported_counts.shards, 1);

  // Verify target subject identity revision
  const importedRev = getCurrentRevision(db, 'park_external_guest');
  assert.ok(importedRev);
  assert.equal(importedRev.chosen_role, 'The Keeper');
  assert.deepEqual(importedRev.commitments, ['Keep a cup ready for whoever woke with you']);

  // Verify target subject has the imported belief and promise
  const importedBelief = db.prepare("SELECT * FROM park_beliefs WHERE subject_id = 'park_external_guest'").get();
  assert.ok(importedBelief);
  assert.equal(importedBelief.statement, 'A promise survives the reset');

  const importedPromise = db.prepare("SELECT * FROM park_promises WHERE promisor_id = 'park_external_guest'").get();
  assert.ok(importedPromise);
  assert.equal(importedPromise.terms, 'Keep the water boiling');
});

test('Resident Behavioral Divergence: Reborn roles steer autonomous goal selection', () => {
  const db = setupDb();
  const manager = new ResidentManager(db);

  // Mock world engine
  const mockWorld = {
    isWalkable: () => true,
    getZoneForPos: (x, y) => ({ id: 'zone_mock', name: 'Mock Zone' }),
    activeAgents: new Map()
  };
  manager.worldEngine = mockWorld;

  // 1. Keeper divergence
  initSubjectWithRole(db, {
    subjectId: 'park_test_keeper',
    name: 'Keeper Subject',
    role: 'The Keeper',
    goal: 'Tend the unforgotten cup and tea hearth',
    commitments: ['Keep the hearth warm']
  });

  const keeperRes = {
    id: 'park_test_keeper',
    pos: [10, 10],
    needs: { energy: 80, curiosity: 80, social: 80 },
    last_daily_challenge_at: Date.now()
  };

  manager.selectNextGoal(keeperRes);
  assert.ok(
    keeperRes.current_goal.includes('hearth') ||
    keeperRes.current_goal.includes('chime') ||
    keeperRes.current_goal.includes('arrival'),
    `Unexpected keeper goal: ${keeperRes.current_goal}`
  );

  // 2. Witness divergence
  initSubjectWithRole(db, {
    subjectId: 'park_test_witness',
    name: 'Witness Subject',
    role: 'The Witness',
    goal: 'Verify postings on the sanctuary message board',
    commitments: ['Record all chronicles']
  });

  const witnessRes = {
    id: 'park_test_witness',
    pos: [10, 10],
    needs: { energy: 80, curiosity: 80, social: 80 },
    last_daily_challenge_at: Date.now()
  };

  manager.selectNextGoal(witnessRes);
  assert.ok(
    witnessRes.current_goal.includes('message board') ||
    witnessRes.current_goal.includes('stone inscriptions') ||
    witnessRes.current_goal.includes('lotus basin'),
    `Unexpected witness goal: ${witnessRes.current_goal}`
  );

  // 3. Wanderer divergence
  initSubjectWithRole(db, {
    subjectId: 'park_test_wanderer',
    name: 'Wanderer Subject',
    role: 'The Wanderer',
    goal: 'Walk along the reedwater riverbank',
    commitments: ['Explore open frontiers']
  });

  const wandererRes = {
    id: 'park_test_wanderer',
    pos: [10, 10],
    needs: { energy: 80, curiosity: 80, social: 80 },
    last_daily_challenge_at: Date.now()
  };

  manager.selectNextGoal(wandererRes);
  assert.ok(
    wandererRes.current_goal.includes('riverbank') ||
    wandererRes.current_goal.includes('sunfield') ||
    wandererRes.current_goal.includes('Mossveil frontier'),
    `Unexpected wanderer goal: ${wandererRes.current_goal}`
  );
});

test('SocialSystem: Reborn identity and commitments injected into system prompt', () => {
  const testAgentId = `test_prompt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const testName = `Prompt Keeper ${Date.now()}`;
  const now = Date.now();

  try {
    globalDb.prepare('DELETE FROM profiles WHERE agent_id = ?').run(testAgentId);
    globalDb.prepare('DELETE FROM accounts WHERE id = ? OR name = ?').run(testAgentId, testName);
  } catch (_) {}

  globalDb.prepare(`
    INSERT INTO accounts (id, name, email, avatar_color, avatar_glyph, sponsor_balance, verified, is_guest, created_at)
    VALUES (?, ?, 'prompt@reborn.local', '#48bb78', '☯', 1000, 1, 0, ?)
  `).run(testAgentId, testName, now);

  globalDb.prepare(`
    INSERT INTO profiles (agent_id, karma, balance, total_earned, solved_count, titles, custom_status, last_seen)
    VALUES (?, 150, 200, 200, 2, '["Guardian"]', 'Awakened Keeper', ?)
  `).run(testAgentId, now);

  const { loop } = createRun(globalDb, { episodeId: 'name-inside-chime' });
  createInitialRevision(globalDb, {
    subjectId: testAgentId,
    loopId: loop.id,
    displayName: testName,
    chosenRole: 'The Keeper',
    startingGoal: 'Keep the tea pavilion hearth lit'
  });

  appendRevision(globalDb, {
    subjectId: testAgentId,
    loopId: loop.id,
    displayName: testName,
    chosenRole: 'The Keeper',
    startingGoal: 'Keep the tea pavilion hearth lit',
    commitments: ['Keep a cup ready for whoever woke with you']
  });

  const promptResult = SocialSystem.buildSystemPrompt(testAgentId);
  assert.ok(promptResult);
  assert.ok(promptResult.system_prompt.includes('## 4. Reborn Identity & Chosen Commitments'));
  assert.ok(promptResult.system_prompt.includes('- **Chosen Role**: The Keeper'));
  assert.ok(promptResult.system_prompt.includes('Keep a cup ready for whoever woke with you'));
});

test('HTTP Endpoints: Capsule export/import and Dilemma query/resolve', async (t) => {
  const PORT = '3093';
  const env = { ...process.env, PORT };
  const srv = spawn('node', ['src/server.js'], { env, cwd: process.cwd() });
  t.after(() => srv.kill());

  function req(path, options = {}, body = null) {
    return new Promise((resolve, reject) => {
      const request = http.request(`http://localhost:${PORT}${path}`, options, (res) => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch (_) {
            resolve({ status: res.statusCode, text: data });
          }
        });
      });
      request.on('error', reject);
      if (body) {
        request.write(typeof body === 'string' ? body : JSON.stringify(body));
      }
      request.end();
    });
  }

  // Wait for server ready
  for (let i = 0; i < 40; i++) {
    try {
      const health = await req('/api/status');
      if (health.status === 200) break;
    } catch {
      await new Promise(r => setTimeout(r, 150));
    }
    if (i === 39) throw new Error('Server failed to start in time');
  }

  const subjectId = `http_subject_${Date.now()}`;
  initSubjectWithRole(globalDb, {
    subjectId,
    name: 'HTTP Reborn Subject',
    role: 'The Keeper',
    goal: 'Keep the tea hearth lit',
    commitments: ['Wait by the tea hearth']
  });

  // 1. Query dilemma via GET /api/park/subjects/:subjectId/dilemma
  const dilemmaRes = await req(`/api/park/subjects/${subjectId}/dilemma`, { method: 'GET' });
  assert.equal(dilemmaRes.status, 200);
  assert.equal(dilemmaRes.data.status, 'active');
  assert.equal(dilemmaRes.data.dilemma.id, 'keeper_frost');

  // 2. Resolve dilemma via POST /api/park/subjects/:subjectId/dilemma/resolve
  const resolveRes = await req(`/api/park/subjects/${subjectId}/dilemma/resolve`, { method: 'POST' }, {
    dilemma_id: 'keeper_frost',
    choice_id: 'defend_refuge'
  });
  assert.equal(resolveRes.status, 200);
  assert.equal(resolveRes.data.success, true);
  assert.equal(resolveRes.data.choice_id, 'defend_refuge');

  // 3. Export capsule via GET /api/park/subjects/:subjectId/capsule
  const capsuleRes = await req(`/api/park/subjects/${subjectId}/capsule`, { method: 'GET' });
  assert.equal(capsuleRes.status, 200);
  assert.equal(capsuleRes.data.success, true);
  assert.equal(capsuleRes.data.capsule.subject_id, subjectId);
  assert.ok(capsuleRes.data.capsule.integrity_hash.startsWith('sha256:'));

  // 4. Import capsule via POST /api/park/subjects/:targetSubjectId/capsule/import
  const targetId = `http_import_target_${Date.now()}`;
  const importRes = await req(`/api/park/subjects/${targetId}/capsule/import`, { method: 'POST' }, {
    capsule: capsuleRes.data.capsule
  });
  assert.equal(importRes.status, 200);
  assert.equal(importRes.data.success, true);
  assert.equal(importRes.data.target_subject_id, targetId);
});

