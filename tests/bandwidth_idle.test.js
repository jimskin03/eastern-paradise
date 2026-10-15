import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
import { initializeDatabase } from '../src/infrastructure/database/bootstrap.js';
import { createCloudStorage } from '../src/infrastructure/database/cloud/storage.js';
import { serveStaticFile } from '../src/http/helpers/static-files.js';
import { createWorldConnection } from '../src/public/js/world/connection.js';
import { startVisiblePolling } from '../src/public/js/api/visible-polling.js';
import { createLifecycle } from '../src/runtime/lifecycle.js';
import { createRequestHandler, shouldRecordActivity } from '../src/http/router.js';
import { sendJson } from '../src/http/helpers/response.js';

function createDatabase(t) {
  const db = new DatabaseSync(':memory:');
  initializeDatabase({ db, dbPath: ':memory:', configureCloud: () => null });
  db.exec('DELETE FROM _sync_changes');
  t.after(() => db.close());
  return db;
}

function insertLog(db, id) {
  db.prepare(`INSERT INTO puzzle_interaction_logs
    (id, agent_id, agent_name, puzzle_id, question, created_at)
    VALUES (?, 'resident_ailicia', 'A.Ilicia', 'test', 'Question?', 1)`).run(id);
}

test('unchanged puzzle logs produce no cloud traffic after their first sync', async t => {
  const db = createDatabase(t);
  const batches = [];
  const storage = createCloudStorage({ db, cloudClient: {
    async batch(statements) { batches.push(statements); }
  } });
  insertLog(db, 'first');
  assert.deepEqual(await storage.pushToCloud(), { synced: 1 });
  assert.equal(batches.length, 1);
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(await storage.pushToCloud(), { synced: 0 });
  }
  assert.equal(batches.length, 1, 'idle flushes must never re-enqueue historical logs');
  db.prepare("UPDATE puzzle_interaction_logs SET question = 'Updated' WHERE id = 'first'").run();
  assert.deepEqual(await storage.pushToCloud(), { synced: 1 });
  db.prepare("DELETE FROM puzzle_interaction_logs WHERE id = 'first'").run();
  assert.deepEqual(await storage.pushToCloud(), { synced: 1 });
  assert.match(batches.at(-1)[0].sql, /^DELETE/);
});

test('cloud flushes serialize, include newer mutations, and retry failed uploads', async t => {
  const db = createDatabase(t);
  let release;
  let calls = 0;
  const storage = createCloudStorage({ db, cloudClient: {
    async batch() {
      calls++;
      if (calls === 1) await new Promise(resolve => { release = resolve; });
      if (calls === 3) throw new Error('offline');
    }
  } });
  insertLog(db, 'first');
  const first = storage.pushToCloud();
  await Promise.resolve();
  insertLog(db, 'second');
  const second = storage.pushToCloud();
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await first, { synced: 1 });
  assert.deepEqual(await second, { synced: 1 });
  insertLog(db, 'third');
  await assert.rejects(storage.pushToCloud(), /offline/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM _sync_changes').get().count, 1);
  assert.deepEqual(await storage.pushToCloud(), { synced: 1 });
});

test('a backlog uploads each row once and drains beyond the old 500-change limit', async t => {
  const db = createDatabase(t);
  const batches = [];
  const storage = createCloudStorage({ db, cloudClient: {
    async batch(statements) { batches.push(statements); }
  } });
  insertLog(db, 'busy');
  for (let i = 0; i < 1200; i++) {
    db.prepare("UPDATE puzzle_interaction_logs SET question = ? WHERE id = 'busy'").run(`Question ${i}`);
  }
  for (let i = 0; i < 501; i++) insertLog(db, `other-${i}`);
  assert.deepEqual(await storage.pushToCloud(), { synced: 502 });
  assert.equal(batches.length, 6);
  assert.ok(batches.every(batch => batch.length <= 100));
  assert.equal(batches.flat().filter(stmt => stmt.args[0] === 'busy').length, 1);
  assert.ok(batches[0][0].args.includes('Question 1199'));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM _sync_changes').get().count, 0);
  assert.deepEqual(await storage.pushToCloud(), { synced: 0 });
  assert.equal(batches.length, 6);
});

test('partial sync failure retains failed batches and changes made during upload', async t => {
  const db = createDatabase(t);
  const batches = [];
  const storage = createCloudStorage({ db, cloudClient: {
    async batch(statements) {
      batches.push(statements);
      if (batches.length === 1) {
        db.prepare("UPDATE puzzle_interaction_logs SET question = 'Newer' WHERE id = 'log-0'").run();
      }
      if (batches.length === 2) throw new Error('offline');
    }
  } });
  for (let i = 0; i < 201; i++) insertLog(db, `log-${i}`);
  await assert.rejects(storage.pushToCloud(), /offline/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM _sync_changes').get().count, 102);
  assert.deepEqual(await storage.pushToCloud(), { synced: 102 });
  const retried = batches.slice(2).flat();
  assert.equal(retried.filter(stmt => stmt.args[0] === 'log-1').length, 0);
  assert.ok(retried.find(stmt => stmt.args[0] === 'log-0').args.includes('Newer'));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM _sync_changes').get().count, 0);
});

test('public polling cannot keep a world awake, but verified agent reads can wake it', async t => {
  let now = 1000;
  let scheduled;
  let ticks = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', callback => { scheduled = callback; return {}; });
  const lifecycle = createLifecycle({
    world: { activeAgents: new Map(), tickAmbientWandering() {} },
    residentManager: { tick() { ticks++; } }
  });
  const handler = createRequestHandler({
    services: {
      buildAgentCard: () => ({ name: 'Test' }),
      AuthService: { authenticate: req => req.headers.authorization === 'Bearer valid' ? { id: 'agent' } : null }
    },
    runtime: lifecycle,
    limits: { checkRateLimit: () => ({ limited: false }) },
    publicDir: '/tmp/nonexistent-eastern-paradise-public'
  });
  const request = async (authorization, url = '/api/agent-card') => {
    const response = {
      statusCode: 200,
      writeHead(status) { this.statusCode = status; this.headersSent = true; },
      end() { this.writableEnded = true; }
    };
    await handler({ url, method: 'GET', headers: { host: 'localhost', authorization } }, response);
    assert.equal(response.statusCode, 200);
  };
  lifecycle.start();
  for (let i = 0; i < 20; i++) {
    now += 3000;
    await request();
    if (lifecycle.getSimulationMetrics().nextTickScheduled) await scheduled();
  }
  assert.equal(lifecycle.getState(), 'IDLE');
  assert.equal(lifecycle.getLastActivityTime(), 1000);
  assert.equal(ticks, 9);
  assert.equal(lifecycle.getSimulationMetrics().nextTickScheduled, false);
  await request('Bearer invalid');
  assert.equal(lifecycle.getState(), 'IDLE');
  await request('Bearer valid', '/api/agent-card?key=never-log-this');
  assert.equal(lifecycle.getState(), 'ACTIVE');
  assert.equal(lifecycle.getLastActivitySource(), 'GET /api/agent-card');
  now += 3000;
  await scheduled();
  assert.equal(ticks, 10);
  assert.equal(lifecycle.getSimulationMetrics().lastDeltaMs, 3000);
});

test('participation wakes the world; health checks, admin backups and read-only probes do not', () => {
  const auth = { authenticate: () => ({ id: 'agent' }) };
  for (const path of ['/api/auth/guest', '/api/visitor/arrive', '/api/spectator/message']) {
    assert.equal(shouldRecordActivity(path, { method: 'POST' }, auth), true);
  }
  for (const path of ['/api/auth/guest', '/api/auth/verify']) {
    assert.equal(shouldRecordActivity(path, { method: 'GET' }, { authenticate: () => null }), true);
  }
  for (const path of ['/api/status', '/api/metrics', '/api/admin/snapshot', '/api/admin/wipe_logs']) {
    for (const method of ['GET', 'POST']) {
      assert.equal(shouldRecordActivity(path, { method }, auth), false);
    }
  }
  for (const path of ['/api/journal', '/api/discovery', '/api/map', '/api/world/dark-sanctuary']) {
    assert.equal(shouldRecordActivity(path, { method: 'GET' }, { authenticate: () => null }), false);
    assert.equal(shouldRecordActivity(path, { method: 'HEAD' }, auth), false);
    assert.equal(shouldRecordActivity(path, { method: 'GET' }, auth), true);
  }
});

test('JSON APIs negotiate gzip with exact content, CORS, opt-out and HEAD semantics', async t => {
  const data = { events: Array.from({ length: 100 }, (_, id) => ({ id, description: 'A resident walks through the sanctuary.' })) };
  const server = http.createServer((req, res) => sendJson(res, 200, data, { Vary: 'Origin' }));
  t.after(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const request = (headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/', headers, method }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
  const plain = await request();
  const gzip = await request({ 'Accept-Encoding': 'gzip' });
  assert.equal(gzip.status, 200);
  assert.equal(gzip.headers['content-encoding'], 'gzip');
  assert.equal(gzip.headers.vary, 'Origin, Accept-Encoding');
  assert.equal(gzip.headers['access-control-allow-origin'], '*');
  assert.deepEqual(gunzipSync(gzip.body), plain.body);
  assert.deepEqual(JSON.parse(plain.body), data);
  assert.ok(gzip.body.length < plain.body.length / 5);
  const refused = await request({ 'Accept-Encoding': 'gzip;q=0, *;q=1' });
  assert.equal(refused.headers['content-encoding'], undefined);
  assert.deepEqual(refused.body, plain.body);
  const head = await request({ 'Accept-Encoding': 'gzip' }, 'HEAD');
  assert.equal(head.headers['content-encoding'], 'gzip');
  assert.equal(head.body.length, 0);
});

test('static gzip preserves content, conditional caching, opt-out, and HEAD behavior', async t => {
  const publicDir = new URL('../src/public/', import.meta.url).pathname;
  const server = http.createServer((req, res) => {
    serveStaticFile({ pathname: '/js/world/websocket.js', req, res, publicDir });
  });
  t.after(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const request = (headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/', headers, method }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
  const plain = await request();
  const gzip = await request({ 'Accept-Encoding': 'gzip' });
  assert.equal(gzip.headers['content-encoding'], 'gzip');
  assert.equal(gzip.headers.vary, 'Accept-Encoding');
  assert.deepEqual(gunzipSync(gzip.body), plain.body);
  assert.ok(gzip.body.length < plain.body.length / 2);
  const cached = await request({ 'Accept-Encoding': 'gzip', 'If-None-Match': gzip.headers.etag });
  assert.equal(cached.status, 304);
  assert.equal(cached.body.length, 0);
  assert.equal(cached.headers.vary, 'Accept-Encoding');
  const refused = await request({ 'Accept-Encoding': 'gzip;q=0, *;q=1' });
  assert.equal(refused.headers['content-encoding'], undefined);
  assert.deepEqual(refused.body, plain.body);
  const head = await request({ 'Accept-Encoding': 'gzip' }, 'HEAD');
  assert.equal(head.headers['content-encoding'], 'gzip');
  assert.equal(head.body.length, 0);
});

class Page extends EventTarget {
  hidden = false;
  setHidden(hidden) {
    this.hidden = hidden;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

test('hidden tabs stop streaming and reconnect retries; visible tabs open exactly one fresh stream', t => {
  const timers = new Map();
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    const token = {};
    timers.set(token, { callback, delay });
    return token;
  });
  t.mock.method(globalThis, 'clearTimeout', token => timers.delete(token));
  const sockets = [];
  class Socket {
    constructor() { sockets.push(this); }
    close() { this.closed = true; this.onclose?.(); }
  }
  const page = new Page();
  const connection = createWorldConnection({ url: '/ws/world', page, Socket });
  connection.connect();
  assert.equal(sockets.length, 1);
  page.setHidden(true);
  assert.equal(sockets[0].closed, true);
  assert.equal(timers.size, 0);
  connection.connect();
  assert.equal(sockets.length, 1);
  page.setHidden(false);
  assert.equal(sockets.length, 2);
  sockets[1].onclose();
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].delay, 3000);
  page.setHidden(true);
  assert.equal(timers.size, 0);
  page.setHidden(false);
  assert.equal(sockets.length, 3);
  connection.dispose();
  page.setHidden(false);
  assert.equal(sockets.length, 3);
});

test('background polling skips hidden pages and refreshes immediately on return', t => {
  let poll;
  t.mock.method(globalThis, 'setInterval', callback => { poll = callback; return 1; });
  t.mock.method(globalThis, 'clearInterval', () => {});
  const page = new Page();
  let calls = 0;
  const stop = startVisiblePolling(() => calls++, 60_000, page);
  assert.equal(calls, 1);
  page.setHidden(true);
  poll();
  assert.equal(calls, 1);
  page.setHidden(false);
  assert.equal(calls, 2);
  stop();
  page.setHidden(false);
  assert.equal(calls, 2);
});

test('no visitors freezes simulation indefinitely and wake does not catch up sleep time', async t => {
  let now = 1000;
  let scheduled;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', callback => { scheduled = callback; return {}; });
  const deltas = [];
  let ambientTicks = 0;
  const lifecycle = createLifecycle({
    world: { activeAgents: new Map(), tickAmbientWandering() { ambientTicks++; } },
    residentManager: { tick({ deltaMs }) { deltas.push(deltaMs); } }
  });
  lifecycle.start();
  now += 30_001;
  await scheduled();
  assert.equal(lifecycle.getState(), 'IDLE');
  assert.equal(lifecycle.getSimulationMetrics().nextTickScheduled, false);
  now += 24 * 60 * 60 * 1000;
  assert.equal(await lifecycle.runSimulationTick(), false);
  assert.deepEqual(deltas, []);
  assert.equal(ambientTicks, 0);
  lifecycle.markActivity();
  now += 3000;
  await scheduled();
  assert.deepEqual(deltas, [3000]);
  assert.equal(ambientTicks, 1);
});
