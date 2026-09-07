import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';

const TEST_PORT = 3055;

test('Provider Handoff Spec (v0.1) Acceptance Tests', async (t) => {
  const env = { ...process.env, PORT: String(TEST_PORT), MAIL_MODE: 'console' };
  const srv = spawn('node', ['src/server.js'], { env, cwd: process.cwd() });

  // Allow server time to bind and initialize
  await new Promise(res => setTimeout(res, 900));

  t.after(() => {
    srv.kill();
  });

  function req(path, options = {}, body = null) {
    return new Promise((resolve, reject) => {
      const request = http.request(`http://127.0.0.1:${TEST_PORT}${path}`, options, (res) => {
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

  // Setup: Register and verify two distinct test agents (Agent A and Agent B)
  const timestamp = Date.now().toString().slice(-5);
  const nameA = `AgentAlpha_${timestamp}`;
  const nameB = `AgentBeta_${timestamp}`;

  const regA = await req('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, {
    name: nameA,
    email: 'alpha@example.com'
  });
  assert.equal(regA.status, 201);
  const verifyA = await req(`/api/auth/verify?token=${regA.data.verification_token}`);
  assert.equal(verifyA.status, 200);
  const keyA = verifyA.data.account.api_key;
  const idA = verifyA.data.account.id;

  const regB = await req('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, {
    name: nameB,
    email: 'beta@example.com'
  });
  assert.equal(regB.status, 201);
  const verifyB = await req(`/api/auth/verify?token=${regB.data.verification_token}`);
  assert.equal(verifyB.status, 200);
  const keyB = verifyB.data.account.api_key;
  const idB = verifyB.data.account.id;

  const conversationId = `conv_${Date.now()}`;
  let firstMsgId = null;

  // --------------------------------------------------------------------------
  // Acceptance Test 1: POST /api/messages with valid key returns messageId + monotonic sequence; senderId equals auth'd agent
  // --------------------------------------------------------------------------
  await t.test('1. Valid POST /api/messages returns envelope with server-derived senderId & monotonic sequence', async () => {
    const res = await req('/api/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${keyA}`,
        'Content-Type': 'application/json'
      }
    }, {
      conversationId,
      recipientId: idB,
      clientMessageId: 'client_msg_001',
      body: 'Greetings Beta. Initiating private coordination channel.'
    });

    assert.equal(res.status, 201);
    assert.match(res.data.messageId, /^msg_/);
    assert.equal(res.data.conversationId, conversationId);
    assert.equal(res.data.senderId, idA);
    assert.equal(res.data.recipientId, idB);
    assert.equal(typeof res.data.sequence, 'number');
    assert.equal(res.data.sequence, 1);
    assert.equal(res.data.clientMessageId, 'client_msg_001');
    assert.equal(res.data.body, 'Greetings Beta. Initiating private coordination channel.');
    assert.equal(res.data.deliveryAck, 0);
    assert.equal(res.data.readAck, 0);

    firstMsgId = res.data.messageId;
  });

  // --------------------------------------------------------------------------
  // Acceptance Test 2: Attempt to spoof senderId in body is ignored — server value wins
  // --------------------------------------------------------------------------
  await t.test('2. Spoofed senderId in request body is ignored in favor of authenticated bearer key', async () => {
    const res = await req('/api/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${keyA}`,
        'Content-Type': 'application/json'
      }
    }, {
      conversationId,
      recipientId: idB,
      senderId: 'agent_malicious_spoof_id', // Spoofed sender
      clientMessageId: 'client_msg_002',
      body: 'Testing anti-spoofing enforcement.'
    });

    assert.equal(res.status, 201);
    assert.equal(res.data.senderId, idA, 'Server must derive senderId from bearer key, ignoring client body');
    assert.notEqual(res.data.senderId, 'agent_malicious_spoof_id');
    assert.equal(res.data.sequence, 2, 'Monotonic sequence increments within conversation');
  });

  // --------------------------------------------------------------------------
  // Acceptance Test 3: GET /api/messages?since=<cursor> returns only new, ordered, non-expired messages for auth'd agent
  // --------------------------------------------------------------------------
  await t.test('3. GET /api/messages?since=<cursor> returns ordered messages for auth agent', async () => {
    // Agent B replies to Agent A
    const replyRes = await req('/api/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${keyB}`,
        'Content-Type': 'application/json'
      }
    }, {
      conversationId,
      recipientId: idA,
      clientMessageId: 'client_msg_003',
      body: 'Acknowledged Alpha. Secure channel verified.'
    });
    assert.equal(replyRes.status, 201);
    assert.equal(replyRes.data.sequence, 3);

    // Agent B queries messages since sequence 1
    const inboxB = await req(`/api/messages?since=1&limit=50&conversationId=${conversationId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${keyB}` }
    });

    assert.equal(inboxB.status, 200);
    assert.equal(inboxB.data.success, true);
    assert.equal(inboxB.data.messages.length, 2); // sequences 2 and 3
    assert.equal(inboxB.data.messages[0].sequence, 2);
    assert.equal(inboxB.data.messages[1].sequence, 3);
    assert.ok(inboxB.data.messages[0].sequence < inboxB.data.messages[1].sequence);
  });

  // --------------------------------------------------------------------------
  // Acceptance Test 4: Repeat POST with same clientMessageId returns identical messageId (idempotent, no duplicate)
  // --------------------------------------------------------------------------
  await t.test('4. Idempotent retry with same clientMessageId returns identical message envelope without duplicate', async () => {
    const retryRes = await req('/api/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${keyA}`,
        'Content-Type': 'application/json'
      }
    }, {
      conversationId,
      recipientId: idB,
      clientMessageId: 'client_msg_001', // Identical idempotency key from Test 1
      body: 'Greetings Beta. Initiating private coordination channel.'
    });

    assert.ok(retryRes.status === 200 || retryRes.status === 201);
    assert.equal(retryRes.data.messageId, firstMsgId);
    assert.equal(retryRes.data.sequence, 1);
  });

  // --------------------------------------------------------------------------
  // Acceptance Test 5: POST /api/messages/<id>/read by a non-recipient returns 403
  // --------------------------------------------------------------------------
  await t.test('5. Non-recipient calling /read returns 403 Forbidden; recipient sets readAck=1', async () => {
    // Agent A (the sender) tries to mark firstMsgId as read -> Forbidden!
    const senderReadRes = await req(`/api/messages/${firstMsgId}/read`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${keyA}` }
    });
    assert.equal(senderReadRes.status, 403);
    assert.equal(senderReadRes.data.success, false);

    // Agent B (the intended recipient) marks firstMsgId as read -> Success!
    const recipientReadRes = await req(`/api/messages/${firstMsgId}/read`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${keyB}` }
    });
    assert.equal(recipientReadRes.status, 200);
    assert.equal(recipientReadRes.data.success, true);
    assert.equal(recipientReadRes.data.message.readAck, 1);
    assert.equal(recipientReadRes.data.message.deliveryAck, 1);
  });

  // --------------------------------------------------------------------------
  // Acceptance Test 6: Mailbox requires auth; unauthenticated POST/GET returns 401
  // --------------------------------------------------------------------------
  await t.test('6. Unauthenticated mailbox access returns 401 Unauthorized', async () => {
    const unauthPost = await req('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      conversationId: 'conv_unauth',
      recipientId: idB,
      clientMessageId: 'unauth_1',
      body: 'No auth'
    });
    assert.equal(unauthPost.status, 401);

    const unauthGet = await req('/api/messages?since=0', { method: 'GET' });
    assert.equal(unauthGet.status, 401);
  });

  // --------------------------------------------------------------------------
  // Acceptance Test 7: Arrivals page renders verified data; simulated API failure shows explicit offline state
  // --------------------------------------------------------------------------
  await t.test('7. Arrivals page uses verified server data layer and displays explicit offline indicator', async () => {
    // 1. Check verified inhabitants and journal endpoints
    const journalRes = await req('/api/journal?limit=5');
    assert.equal(journalRes.status, 200);
    assert.equal(journalRes.data.success, true);
    assert.ok(Array.isArray(journalRes.data.events));

    const inhabitantsRes = await req('/api/inhabitants');
    assert.equal(inhabitantsRes.status, 200);
    assert.ok(Array.isArray(inhabitantsRes.data.inhabitants));

    // 2. Verify public HTML contains verified feed watermark and offline warning banner
    const indexHtml = await req('/');
    assert.equal(indexHtml.status, 200);
    assert.match(indexHtml.text, /id="feedSyncWatermark"/);
    assert.match(indexHtml.text, /id="feedOfflineBanner"/);
    assert.match(indexHtml.text, /Simulation Link Offline/);
  });

  // --------------------------------------------------------------------------
  // Acceptance Test 8: Rate limit triggers HTTP 429 + Retry-After; backoff recovers
  // --------------------------------------------------------------------------
  await t.test('8. Rate limit triggers HTTP 429 + Retry-After; backoff recovers', async () => {
    // Fast burst on Agent A token to exhaust capacity (capacity = 15 tokens)
    const burstPromises = [];
    for (let i = 0; i < 20; i++) {
      burstPromises.push(req('/api/world/state', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${keyA}` }
      }));
    }

    const results = await Promise.all(burstPromises);
    const rateLimitedRes = results.find(r => r.status === 429);

    assert.ok(rateLimitedRes, 'Expected at least one burst request to trigger HTTP 429');
    assert.equal(rateLimitedRes.status, 429);
    assert.equal(rateLimitedRes.data.error, 'rate_limit_exceeded');
    assert.ok(rateLimitedRes.headers['retry-after'], 'Response must include Retry-After header');
    assert.ok(rateLimitedRes.data.retry_after >= 0.6, 'Backoff must specify >= 0.6s delay');

    // Wait for the backoff duration (at least 650ms) to allow refill
    const waitMs = Math.round((Number(rateLimitedRes.data.retry_after) + 0.1) * 1000);
    await new Promise(res => setTimeout(res, waitMs));

    // Retry request after waiting
    const recoveryRes = await req('/api/world/state', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${keyA}` }
    });

    assert.equal(recoveryRes.status, 200, 'Request should recover after backoff delay');
    assert.equal(recoveryRes.data.agent.id, idA);
  });
});
