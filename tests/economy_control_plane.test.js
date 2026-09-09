import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { db } from '../src/db.js';
import { AuthService } from '../src/auth.js';
import { EconomyManager } from '../src/economy.js';
import { handleEconomyRoutes } from '../src/http/routes/economy.routes.js';
import {
  resolveRoles,
  hasCapability,
  resetActionRateLimits,
  privacyHash
} from '../src/economy-control.js';

function registerVerified(name, email) {
  const reg = AuthService.register({ name, email });
  AuthService.verifyToken(reg.verification_token);
  return db.prepare('SELECT * FROM accounts WHERE name = ?').get(name);
}

function startServer() {
  const world = { broadcast() {}, activeAgents: new Map() };
  const Treasury = { async getReserve() { return { network: 'devnet' }; } };
  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, 'http://127.0.0.1');
    const handled = await handleEconomyRoutes({
      req,
      res,
      pathname: parsedUrl.pathname,
      parsedUrl,
      services: { AuthService, EconomyManager, Treasury, world }
    });
    if (!handled && !res.writableEnded) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'not found' }));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function request(server, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const req = http.request({
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, headers: res.headers, data: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

test('deny-by-default roles only grant player capabilities', () => {
  const roles = resolveRoles({ id: 'agent_x', name: 'Seeker' }, {});
  assert.deepEqual(roles, ['player']);
  assert.equal(hasCapability(roles, 'spend'), true);
  assert.equal(hasCapability(roles, 'transfer'), true);
  assert.equal(hasCapability(roles, 'wallet'), true);
  assert.equal(hasCapability(roles, 'mint'), false);
  assert.equal(hasCapability(roles, 'burn'), false);
  assert.equal(hasCapability(roles, 'reconciliation'), false);
  const operator = resolveRoles({ id: 'agent_x', name: 'Seeker' }, { TREASURY_OPERATOR_AGENT_IDS: 'agent_x' });
  assert.equal(hasCapability(operator, 'mint'), true);
  assert.equal(hasCapability(operator, 'spend'), true);
});

test('2T-2 ledger auth, pagination, idempotency, rate-limit, audit, and write denial', async (t) => {
  resetActionRateLimits();
  const stamp = Date.now().toString().slice(-6);
  const a = registerVerified(`CtrlA_${stamp}`, `ctrla_${stamp}@example.com`);
  const b = registerVerified(`CtrlB_${stamp}`, `ctrlb_${stamp}@example.com`);
  EconomyManager.mintPuzzleReward(a.id, 40, 'trial_obelisk_wood', 'pz_ctrl');

  const server = await startServer();
  t.after(() => server.close());

  const unauth = await request(server, `/api/economy/balance?agent_id=${a.id}`);
  assert.equal(unauth.status, 401);

  const foreign = await request(server, `/api/economy/balance?agent_id=${b.id}`, {
    headers: { Authorization: `Bearer ${a.api_key}` }
  });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.data.error_code, 'FORBIDDEN');

  const own = await request(server, '/api/economy/balance', {
    headers: { Authorization: `Bearer ${a.api_key}` }
  });
  assert.equal(own.status, 200);
  assert.equal(own.data.success, true);
  assert.equal(own.data.agent_id, a.id);
  assert.ok(own.data.merit_balance >= 40);

  const page1 = await request(server, '/api/economy/transactions?limit=1', {
    headers: { Authorization: `Bearer ${a.api_key}` }
  });
  assert.equal(page1.status, 200);
  assert.equal(page1.data.transactions.length, 1);
  assert.ok(page1.data.transactions[0].id);
  assert.ok(page1.data.next_cursor);
  const page2 = await request(server, `/api/economy/transactions?limit=1&cursor=${encodeURIComponent(page1.data.next_cursor)}`, {
    headers: { Authorization: `Bearer ${a.api_key}` }
  });
  assert.equal(page2.status, 200);
  assert.ok(page2.data.transactions[0].id !== page1.data.transactions[0].id);

  const mintDenied = await request(server, '/api/economy/mint', {
    method: 'POST',
    headers: { Authorization: `Bearer ${a.api_key}` },
    body: { amount: 1 }
  });
  assert.equal(mintDenied.status, 403);
  assert.equal(mintDenied.data.error_code, 'FORBIDDEN');

  const prev = process.env.TREASURY_OPERATOR_AGENT_IDS;
  process.env.TREASURY_OPERATOR_AGENT_IDS = a.id;
  const mintDisabled = await request(server, '/api/economy/mint', {
    method: 'POST',
    headers: { Authorization: `Bearer ${a.api_key}` },
    body: { amount: 1 }
  });
  if (prev === undefined) delete process.env.TREASURY_OPERATOR_AGENT_IDS;
  else process.env.TREASURY_OPERATOR_AGENT_IDS = prev;
  assert.equal(mintDisabled.status, 403);
  assert.equal(mintDisabled.data.error_code, 'TREASURY_WRITES_DISABLED');

  const key = `idem_${stamp}`;
  const first = await request(server, '/api/economy/transfer', {
    method: 'POST',
    headers: { Authorization: `Bearer ${a.api_key}`, 'Idempotency-Key': key },
    body: { recipient_id: b.id, amount: 3, memo: 'ctrl' }
  });
  assert.equal(first.status, 200);
  assert.equal(first.data.success, true);
  const txId = first.data.tx_id;
  const replay = await request(server, '/api/economy/transfer', {
    method: 'POST',
    headers: { Authorization: `Bearer ${a.api_key}`, 'Idempotency-Key': key },
    body: { recipient_id: b.id, amount: 3, memo: 'ctrl' }
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.data.tx_id, txId);
  const balB = EconomyManager.getBalance(b.id);
  assert.equal(balB.merit_balance, 3);

  resetActionRateLimits();
  let limited = null;
  for (let i = 0; i < 12; i++) {
    const res = await request(server, '/api/economy/transfer', {
      method: 'POST',
      headers: { Authorization: `Bearer ${a.api_key}` },
      body: { recipient_id: b.id, amount: 1, memo: `rl${i}` }
    });
    if (res.status === 429) {
      limited = res;
      break;
    }
  }
  assert.ok(limited);
  assert.equal(limited.status, 429);
  assert.ok(limited.headers['retry-after']);

  const audit = db.prepare('SELECT * FROM economy_audit WHERE actor_id = ? ORDER BY created_at DESC').all(a.id);
  assert.ok(audit.length >= 1);
  const blob = JSON.stringify(audit);
  assert.equal(blob.includes(a.api_key), false);
  assert.ok(audit.every((row) => row.actor_hash === privacyHash(a.id)));
  assert.ok(audit.every((row) => !String(row.request_meta).includes(a.api_key)));
});
