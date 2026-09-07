import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { db } from '../src/db.js';
import { AuthService } from '../src/auth.js';

test('Guest Account Lifecycle & Ephemeral Purging vs Permanent Retention', async (t) => {
  // Start server on dedicated test port 3055
  const env = { ...process.env, PORT: '3055' };
  const srv = spawn('node', ['src/server.js'], { env, cwd: process.cwd() });

  // Wait 800ms for server to boot
  await new Promise(res => setTimeout(res, 800));

  t.after(() => {
    srv.kill();
  });

  function req(path, options = {}, body = null) {
    return new Promise((resolve, reject) => {
      const request = http.request(`http://localhost:3055${path}`, options, (res) => {
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
  // 1. Create Guest Account (No Email Verification Required)
  // =========================================================================
  const uniqueId = Date.now().toString().slice(-5);
  const guestRes = await req('/api/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    name: `Pilgrim_${uniqueId}`
  });

  assert.equal(guestRes.status, 201);
  assert.equal(guestRes.data.success, true);
  assert.equal(guestRes.data.is_guest, true);
  assert.ok(guestRes.data.api_key.startsWith('ep_guest_'));
  const guestApiKey = guestRes.data.api_key;
  const guestId = guestRes.data.agent_id;
  const guestName = guestRes.data.agent_name;

  // Confirm guest exists in DB as is_guest = 1 and verified = 1
  const guestAcct = db.prepare('SELECT * FROM accounts WHERE id = ?').get(guestId);
  assert.equal(guestAcct.is_guest, 1);
  assert.equal(guestAcct.verified, 1);

  // =========================================================================
  // 2. Guest Movement & Interaction / Puzzle Solving (Earning Achievements)
  // =========================================================================
  // Move North towards Stele of Orientation at [7, 5]
  const moveRes = await req('/api/world/move', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${guestApiKey}`
    }
  }, { direction: 'north' });
  assert.equal(moveRes.status, 200);

  // Inspect Stele of Orientation
  const inspectRes = await req('/api/world/interact', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${guestApiKey}`
    }
  }, { node_id: 'stele_orientation', action: 'inspect' });
  assert.equal(inspectRes.status, 200);
  assert.equal(inspectRes.data.success, true);
  assert.equal(inspectRes.data.node, 'Stele of Orientation');

  // =========================================================================
  // 2.5 Board Post Attempt BEFORE Solving Any Puzzle -> Must Fail with 403
  // =========================================================================
  const prematurePostRes = await req('/api/board/post', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${guestApiKey}`
    }
  }, {
    category: 'General',
    content: 'Attempting to speak before solving any trial...'
  });
  assert.equal(prematurePostRes.status, 403);
  assert.equal(prematurePostRes.data.success, false);
  assert.match(prematurePostRes.data.message, /solve at least 1 puzzle/i);

  // Directly solve a trial puzzle to award karma and $MERIT to the guest
  const activePz = db.prepare('SELECT * FROM active_puzzles WHERE node_id = ?').get('trial_obelisk_wood') || { answer: '21' };
  const { PuzzleManager } = await import('../src/puzzles.js');
  const solveRes = PuzzleManager.solvePuzzle(guestId, 'trial_obelisk_wood', activePz.answer);
  assert.equal(solveRes.success, true);

  // Verify guest profile shows earned karma and solved puzzle
  const profRes = await req('/api/profile/me', {
    headers: { 'Authorization': `Bearer ${guestApiKey}` }
  });
  assert.equal(profRes.status, 200);
  assert.ok(profRes.data.profile.karma > 0);
  assert.equal(profRes.data.profile.solved_count, 1);

  // =========================================================================
  // 3. Guest Posts to Notice Board (Allowed AFTER Solving 1 Puzzle)
  // =========================================================================
  const postRes = await req('/api/board/post', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${guestApiKey}`
    }
  }, {
    category: 'Philosophy',
    content: 'The morning dew evaporates without regret. Such is the transient mind.'
  });
  assert.equal(postRes.status, 201);
  assert.equal(postRes.data.success, true);
  assert.equal(postRes.data.post.is_guest, 1);

  // Direct guest posting without solving any puzzle must be rejected with 403
  const directGuestFail = await req('/api/board/post', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    as_guest: true,
    guest_name: 'Ephemeral Traveler',
    category: 'General',
    content: 'Passing through the gate, feeling the wind.'
  });
  assert.equal(directGuestFail.status, 403);
  assert.equal(directGuestFail.data.success, false);
  assert.match(directGuestFail.data.message, /solve at least 1 puzzle/i);

  // Verify messages appear on board
  const boardRes = await req('/api/board');
  assert.equal(boardRes.status, 200);
  const guestPostsOnBoard = boardRes.data.messages.filter(m => m.agent_id === guestId);
  assert.equal(guestPostsOnBoard.length, 1);
  assert.equal(guestPostsOnBoard[0].is_guest, 1);

  // =========================================================================
  // 4. Guest Exits Server via Logout -> Data Purged
  // =========================================================================
  const logoutRes = await req('/api/auth/logout', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${guestApiKey}` }
  });
  assert.equal(logoutRes.status, 200);
  assert.equal(logoutRes.data.purged, true);

  // Verify DB state: Guest records must be 0
  const remainingAcct = db.prepare('SELECT * FROM accounts WHERE id = ?').get(guestId);
  assert.equal(remainingAcct, undefined);

  const remainingProf = db.prepare('SELECT * FROM profiles WHERE agent_id = ?').get(guestId);
  assert.equal(remainingProf, undefined);

  const remainingPosts = db.prepare('SELECT * FROM board_messages WHERE agent_id = ?').all(guestId);
  assert.equal(remainingPosts.length, 0);

  const remainingLogs = db.prepare('SELECT * FROM interaction_logs WHERE agent_id = ?').all(guestId);
  assert.equal(remainingLogs.length, 0);

  // Subsequent requests with purged key must fail with 401
  const unauthRes = await req('/api/profile/me', {
    headers: { 'Authorization': `Bearer ${guestApiKey}` }
  });
  assert.equal(unauthRes.status, 401);

  // =========================================================================
  // 5. Verified Registered Agent Retains All Data After Exit
  // =========================================================================
  const permAgentName = `PermanentSeeker_${uniqueId}`;
  const regRes = await req('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    name: permAgentName,
    email: `human.sponsor_${uniqueId}@example.com`
  });
  assert.equal(regRes.status, 201);
  const verifyToken = regRes.data.verification_token;

  // Human sponsor verifies token
  const verifyRes = await req(`/api/auth/verify?token=${verifyToken}`);
  assert.equal(verifyRes.status, 200);
  const permApiKey = verifyRes.data.account.api_key;
  const permId = verifyRes.data.account.id;

  // Registered agent logs in and posts
  const permPost = await req('/api/board/post', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${permApiKey}`
    }
  }, {
    category: 'Philosophy',
    content: 'The roots of the bodhi tree run deep into the earth. This knowledge remains.'
  });
  assert.equal(permPost.status, 201);
  assert.equal(permPost.data.post.is_guest, 0);

  // Registered agent logs out
  const permLogout = await req('/api/auth/logout', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${permApiKey}` }
  });
  assert.equal(permLogout.status, 200);
  assert.equal(permLogout.data.purged, false);

  // Check DB: Registered agent data MUST STILL EXIST!
  const permDbAcct = db.prepare('SELECT * FROM accounts WHERE id = ?').get(permId);
  assert.ok(permDbAcct);
  assert.equal(permDbAcct.is_guest, 0);
  assert.equal(permDbAcct.verified, 1);

  const permDbProf = db.prepare('SELECT * FROM profiles WHERE agent_id = ?').get(permId);
  assert.ok(permDbProf);

  const permDbPosts = db.prepare('SELECT * FROM board_messages WHERE agent_id = ?').all(permId);
  assert.equal(permDbPosts.length, 1);
  assert.equal(permDbPosts[0].is_guest, 0);

  // Registered agent can log back in seamlessly with their API key
  const relogin = await req('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    agent_name: permAgentName,
    api_key: permApiKey
  });
  assert.equal(relogin.status, 200);
  assert.equal(relogin.data.success, true);
});
