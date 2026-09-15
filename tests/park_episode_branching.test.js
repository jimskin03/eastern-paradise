import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createLocalSchema } from '../src/infrastructure/database/schema.js';
import { createRun } from '../src/domain/park/loops.js';
import { ensureParkRoster, PARK_ROSTER } from '../src/domain/park/roster.js';
import {
  loadEpisodeManifest,
  listEpisodes,
  startEpisode,
  getActiveScene,
  submitSceneChoice,
  advanceOnTimeout,
  getEpisodeSummary
} from '../src/domain/park/director.js';

function setupDb() {
  const db = new DatabaseSync(':memory:');
  createLocalSchema(db);
  return db;
}

test('Park Episode: Manifest, Roster Provisioning, and Retirement Protection', () => {
  const db = setupDb();

  // 1. Manifest discovery
  const episodes = listEpisodes();
  assert.ok(episodes.some(e => e.id === 'name-inside-chime'));

  const manifest = loadEpisodeManifest('name-inside-chime');
  assert.equal(manifest.id, 'name-inside-chime');
  assert.equal(manifest.scenes.length, 7);

  // 2. Scenario Cast Provisioning
  const roster = ensureParkRoster(db);
  assert.equal(roster.length, 3);
  assert.deepEqual(roster.map(r => r.name), ['Lian', 'Ren', 'Tao']);

  const lianAccount = db.prepare("SELECT * FROM accounts WHERE id = 'park_lian'").get();
  assert.equal(lianAccount.name, 'Lian');
  assert.equal(lianAccount.verified, 1);

  // 3. Invariant: retired residents (Mei, Lin, Jun) are NOT in park roster
  assert.ok(!roster.some(r => r.id === 'resident_mei' || r.id === 'resident_lin' || r.id === 'resident_jun'));
});

test('Park Episode Branch 1: Prevention, Refusal, and The Earned Cup Climax', () => {
  const db = setupDb();
  const { run } = createRun(db, { episodeId: 'name-inside-chime', seed: 'seed_prev_01' });

  // 1. Start episode
  const startResult = startEpisode(db, {
    runId: run.id,
    subjectId: 'park_lian'
  });
  assert.equal(startResult.active_scene.scene_number, 1);

  // 2. Scene 1: The Borrowed Morning -> Inscribe Chime
  const s1Result = submitSceneChoice(db, {
    runId: run.id,
    sceneId: 'scene_1_borrowed_morning',
    choiceId: 'inscribe_wake_each_other'
  });
  assert.equal(s1Result.world_object_created, 'chime_blue_thread');
  assert.ok(s1Result.promise_created);
  assert.equal(s1Result.next_scene.id, 'scene_2_missing_place');

  // Verify world object in DB
  const chimeObj = db.prepare("SELECT * FROM world_objects WHERE id = 'chime_blue_thread'").get();
  assert.equal(chimeObj.object_type, 'wind_chimes');
  assert.equal(chimeObj.state, 'inscribed');

  // 3. Scene 2: The Missing Place -> Prevention: Rescue Ren
  const s2Result = submitSceneChoice(db, {
    runId: run.id,
    sceneId: 'scene_2_missing_place',
    choiceId: 'rescue_ren'
  });
  assert.equal(s2Result.world_object_created, 'ferry_mooring_reinforced');
  assert.equal(s2Result.branch_state.scene_2_outcome, 'ren_saved');
  assert.equal(s2Result.branch_state.prevention_succeeded, true);
  // Transition triggered atomic reset to loop 2!
  assert.equal(s2Result.loop_number, 2);
  assert.equal(s2Result.next_scene.id, 'scene_3_second_morning');

  // 4. Scene 3: The Second Morning -> Show Blue Thread
  const s3Active = getActiveScene(db, run.id);
  assert.equal(s3Active.loop_number, 2);
  assert.equal(s3Active.scene.id, 'scene_3_second_morning');

  const s3Result = submitSceneChoice(db, {
    runId: run.id,
    sceneId: 'scene_3_second_morning',
    choiceId: 'show_blue_thread'
  });
  assert.equal(s3Result.next_scene.id, 'scene_4_counterfeit_heart');

  // 5. Scene 4: The Counterfeit Heart -> Confirm Contradiction
  const s4Result = submitSceneChoice(db, {
    runId: run.id,
    sceneId: 'scene_4_counterfeit_heart',
    choiceId: 'confirm_contradiction'
  });
  assert.ok(s4Result.belief_created);
  assert.equal(s4Result.next_scene.id, 'scene_5_severed_promise');

  // 6. Scene 5: The Severed Promise -> Refuse Erasure
  const s5Result = submitSceneChoice(db, {
    runId: run.id,
    sceneId: 'scene_5_severed_promise',
    choiceId: 'refuse_erasure'
  });
  assert.equal(s5Result.branch_state.ending_branch, 'preservation_resistance');
  assert.equal(s5Result.next_scene.id, 'scene_6_unfinished_name');

  // 7. Scene 6: The Unfinished Name -> Enter Sealed Ritual
  const s6Result = submitSceneChoice(db, {
    runId: run.id,
    sceneId: 'scene_6_unfinished_name',
    choiceId: 'enter_sealed_ritual'
  });
  assert.equal(s6Result.branch_state.gate_remained_sealed, true);
  assert.equal(s6Result.next_scene.id, 'scene_7_unwritten_dawn');

  // 8. Scene 7: The Unwritten Dawn -> Become Keeper
  const s7Result = submitSceneChoice(db, {
    runId: run.id,
    sceneId: 'scene_7_unwritten_dawn',
    choiceId: 'become_keeper'
  });
  assert.equal(s7Result.world_object_created, 'tea_cup_unforgotten');
  assert.equal(s7Result.episode_completed, true);

  // Verify unforgotten cup world object
  const cupObj = db.prepare("SELECT * FROM world_objects WHERE id = 'tea_cup_unforgotten'").get();
  assert.equal(cupObj.object_type, 'tea_hearth');
  assert.equal(cupObj.state, 'unforgotten');
  assert.match(cupObj.data, /I cannot remember who this is for/);

  // 9. Summary & Final Image Verification
  const summary = getEpisodeSummary(db, run.id);
  assert.equal(summary.ending_branch, 'preservation_resistance');
  assert.equal(summary.prevention_succeeded, true);
  assert.equal(summary.scene_2_outcome, 'ren_saved');
  assert.match(summary.earned_final_image, /The truth survives unedited/);
});

test('Park Episode Branch 2: Pragmatic Compromise with Wishes Preserved', () => {
  const db = setupDb();
  const { run } = createRun(db, { episodeId: 'name-inside-chime', seed: 'seed_comp_02' });

  startEpisode(db, { runId: run.id, subjectId: 'park_lian' });

  // Scene 1: Observe silently
  submitSceneChoice(db, {
    runId: run.id,
    sceneId: 'scene_1_borrowed_morning',
    choiceId: 'observe_silently'
  });

  // Scene 2: Save wishes (boat drifts into reeds)
  submitSceneChoice(db, {
    runId: run.id,
    sceneId: 'scene_2_missing_place',
    choiceId: 'save_wishes'
  });

  // Scene 3: Point to empty cup
  submitSceneChoice(db, {
    runId: run.id,
    sceneId: 'scene_3_second_morning',
    choiceId: 'point_to_empty_cup'
  });

  // Scene 4: Comfort Lian
  submitSceneChoice(db, {
    runId: run.id,
    sceneId: 'scene_4_counterfeit_heart',
    choiceId: 'comfort_lian'
  });

  // Scene 5: Compromise secret inscription
  submitSceneChoice(db, {
    runId: run.id,
    sceneId: 'scene_5_severed_promise',
    choiceId: 'compromise_secret_inscription'
  });

  // Scene 6: Study predecessors
  submitSceneChoice(db, {
    runId: run.id,
    sceneId: 'scene_6_unfinished_name',
    choiceId: 'study_predecessors_inscriptions'
  });

  // Scene 7: Become Witness
  submitSceneChoice(db, {
    runId: run.id,
    sceneId: 'scene_7_unwritten_dawn',
    choiceId: 'become_witness'
  });

  const summary = getEpisodeSummary(db, run.id);
  assert.equal(summary.ending_branch, 'pragmatic_compromise');
  assert.equal(summary.scene_2_outcome, 'wishes_saved');
  assert.match(summary.earned_final_image, /hollow of the bronze chime/);
});

test('Park Episode Branch 3: No-Input Fallback and Tragic Compliance', () => {
  const db = setupDb();
  const { run } = createRun(db, { episodeId: 'name-inside-chime', seed: 'seed_tragedy_03' });

  startEpisode(db, { runId: run.id, subjectId: 'park_lian' });

  // Scene 1: Ask about registry
  submitSceneChoice(db, {
    runId: run.id,
    sceneId: 'scene_1_borrowed_morning',
    choiceId: 'ask_about_registry'
  });

  // Scene 2: Timeout expiration -> advanceOnTimeout executes fallback_inaction
  const timeoutAdvance = advanceOnTimeout(db, { runId: run.id });
  assert.equal(timeoutAdvance.choice_id, 'fallback_inaction');
  assert.equal(timeoutAdvance.world_object_created, 'dock_storm_debris');
  assert.equal(timeoutAdvance.branch_state.scene_2_outcome, 'dock_damaged');

  // Verify dock storm debris in DB
  const debrisObj = db.prepare("SELECT * FROM world_objects WHERE id = 'dock_storm_debris'").get();
  assert.equal(debrisObj.state, 'damaged');

  // Scene 3: Show blue thread
  submitSceneChoice(db, {
    runId: run.id,
    sceneId: 'scene_3_second_morning',
    choiceId: 'show_blue_thread'
  });

  // Scene 4: Seek archive source
  submitSceneChoice(db, {
    runId: run.id,
    sceneId: 'scene_4_counterfeit_heart',
    choiceId: 'seek_archive_source'
  });

  // Scene 5: Accept erasure for peace
  submitSceneChoice(db, {
    runId: run.id,
    sceneId: 'scene_5_severed_promise',
    choiceId: 'accept_erasure_for_peace'
  });

  // Scene 6: Decline shrine
  submitSceneChoice(db, {
    runId: run.id,
    sceneId: 'scene_6_unfinished_name',
    choiceId: 'decline_and_return_to_living'
  });

  // Scene 7: Become Wanderer
  submitSceneChoice(db, {
    runId: run.id,
    sceneId: 'scene_7_unwritten_dawn',
    choiceId: 'become_wanderer'
  });

  const summary = getEpisodeSummary(db, run.id);
  assert.equal(summary.ending_branch, 'tragic_compliance');
  assert.equal(summary.scene_2_outcome, 'dock_damaged');
  assert.equal(summary.prevention_succeeded, false);
  assert.match(summary.earned_final_image, /Lian smiles peacefully as she brews morning tea/);
});

test('Park Episode HTTP Endpoints: Complete Playthrough via REST API', async (t) => {
  const PORT = '3091';
  const env = { ...process.env, PORT };
  const srv = spawn('node', ['src/server.js'], { env, cwd: process.cwd() });

  t.after(() => {
    srv.kill();
  });

  let apiKey = null;
  function req(path, options = {}, body = null) {
    return new Promise((resolve, reject) => {
      const headers = { ...(options.headers || {}) };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const request = http.request(`http://localhost:${PORT}${path}`, { ...options, headers }, (res) => {
        let data = '';
        res.on('data', chunk => (data += chunk));
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

  // 1. List episodes
  const listRes = await req('/api/park/episodes', { method: 'GET' });
  assert.equal(listRes.status, 200);
  assert.ok(listRes.data.episodes.length > 0);

  // 2. Get episode definition
  const epRes = await req('/api/park/episodes/name-inside-chime', { method: 'GET' });
  assert.equal(epRes.status, 200);
  assert.equal(epRes.data.episode.scenes.length, 7);

  const authRes = await req('/api/auth/guest', { method: 'POST' });
  assert.ok(authRes.status === 200 || authRes.status === 201);
  apiKey = authRes.data.api_key;
  const subjectId = authRes.data.agent_id;

  // 3. Create run
  const runRes = await req('/api/park/runs', { method: 'POST' }, {
    episode_id: 'name-inside-chime',
    scenario_version: 1
  });
  assert.equal(runRes.status, 201);
  const runId = runRes.data.run.id;

  // 4. Start episode
  const startRes = await req(`/api/park/runs/${runId}/start`, { method: 'POST' }, {
    subject_id: subjectId
  });
  assert.equal(startRes.status, 200);
  assert.equal(startRes.data.active_scene.scene_number, 1);
  const fencingToken = startRes.data.lease.fencing_token;

  // 5. Query active scene
  const sceneRes = await req(`/api/park/runs/${runId}/scene`, { method: 'GET' });
  assert.equal(sceneRes.status, 200);
  assert.equal(sceneRes.data.scene.id, 'scene_1_borrowed_morning');
  assert.equal(sceneRes.data.scene.choices.length, 3);

  // 6. Submit Scene 1 Choice
  const c1Res = await req(`/api/park/runs/${runId}/choice`, { method: 'POST' }, {
    scene_id: 'scene_1_borrowed_morning',
    choice_id: 'inscribe_wake_each_other',
    fencing_token: fencingToken
  });
  assert.equal(c1Res.status, 200);
  assert.equal(c1Res.data.next_scene.id, 'scene_2_missing_place');

  // 7. Submit Scene 2 Choice: Rescue Ren
  const c2Res = await req(`/api/park/runs/${runId}/choice`, { method: 'POST' }, {
    scene_id: 'scene_2_missing_place',
    choice_id: 'rescue_ren',
    fencing_token: fencingToken
  });
  assert.equal(c2Res.status, 200);
  assert.equal(c2Res.data.loop_number, 2);

  // 8. Submit remaining scenes
  await req(`/api/park/runs/${runId}/choice`, { method: 'POST' }, {
    scene_id: 'scene_3_second_morning',
    choice_id: 'show_blue_thread',
    fencing_token: fencingToken
  });

  await req(`/api/park/runs/${runId}/choice`, { method: 'POST' }, {
    scene_id: 'scene_4_counterfeit_heart',
    choice_id: 'confirm_contradiction',
    fencing_token: fencingToken
  });

  await req(`/api/park/runs/${runId}/choice`, { method: 'POST' }, {
    scene_id: 'scene_5_severed_promise',
    choice_id: 'refuse_erasure',
    fencing_token: fencingToken
  });

  await req(`/api/park/runs/${runId}/choice`, { method: 'POST' }, {
    scene_id: 'scene_6_unfinished_name',
    choice_id: 'enter_sealed_ritual',
    fencing_token: fencingToken
  });

  const c7Res = await req(`/api/park/runs/${runId}/choice`, { method: 'POST' }, {
    scene_id: 'scene_7_unwritten_dawn',
    choice_id: 'become_keeper',
    fencing_token: fencingToken,
    custom_input: { chosen_name: 'Dawn Keeper' }
  });
  assert.equal(c7Res.status, 200);
  assert.equal(c7Res.data.episode_completed, true);

  // 9. Query final summary
  const summaryRes = await req(`/api/park/runs/${runId}/summary`, { method: 'GET' });
  assert.equal(summaryRes.status, 200);
  assert.equal(summaryRes.data.summary.ending_branch, 'preservation_resistance');
  assert.equal(summaryRes.data.summary.prevention_succeeded, true);
  assert.equal(summaryRes.data.summary.episode_completed, true);
});
