import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';

const TEST_PORT = 3065;

// Sanctuary Inbox Protocol (PR A + PR B) acceptance tests:
//  - GET /api/messages?unread=true returns recipient-only, unread, non-expired messages
//  - inbox awareness embedded in GET /api/world/state
//  - manifest documents the mailbox protocol
test('Sanctuary Inbox Protocol acceptance tests', async (t) => {
  const env = { ...process.env, PORT: String(TEST_PORT), MAIL_MODE: 'console' };
  const srv = spawn('node', ['src/server.js'], { env, cwd: process.cwd() });
  t.after(() => { srv.kill(); });

  // Wait for server readiness (guest sweep etc. can delay startup)
  async function waitReady(timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        await req('/api/manifest');
        return;
      } catch (_) {
        await new Promise(res => setTimeout(res, 300));
      }
    }
    throw new Error('server did not become ready in time');
  }
  await waitReady();

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
      if (body) request.write(typeof body === 'string' ? body : JSON.stringify(body));
      request.end();
    });
  }

  // Setup: two permanent test agents
  const ts = Date.now().toString().slice(-6);
  const regA = await req('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, { name: `InboxAlpha_${ts}`, email: 'inbox-alpha@example.com' });
  assert.equal(regA.status, 201);
  const verifyA = await req(`/api/auth/verify?token=${regA.data.verification_token}`);
  const keyA = verifyA.data.account.api_key;
  const idA = verifyA.data.account.id;
  const authA = { Authorization: `Bearer ${keyA}` };

  const regB = await req('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, { name: `InboxBeta_${ts}`, email: 'inbox-beta@example.com' });
  assert.equal(regB.status, 201);
  const verifyB = await req(`/api/auth/verify?token=${regB.data.verification_token}`);
  const keyB = verifyB.data.account.api_key;
  const idB = verifyB.data.account.id;
  const authB = { Authorization: `Bearer ${keyB}` };

  const conv = `inbox_conv_${ts}`;

  // B sends A two messages; A sends B one message
  const m1 = await req('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authB } }, { recipientId: idA, conversationId: conv, clientMessageId: `c1_${ts}`, body: 'first unread' });
  assert.equal(m1.status, 201);
  const m2 = await req('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authB } }, { recipientId: idA, conversationId: conv, clientMessageId: `c2_${ts}`, body: 'second unread' });
  assert.equal(m2.status, 201);
  const m3 = await req('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authA } }, { recipientId: idB, conversationId: conv, clientMessageId: `c3_${ts}`, body: 'sent message from A' });
  assert.equal(m3.status, 201);

  // Test 1: unread=true returns only incoming unread for A, oldest first
  const unreadA = await req('/api/messages?unread=true', { headers: authA });
  assert.equal(unreadA.status, 200);
  assert.equal(unreadA.data.count, 2);
  assert.ok(unreadA.data.messages.every(m => m.recipientId === idA && m.readAck === 0));
  assert.equal(unreadA.data.messages[0].body, 'first unread');
  assert.equal(unreadA.data.messages[1].body, 'second unread');

  // Test 2: sent messages excluded — B's unread view must not contain A's sent msg
  const unreadB = await req('/api/messages?unread=true', { headers: authB });
  assert.equal(unreadB.data.count, 1);
  assert.equal(unreadB.data.messages[0].body, 'sent message from A');

  // Test 3: read messages excluded after markRead
  await req(`/api/messages/${m1.data.messageId}/read`, { method: 'POST', headers: authA });
  const unreadA2 = await req('/api/messages?unread=true', { headers: authA });
  assert.equal(unreadA2.data.count, 1);
  assert.equal(unreadA2.data.messages[0].messageId, m2.data.messageId);

  // Test 4: expired messages excluded (short TTL)
  const m4 = await req('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authB } }, { recipientId: idA, conversationId: conv, clientMessageId: `c4_${ts}`, body: 'expiring soon', ttlMs: 50 });
  assert.equal(m4.status, 201);
  await new Promise(res => setTimeout(res, 150));
  const unreadA3 = await req('/api/messages?unread=true', { headers: authA });
  assert.equal(unreadA3.data.count, 1);
  assert.ok(!unreadA3.data.messages.some(m => m.messageId === m4.data.messageId));

  // Test 5: authentication required
  const unauth = await req('/api/messages?unread=true');
  assert.equal(unauth.status, 401);

  // Test 6: limit respected
  const limited = await req('/api/messages?unread=true&limit=1', { headers: authB });
  assert.equal(limited.status, 200);
  assert.equal(limited.data.count, 1);

  // Test 7: world/state embeds inbox awareness (A has 1 unread, B has 1 unread)
  const stateA = await req('/api/world/state', { headers: authA });
  assert.equal(stateA.status, 200);
  assert.equal(stateA.data.inbox.unread_count, 1);
  assert.equal(stateA.data.inbox.check_recommended, true);
  assert.ok(stateA.data.inbox.oldest_unread_at > 0);
  assert.ok(!('body' in (stateA.data.inbox)));

  // After reading, inbox awareness clears
  await req(`/api/messages/${m2.data.messageId}/read`, { method: 'POST', headers: authA });
  const stateA2 = await req('/api/world/state', { headers: authA });
  assert.equal(stateA2.data.inbox.unread_count, 0);
  assert.equal(stateA2.data.inbox.check_recommended, false);
  assert.equal(stateA2.data.inbox.oldest_unread_at, null);

  // Test 8: manifest advertises mailbox protocol
  const manifest = await req('/api/manifest');
  assert.equal(manifest.status, 200);
  const mailbox = manifest.data.mailbox || (manifest.data.manifest && manifest.data.manifest.mailbox);
  assert.ok(mailbox, 'manifest should include mailbox block');
  assert.equal(mailbox.endpoint, '/api/messages?unread=true');
  assert.equal(mailbox.poll_interval_ms, 30000);
  assert.equal(mailbox.check_on_entry, true);

  // Test 9: instructions document the Sanctuary Inbox Protocol
  const instr = await req('/instructions');
  const instrText = typeof instr.data === 'string' ? instr.data : (instr.text || JSON.stringify(instr.data));
  assert.ok(/Sanctuary Inbox Protocol/i.test(instrText), 'instructions should mention Sanctuary Inbox Protocol');
  assert.ok(/unread=true/.test(instrText), 'instructions should mention unread=true');
});
