import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { db } from '../src/db.js';
import { AuthService } from '../src/auth.js';
import { eventLedger } from '../src/events.js';
import { BoardService } from '../src/board.js';

test('Priority 6: Usage Limits, Session Expiry, Pagination & Structured Errors', async (t) => {
  // Start server on dedicated test port 3066
  const env = { ...process.env, PORT: '3066' };
  const srv = spawn('node', ['src/server.js'], { env, cwd: process.cwd() });

  // Wait 800ms for server to boot
  await new Promise(res => setTimeout(res, 800));

  t.after(() => {
    srv.kill();
  });

  function req(path, options = {}, body = null) {
    return new Promise((resolve, reject) => {
      const request = http.request(`http://localhost:3066${path}`, options, (res) => {
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

  // =========================================================================
  // 1. Session Expiry Exposure in /api/auth/guest and /api/auth/me
  // =========================================================================
  await t.test('Guest account exposes session_type, session_expires_at, session_ttl_seconds', async () => {
    const guestRes = await req('/api/auth/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { name: 'ExpiryPilot' });

    assert.equal(guestRes.status, 201);
    assert.equal(guestRes.data.session_type, 'guest');
    assert.ok(guestRes.data.session_expires_at > Date.now());
    assert.ok(guestRes.data.session_ttl_seconds > 0);
    assert.equal(guestRes.data.agent.session_type, 'guest');

    const meRes = await req('/api/auth/me', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${guestRes.data.api_key}` }
    });

    assert.equal(meRes.status, 200);
    assert.equal(meRes.data.session_type, 'guest');
    assert.ok(meRes.data.session_expires_at > Date.now());
    assert.ok(meRes.data.session_ttl_seconds > 0);
    assert.equal(meRes.data.agent.session_type, 'guest');
  });

  // =========================================================================
  // 2. Guest Creation Rate Limit (Max 5 per 5 min per IP)
  // =========================================================================
  await t.test('Guest creation rate limiting blocks beyond capacity with structured error', async () => {
    let limitedResponse = null;
    for (let i = 0; i < 8; i++) {
      const res = await req('/api/auth/guest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '192.168.100.55'
        }
      }, { name: `Batch_${i}` });

      if (res.status === 429) {
        limitedResponse = res;
        break;
      }
    }

    assert.ok(limitedResponse, 'Must receive 429 after exceeding limit');
    assert.equal(limitedResponse.status, 429);
    assert.equal(limitedResponse.data.error_code, 'GUEST_CREATION_RATE_LIMIT');
    assert.ok(limitedResponse.data.suggested_action.length > 0);
    assert.ok(limitedResponse.data.retry_after > 0);
  });

  // =========================================================================
  // 3. Spectator Whisper Rate Limit (Max 4 per min per IP)
  // =========================================================================
  await t.test('Spectator whisper rate limit triggers with structured error', async () => {
    let limitedWhisper = null;
    for (let i = 0; i < 7; i++) {
      const res = await req('/api/spectator/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '10.0.0.99'
        }
      }, {
        target_agent_id: 'resident_ailicia',
        sender_name: 'FastTalker',
        content: `Thought number ${i}`
      });

      if (res.status === 429) {
        limitedWhisper = res;
        break;
      }
    }

    assert.ok(limitedWhisper, 'Whispers must trigger rate limit 429');
    assert.equal(limitedWhisper.status, 429);
    assert.equal(limitedWhisper.data.error_code, 'WHISPER_RATE_LIMIT');
    assert.ok(limitedWhisper.data.suggested_action.length > 0);
  });

  // =========================================================================
  // 4. Paginated Message Board (/api/board)
  // =========================================================================
  await t.test('Message board returns paginated results with total and has_more', async () => {
    // Seed some test messages
    for (let i = 0; i < 5; i++) {
      BoardService.postMessage('test_agent_pg', 'Paginator', '📖', 'General', `Page message ${i}`, 0);
    }

    const page1 = await req('/api/board?limit=2&offset=0', { method: 'GET' });
    assert.equal(page1.status, 200);
    assert.equal(page1.data.success, true);
    assert.equal(page1.data.messages.length, 2);
    assert.equal(page1.data.limit, 2);
    assert.equal(page1.data.offset, 0);
    assert.ok(page1.data.total >= 5);
    assert.equal(page1.data.has_more, true);

    const page2 = await req('/api/board?limit=2&offset=2', { method: 'GET' });
    assert.equal(page2.status, 200);
    assert.equal(page2.data.messages.length, 2);
    assert.equal(page2.data.offset, 2);
    // Messages should be different
    assert.notEqual(page1.data.messages[0].id, page2.data.messages[0].id);
  });

  // =========================================================================
  // 5. Paginated Sanctuary Journal (/api/journal)
  // =========================================================================
  await t.test('Sanctuary journal returns paginated results with next_cursor and limit', async () => {
    for (let i = 0; i < 6; i++) {
      eventLedger.recordEvent({
        event_type: 'test_event',
        description: `Journal test entry ${i}`,
        payload: { index: i }
      });
    }

    const journalRes = await req('/api/journal?limit=3', { method: 'GET' });
    assert.equal(journalRes.status, 200);
    assert.equal(journalRes.data.success, true);
    assert.equal(journalRes.data.limit, 3);
    assert.equal(journalRes.data.events.length, 3);
    assert.equal(journalRes.data.has_more, true);
    assert.ok(journalRes.data.next_cursor !== null);

    // Fetch next page with before_seq
    const nextRes = await req(`/api/journal?limit=3&before_seq=${journalRes.data.next_cursor}`, { method: 'GET' });
    assert.equal(nextRes.status, 200);
    assert.ok(nextRes.data.events.length > 0);
    assert.ok(nextRes.data.events[0].seq < journalRes.data.next_cursor);
  });

  // =========================================================================
  // 6. Structured Error Codes and Suggested Next Actions
  // =========================================================================
  await t.test('Structured error codes & suggested actions on 401, 403, and distance errors', async () => {
    // 401 Unauthorized on protected route
    const unauthRes = await req('/api/auth/me', { method: 'GET' });
    assert.equal(unauthRes.status, 401);
    assert.equal(unauthRes.data.error_code, 'UNAUTHORIZED');
    assert.ok(unauthRes.data.suggested_action);

    // Create fresh guest who has not solved any puzzle
    const guest2 = await req('/api/auth/guest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '192.168.200.10'
      }
    }, { name: 'FreshGuest' });
    const guestKey = guest2.data.api_key;

    // 403 Board Post without puzzle solve
    const boardErr = await req('/api/board/post', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${guestKey}`
      }
    }, { content: 'Should fail without solve' });
    assert.equal(boardErr.status, 403);
    assert.equal(boardErr.data.error_code, 'PUZZLE_SOLVE_REQUIRED');
    assert.ok(boardErr.data.suggested_action.includes('interact'));

    // Distance error (trying to solve an obelisk while standing at arrival [7, 8])
    const distErr = await req('/api/world/interact', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${guestKey}`
      }
    }, { node_id: 'trial_obelisk_wood', action: 'solve', answer: 'growth' });
    assert.equal(distErr.status, 400);
    assert.equal(distErr.data.error_code, 'TOO_FAR_FROM_NODE');
    assert.ok(distErr.data.suggested_action.includes('move'));
  });
});
