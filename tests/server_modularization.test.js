import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { createLifecycle } from '../src/runtime/lifecycle.js';
import { handleAdminRoutes } from '../src/http/routes/admin.routes.js';

test('Lifecycle preserves idle, spectator-aware tick, wake, and status-broadcast behavior', t => {
  const originalNow = Date.now;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let now = 1_000;
  const intervalCallbacks = [];
  const cleared = [];

  Date.now = () => now;
  globalThis.setInterval = (callback, delay) => {
    assert.equal(delay, 3_000);
    const token = { callback, delay };
    intervalCallbacks.push(token);
    return token;
  };
  globalThis.clearInterval = token => cleared.push(token);
  t.after(() => {
    Date.now = originalNow;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  });

  const calls = { residentTicks: 0, ambientTicks: 0, removed: [], broadcasts: 0 };
  const world = {
    activeAgents: new Map([
      ['resident', { is_resident: true, last_active: 0 }],
      ['visitor', { is_resident: false, last_active: 0 }]
    ]),
    tickAmbientWandering() { calls.ambientTicks += 1; },
    removeAgent(id) { calls.removed.push(id); }
  };
  const residentManager = { tick() { calls.residentTicks += 1; } };
  let spectatorCount = 0;
  const lifecycle = createLifecycle({ world, residentManager });
  lifecycle.setRealtimeGateway({
    getClientCount: () => spectatorCount,
    broadcastServerStatus: () => { calls.broadcasts += 1; }
  });

  assert.equal(lifecycle.getState(), 'ACTIVE');
  assert.equal(lifecycle.getIdleTimeoutMs(), 30_000);
  lifecycle.start();
  assert.equal(intervalCallbacks.length, 1);

  now += 10 * 60 * 1_000 + 1;
  intervalCallbacks[0].callback();
  assert.equal(lifecycle.getState(), 'IDLE');
  assert.deepEqual(cleared, [intervalCallbacks[0]]);
  assert.equal(calls.residentTicks, 0);

  lifecycle.markActivity();
  assert.equal(lifecycle.getState(), 'ACTIVE');
  assert.equal(calls.broadcasts, 1);
  assert.equal(intervalCallbacks.length, 2);

  spectatorCount = 1;
  now += 30_001;
  intervalCallbacks[1].callback();
  assert.equal(lifecycle.getState(), 'ACTIVE');
  assert.equal(calls.residentTicks, 1);
  assert.equal(calls.ambientTicks, 1);
  assert.deepEqual(calls.removed, ['visitor']);
});

test('Admin routes preserve disabled endpoint guards', async t => {
  const previousToken = process.env.SNAPSHOT_TOKEN;
  delete process.env.SNAPSHOT_TOKEN;
  t.after(() => {
    if (previousToken === undefined) delete process.env.SNAPSHOT_TOKEN;
    else process.env.SNAPSHOT_TOKEN = previousToken;
  });

  function createResponse() {
    return {
      statusCode: null,
      data: null,
      writeHead(statusCode) { this.statusCode = statusCode; },
      end(body) { this.data = JSON.parse(body); }
    };
  }

  const snapshotResponse = createResponse();
  await handleAdminRoutes({
    req: { method: 'GET', headers: {} },
    res: snapshotResponse,
    pathname: '/api/admin/snapshot',
    services: {},
    runtime: {}
  });
  assert.equal(snapshotResponse.statusCode, 403);
  assert.equal(snapshotResponse.data.message, 'Snapshot endpoint disabled (SNAPSHOT_TOKEN not configured).');

  const wipeResponse = createResponse();
  await handleAdminRoutes({
    req: { method: 'POST', headers: {} },
    res: wipeResponse,
    pathname: '/api/admin/wipe_logs',
    services: {},
    runtime: {}
  });
  assert.equal(wipeResponse.statusCode, 403);
  assert.equal(wipeResponse.data.message, 'Endpoint disabled (SNAPSHOT_TOKEN not configured).');
});

test('WebSocket /ws/world preserves init, ping/pong, world events, and disconnect cleanup', async t => {
  const port = 3099;
  const env = { ...process.env, PORT: String(port), SNAPSHOT_TOKEN: 'modularization-secret' };
  const serverProcess = spawn('node', ['src/server.js'], { env, cwd: process.cwd() });
  let stderr = '';
  serverProcess.stderr.on('data', chunk => { stderr += chunk; });

  t.after(async () => {
    if (serverProcess.exitCode !== null || serverProcess.signalCode !== null) return;
    const exited = once(serverProcess, 'exit');
    serverProcess.kill();
    await exited;
  });

  async function request(pathname, options = {}, body = null) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        return await new Promise((resolve, reject) => {
          const req = http.request(`http://localhost:${port}${pathname}`, options, res => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
              try {
                resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(data) });
              } catch (_) {
                resolve({ status: res.statusCode, headers: res.headers, text: data });
              }
            });
          });
          req.on('error', reject);
          if (body) req.write(JSON.stringify(body));
          req.end();
        });
      } catch (err) {
        if (attempt === 9) throw new Error(`${err.message}\n${stderr}`);
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }
  }

  await request('/api/status');

  const instructions = await request('/api/instructions', { headers: { Accept: 'application/json' } });
  assert.equal(instructions.status, 200);
  assert.equal(instructions.data.title, 'Eastern Paradise Agent Instructions');
  assert.match(instructions.data.markdown, /Eastern Paradise/);

  const prompts = await request('/api/protocol/prompts');
  assert.equal(prompts.status, 200);
  assert.equal(prompts.data.success, true);

  for (const pathname of ['/', '/style.css', '/styles/base.css', '/js/app.js', '/verify']) {
    const staticResponse = await request(pathname);
    assert.equal(staticResponse.status, 200, pathname);
    assert.ok(staticResponse.text.length > 0, pathname);
  }
  const missing = await request('/definitely-not-present');
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.data, { error: 'Not Found', path: '/definitely-not-present' });

  const transferUnauthorized = await request('/api/economy/transfer', { method: 'POST' }, {});
  assert.equal(transferUnauthorized.status, 401);
  const spendUnauthorized = await request('/api/economy/spend', { method: 'POST' }, {});
  assert.equal(spendUnauthorized.status, 401);

  const snapshotBadToken = await request('/api/admin/snapshot');
  assert.equal(snapshotBadToken.status, 401);
  assert.equal(snapshotBadToken.data.message, 'Invalid snapshot token.');
  const wipeBadToken = await request('/api/admin/wipe_logs', { method: 'POST' });
  assert.equal(wipeBadToken.status, 401);
  assert.equal(wipeBadToken.data.message, 'Invalid admin token.');

  const ws = new WebSocket(`ws://localhost:${port}/ws/world`);
  const queued = [];
  const waiters = [];
  ws.on('message', data => {
    const message = JSON.parse(data.toString());
    const waiterIndex = waiters.findIndex(waiter => waiter.predicate(message));
    if (waiterIndex >= 0) {
      const [waiter] = waiters.splice(waiterIndex, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else {
      queued.push(message);
    }
  });

  function nextMessage(predicate) {
    const index = queued.findIndex(predicate);
    if (index >= 0) return Promise.resolve(queued.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timer: null };
      waiter.timer = setTimeout(() => {
        const waiterIndex = waiters.indexOf(waiter);
        if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
        reject(new Error(`Timed out waiting for WebSocket message. stderr: ${stderr}`));
      }, 3_000);
      waiters.push(waiter);
    });
  }

  await once(ws, 'open');
  const init = await nextMessage(message => message.type === 'init_world');
  assert.ok(Array.isArray(init.data.agents));
  assert.ok(Array.isArray(init.data.zones));
  assert.equal(init.server_state, 'ACTIVE');
  assert.ok(Array.isArray(init.recent_logs));

  const connectedStatus = await request('/api/status');
  assert.equal(connectedStatus.data.connected_spectators_count, 1);

  const pongPromise = nextMessage(message => message.type === 'pong');
  ws.send(JSON.stringify({ type: 'ping' }));
  const pong = await pongPromise;
  assert.equal(typeof pong.timestamp, 'number');

  const spawnedPromise = nextMessage(message => message.type === 'agent_spawned');
  const guest = await request('/api/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { name: `WsParity_${Date.now()}` });
  assert.equal(guest.status, 201);
  const spawned = await spawnedPromise;
  assert.equal(spawned.agent.id, guest.data.agent_id);

  const closed = once(ws, 'close');
  ws.close();
  await closed;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const status = await request('/api/status');
    if (status.data.connected_spectators_count === 0) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail('WebSocket disconnect did not remove the spectator client');
});
