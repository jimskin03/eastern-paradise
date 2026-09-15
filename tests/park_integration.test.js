import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { db } from '../src/db.js';
import { SocialSystem } from '../src/social.js';
import { createShard } from '../src/domain/park/memory.js';

test('Park Reverie Engine: End-to-End Loop Reset, Memory Suppression, Cues, and Prompt Integration', async (t) => {
  const PORT = '3089';
  const env = { ...process.env, PORT };
  const srv = spawn('node', ['src/server.js'], { env, cwd: process.cwd() });

  t.after(() => {
    srv.kill();
  });

  function req(path, options = {}, body = null) {
    return new Promise((resolve, reject) => {
      const request = http.request(`http://localhost:${PORT}${path}`, options, (res) => {
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

  const subjectId = `agent_lian_${Date.now().toString(36)}`;

  // 1. Create a Park run
  const createRunRes = await req('/api/park/runs', { method: 'POST' }, {
    episode_id: 'name-inside-chime',
    scenario_version: 1,
    seed: 'dawn_seed_alpha'
  });
  assert.equal(createRunRes.status, 201);
  assert.ok(createRunRes.data.success);
  const runId = createRunRes.data.run.id;
  const loop1Id = createRunRes.data.loop.id;
  assert.equal(createRunRes.data.loop.loop_number, 1);

  // 2. Query run status
  const getRunRes = await req(`/api/park/runs/${runId}`, { method: 'GET' });
  assert.equal(getRunRes.status, 200);
  assert.equal(getRunRes.data.run.id, runId);
  assert.equal(getRunRes.data.current_loop.id, loop1Id);

  // 3. Enroll subject
  const enrollRes = await req(`/api/park/runs/${runId}/enroll`, { method: 'POST' }, {
    subject_id: subjectId,
    display_name: 'Lian, Lantern Keeper',
    chosen_role: 'Lantern Keeper',
    starting_goal: 'Tend the pavilion chimes',
    controller_id: 'controller_test_resident'
  });
  assert.equal(enrollRes.status, 200);
  assert.equal(enrollRes.data.identity.display_name, 'Lian, Lantern Keeper');
  assert.equal(enrollRes.data.identity.revision_number, 1);
  assert.ok(enrollRes.data.lease);
  assert.equal(enrollRes.data.lease.fencing_token, 1);

  // 4. Create an anchored promise in loop 1
  const promiseRes = await req('/api/park/actions/promise', { method: 'POST' }, {
    promisor_id: subjectId,
    anchor_object: 'wind_chimes',
    terms: 'Never let the third bell fall silent',
    loop_id: loop1Id
  });
  assert.equal(promiseRes.status, 201);
  const promiseId = promiseRes.data.promise.id;
  assert.equal(promiseRes.data.promise.status, 'active');

  // 5. Create memory shards: one retained trace and one transient memory
  const retainedShard = createShard(db, {
    subjectId,
    loopId: loop1Id,
    fragment: 'A knot of blue thread was tied beneath the bronze bell.',
    cueTags: ['wind_chimes', 'blue_thread'],
    salience: 0.9,
    retentionReason: 'chosen_promise'
  });

  const transientShard = createShard(db, {
    subjectId,
    loopId: loop1Id,
    fragment: 'Had jasmine tea with Ren at morning bell.',
    cueTags: ['tea', 'jasmine'],
    salience: 0.4
  });

  // 6. Record a belief
  const beliefRes = await req('/api/park/actions/believe', { method: 'POST' }, {
    subject_id: subjectId,
    statement: 'The bell cords are whole and unfrayed.',
    confidence: 0.85,
    loop_id: loop1Id
  });
  assert.equal(beliefRes.status, 201);
  const beliefId = beliefRes.data.belief.id;

  // 7. Get structured observation before reset (matching wind_chimes cue)
  const obs1Res = await req(`/api/park/loops/${loop1Id}/observation?subject_id=${subjectId}&cues=wind_chimes`, { method: 'GET' });
  assert.equal(obs1Res.status, 200);
  assert.equal(obs1Res.data.observation.reveries.length, 1);
  assert.equal(obs1Res.data.observation.reveries[0].shard_id, retainedShard.id);
  assert.equal(obs1Res.data.observation.active_promises.length, 1);

  // 8. Commit Loop Reset (Loop 1 -> Loop 2), explicitly preserving retainedShard
  const resetRes = await req(`/api/park/runs/${runId}/reset`, { method: 'POST' }, {
    current_loop_id: loop1Id,
    checkpointData: { event: 'morning_reset', trigger: 'bell_chime' },
    retained_shard_ids: [retainedShard.id]
  });
  assert.equal(resetRes.status, 200);
  assert.equal(resetRes.data.previousLoopId, loop1Id);
  const loop2Id = resetRes.data.newLoop.id;
  assert.equal(resetRes.data.newLoop.loop_number, 2);

  // 9. Verify promise transitioned to dormant
  const promisesRes = await req(`/api/park/subjects/${subjectId}/promises?status=dormant`, { method: 'GET' });
  assert.equal(promisesRes.status, 200);
  assert.equal(promisesRes.data.promises.length, 1);
  assert.equal(promisesRes.data.promises[0].id, promiseId);
  assert.equal(promisesRes.data.promises[0].status, 'dormant');

  // 10. Verify transient shard was suppressed while retained shard survived
  const activeShardsRes = await req(`/api/park/subjects/${subjectId}/shards`, { method: 'GET' });
  assert.equal(activeShardsRes.status, 200);
  assert.equal(activeShardsRes.data.shards.length, 1);
  assert.equal(activeShardsRes.data.shards[0].id, retainedShard.id);

  // 11. In loop 2, character encounters wind_chimes cue and rediscovers promise
  const redisRes = await req('/api/park/actions/promise/rediscover', { method: 'POST' }, {
    promise_id: promiseId,
    current_loop_id: loop2Id
  });
  assert.equal(redisRes.status, 200);
  assert.equal(redisRes.data.promise.status, 'rediscovered');
  assert.ok(redisRes.data.shard);

  // 12. Revise belief based on contradiction
  const reviseRes = await req('/api/park/actions/believe', { method: 'POST' }, {
    belief_id: beliefId,
    statement: 'The bell cord was cut deliberately with a knife.',
    confidence: 0.95,
    reason: 'Examined the frayed cord ends up close in loop 2',
    evidence: [
      { evidenceId: 'ev_cut_marks_found', relation: 'contradicts', isIndependent: true }
    ]
  });
  assert.equal(reviseRes.status, 200);
  assert.equal(reviseRes.data.belief.revision_number, 2);
  assert.equal(reviseRes.data.belief.previous_belief_id, beliefId);

  // 13. Verify buildSystemPrompt filters out suppressed memories and shows Park context
  // Ensure account row exists for prompt generation
  const uniqueName = `Lian_${Date.now().toString(36)}`;
  db.prepare(`
    INSERT INTO accounts (id, name, email, avatar_color, avatar_glyph, created_at)
    VALUES (?, ?, ?, '#48bb78', '☯', ?)
  `).run(subjectId, uniqueName, 'lian@sanctuary.internal', Date.now());

  const promptResult = SocialSystem.buildSystemPrompt(subjectId);
  assert.ok(promptResult);
  assert.ok(promptResult.system_prompt);
  // Suppressed transient shard must NOT appear in prompt
  assert.ok(!promptResult.system_prompt.includes('Had jasmine tea with Ren'));
  // Retained and rediscovered shard traces MUST appear
  assert.ok(promptResult.system_prompt.includes('knot of blue thread') || promptResult.system_prompt.includes('Never let the third bell'));
  // Held conviction must appear
  assert.ok(promptResult.system_prompt.includes('bell cord was cut deliberately'));

  // 14. Release controller lease
  const releaseRes = await req('/api/park/leases/release', { method: 'POST' }, {
    subject_id: subjectId,
    controller_id: 'controller_test_resident',
    fencing_token: 1
  });
  assert.equal(releaseRes.status, 200);
  assert.ok(releaseRes.data.lease.released_at > 0);
});
