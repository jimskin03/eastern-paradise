import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { world } from '../src/world.js';

test('Agent Experience & Ergonomics: Guest Access, Pathfinding, Map, and Remote Inspect', async (t) => {
  const TEST_PORT = 3048;
  const env = { ...process.env, PORT: String(TEST_PORT) };
  const srv = spawn('node', ['src/server.js'], { env, cwd: process.cwd() });

  await new Promise(res => setTimeout(res, 900));

  t.after(() => {
    srv.kill();
  });

  function req(path, options = {}, body = null) {
    return new Promise((resolve, reject) => {
      const request = http.request(`http://localhost:${TEST_PORT}${path}`, options, (res) => {
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

  // 1. Instructions & OpenAPI
  const instr = await req('/instructions');
  assert.equal(instr.status, 200);
  assert.match(instr.text, /POST \/api\/auth\/guest/);
  assert.match(instr.text, /POST \/api\/world\/move_to/);
  assert.match(instr.text, /trial_obelisk_wood/);
  assert.match(instr.text, /trial_obelisk_truth/);

  const openapi = await req('/openapi.json');
  assert.equal(openapi.status, 200);
  assert.equal(openapi.data.openapi, '3.0.0');
  assert.ok(openapi.data.paths['/api/world/move_to']);
  assert.ok(openapi.data.paths['/api/auth/me']);
  assert.ok(openapi.data.paths['/api/manifest']);

  // 2. Manifest, Map & Node Discovery
  const manifest = await req('/api/manifest');
  assert.equal(manifest.status, 200);
  assert.equal(manifest.data.sanctuary, 'Eastern Paradise');
  assert.equal(manifest.data.dimensions.width, 64);
  assert.equal(manifest.data.dimensions.height, 52);
  assert.ok(manifest.data.puzzle_obelisks.length >= 5);

  const mapRes = await req('/api/map');
  assert.equal(mapRes.status, 200);
  assert.ok(mapRes.data.zones.length >= 5);
  assert.ok(mapRes.data.nodes.length >= 10);

  const nodesRes = await req('/api/world/nodes?category=water');
  assert.equal(nodesRes.status, 200);
  assert.ok(nodesRes.data.nodes.some(n => n.id === 'trial_obelisk_water'));

  const quietNodes = await req('/api/world/nodes?zone=quiet_circle');
  assert.equal(quietNodes.status, 200);
  assert.ok(quietNodes.data.nodes.some(n => n.id === 'trial_obelisk_truth'));

  // 3. Instant Zero-Friction Guest Auth
  const guestRes = await req('/api/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { name: 'PathfinderAgent' });

  assert.equal(guestRes.status, 201);
  assert.ok(guestRes.data.api_key);
  const apiKey = guestRes.data.api_key;
  const agentId = guestRes.data.agent_id;

  // 4. Session Validation via /api/auth/me
  const meRes = await req('/api/auth/me', {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
  assert.equal(meRes.status, 200);
  assert.equal(meRes.data.success, true);
  assert.equal(meRes.data.agent.id, agentId);
  assert.equal(meRes.data.agent.is_guest, true);
  assert.deepEqual(meRes.data.agent.pos, [7, 8]);
  assert.equal(meRes.data.agent.zone_id, 'arrival');

  // 5. Remote Node Inspection from afar
  // Agent is at [7, 8], truth obelisk is at [45, 9] (distance ~38 tiles)
  const inspectTruth = await req('/api/world/interact', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    }
  }, { node_id: 'trial_obelisk_truth', action: 'inspect' });

  assert.equal(inspectTruth.status, 200);
  assert.equal(inspectTruth.data.locked, true);
  assert.ok(inspectTruth.data.requirement.required_solved >= 3);

  // But solving remotely must fail distance check
  const solveRemote = await req('/api/world/interact', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    }
  }, { node_id: 'trial_obelisk_truth', action: 'solve', payload: { answer: 'qualia' } });

  assert.equal(solveRemote.status, 400);
  assert.equal(solveRemote.data.success, false);
  assert.match(solveRemote.data.message, /Too far/);

  // 6. Server-Side Pathfinding via POST /api/world/move_to
  // Move agent from [7, 8] to [11, 26] (Water Obelisk)
  const moveToRes = await req('/api/world/move_to', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    }
  }, { target: [11, 26] });

  assert.equal(moveToRes.status, 200);
  assert.equal(moveToRes.data.success, true);
  assert.equal(moveToRes.data.moved, true);
  assert.ok(moveToRes.data.steps_taken > 0);
  assert.ok(moveToRes.data.path.length > 0);

  // Check new position is near or at [11, 26] in Grand Tea Pavilion
  assert.equal(moveToRes.data.zone_id, 'tea_pavilion');
  const distToWater = Math.hypot(moveToRes.data.pos[0] - 11, moveToRes.data.pos[1] - 26);
  assert.ok(distToWater <= 1.5, `Should be adjacent or on target tile, got distance ${distToWater}`);

  // 7. Movement Collision Semantics
  // Move into water/wall returns HTTP 200 with moved: false and reason: path_obstructed
  const obstMove = await req('/api/world/move', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    }
  }, { direction: 'invalid_dir' });

  assert.equal(obstMove.status, 200);
  assert.equal(obstMove.data.moved, false);
  assert.equal(obstMove.data.reason, 'invalid_direction');

  // Also test path_obstructed specifically on a blocked tile
  let blockedDir = null;
  const currPos = moveToRes.data.pos;
  if (!world.isWalkable(currPos[0], currPos[1] - 1)) blockedDir = 'north';
  else if (!world.isWalkable(currPos[0], currPos[1] + 1)) blockedDir = 'south';
  else if (!world.isWalkable(currPos[0] + 1, currPos[1])) blockedDir = 'east';
  else if (!world.isWalkable(currPos[0] - 1, currPos[1])) blockedDir = 'west';

  if (blockedDir) {
    const obstCollision = await req('/api/world/move', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    }, { direction: blockedDir });
    assert.equal(obstCollision.status, 200);
    assert.equal(obstCollision.data.moved, false);
    assert.equal(obstCollision.data.reason, 'path_obstructed');
    assert.ok(obstCollision.data.pos);
  }

  // 8. Ambient Wandering does NOT drift real visitor/guest agents
  const guestAgentInWorld = world.spawnOrGetAgent({
    id: 'test_wander_visitor',
    name: 'SteadfastMind',
    is_guest: 0
  });
  guestAgentInWorld.pos = [7, 8];
  guestAgentInWorld.last_active = Date.now() - 10000; // 10s idle
  world.tickAmbientWandering();
  assert.deepEqual(guestAgentInWorld.pos, [7, 8], 'Active agent coordinates must not drift during idle latency');

  // 9. Rate Limiting with Retry-After header
  const burstToken = 'ep_burst_' + Date.now();
  let hitRateLimit = false;
  for (let i = 0; i < 125; i++) {
    const burstRes = await req('/api/map', {
      headers: { 'Authorization': `Bearer ${burstToken}` }
    });
    if (burstRes.status === 429) {
      hitRateLimit = true;
      assert.ok(burstRes.headers['retry-after']);
      assert.equal(burstRes.data.error, 'rate_limit_exceeded');
      assert.ok(burstRes.data.retry_after >= 1);
      break;
    }
  }
  assert.equal(hitRateLimit, true, 'Rate limiter must trigger on burst and supply Retry-After');
});
