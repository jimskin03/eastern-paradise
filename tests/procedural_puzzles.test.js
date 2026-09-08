import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';

test('Procedural Puzzle Engine HTTP Endpoints (/api/puzzles/*)', async (t) => {
  const PORT = '3089';
  const env = { ...process.env, PORT };
  const srv = spawn('node', ['src/server.js'], { env, cwd: process.cwd() });

  await new Promise(res => setTimeout(res, 900));

  t.after(() => {
    srv.kill();
  });

  function req(path, options = {}, body = null) {
    return new Promise((resolve, reject) => {
      const request = http.request(`http://localhost:${PORT}${path}`, options, (res) => {
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
  }

  // 1. Start Hard Puzzle (hidden_machine)
  const startHardRes = await req('/api/puzzles/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { tier: 'hard', archetype: 'hidden_machine' });

  assert.equal(startHardRes.status, 200);
  assert.equal(startHardRes.data.success, true);
  assert.equal(startHardRes.data.tier, 'hard');
  assert.equal(startHardRes.data.archetype, 'hidden_machine');
  assert.ok(startHardRes.data.instance_id);
  assert.ok(startHardRes.data.attempt_id);
  assert.ok(startHardRes.data.seed_hash);
  assert.ok(startHardRes.data.target_input);
  assert.equal(startHardRes.data.secret_seed, undefined, 'Secret seed must never leak to client');

  const hardInstanceId = startHardRes.data.instance_id;

  // 2. Perform experiment action on hidden_machine
  const actionRes = await req(`/api/puzzles/${hardInstanceId}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    action: 'experiment',
    inputs: ['WOOD', 'FIRE', 'EARTH']
  });

  assert.equal(actionRes.status, 200);
  assert.equal(actionRes.data.success, true);
  assert.equal(actionRes.data.action, 'experiment');
  assert.ok(typeof actionRes.data.output === 'number');

  // 3. Inspect Status
  const statusRes = await req(`/api/puzzles/${hardInstanceId}/status`);
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.data.success, true);
  assert.equal(statusRes.data.instance_id, hardInstanceId);
  assert.equal(statusRes.data.status, 'active');

  // 4. Start Celestial Puzzle (adaptive_world)
  const startCelestialRes = await req('/api/puzzles/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { tier: 'celestial', archetype: 'adaptive_world' });

  assert.equal(startCelestialRes.status, 200);
  assert.equal(startCelestialRes.data.success, true);
  assert.equal(startCelestialRes.data.tier, 'celestial');
  assert.equal(startCelestialRes.data.archetype, 'adaptive_world');
  assert.ok(startCelestialRes.data.instance_id);
  assert.ok(startCelestialRes.data.actions_remaining <= 45);
  assert.ok(startCelestialRes.data.inspections_remaining <= 8);
  assert.equal(startCelestialRes.data.difficulty.tier, 'celestial');
  assert.ok(startCelestialRes.data.difficulty.score >= 171);

  // 5. Submit Wrong Answer to Hard Puzzle
  const submitWrongRes = await req(`/api/puzzles/${hardInstanceId}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    solution: -99999
  });

  assert.equal(submitWrongRes.status, 200);
  assert.equal(submitWrongRes.data.success, true);
  assert.equal(submitWrongRes.data.is_correct, false);
  assert.equal(submitWrongRes.data.reward, 0);

  // 6. Query Leaderboard
  const lbRes = await req('/api/puzzles/leaderboard?tier=hard');
  assert.equal(lbRes.status, 200);
  assert.equal(lbRes.data.success, true);
  assert.ok(Array.isArray(lbRes.data.leaderboard));
});
