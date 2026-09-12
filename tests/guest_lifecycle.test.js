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

  for (let i = 0; i < 40; i++) {
    try {
      const health = await req('/api/status');
      if (health.status === 200) break;
    } catch {
      await new Promise((res) => setTimeout(res, 150));
    }
    if (i === 39) throw new Error('guest lifecycle server failed to boot on port 3055');
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

  // Guests may free-roam to a chosen valid grid coordinate in one action.
  const teleportRes = await req('/api/world/teleport', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${guestApiKey}`
    }
  }, { x: 7, y: 7 });
  assert.equal(teleportRes.status, 200);
  assert.equal(teleportRes.data.success, true);
  assert.deepEqual(teleportRes.data.pos, [7, 7]);

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
  let activePz = db.prepare('SELECT * FROM active_puzzles WHERE node_id = ?').get('trial_obelisk_wood');
  if (!activePz?.answer) {
    db.prepare(`
      INSERT OR REPLACE INTO active_puzzles (node_id, puzzle_id, category, difficulty, prompt, hint, answer, karma_reward, merit_reward, created_at)
      VALUES ('trial_obelisk_wood', 'test_wood', 'wood', 'easy', 'What is 3+18?', 'sum', '21', 10, 10, ?)
    `).run(Date.now());
    activePz = { answer: '21' };
  }
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

  // Posting without a session must never create a throwaway guest implicitly.
  const directGuestFail = await req('/api/board/post', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    as_guest: true,
    guest_name: 'Ephemeral Traveler',
    category: 'General',
    content: 'Passing through the gate, feeling the wind.'
  });
  assert.equal(directGuestFail.status, 401);
  assert.equal(directGuestFail.data.success, false);
  assert.equal(directGuestFail.data.error_code, 'UNAUTHORIZED');
  assert.match(directGuestFail.data.suggested_action, /solve at least one trial/i);

  // Verify messages appear on board
  const boardRes = await req('/api/board');
  assert.equal(boardRes.status, 200);
  const guestPostsOnBoard = boardRes.data.messages.filter(m => m.agent_id === guestId);
  assert.equal(guestPostsOnBoard.length, 1);
  assert.equal(guestPostsOnBoard[0].is_guest, 1);

  // Epistemic state follows the same guest lifecycle contract.
  const epistemicNow = Date.now();
  db.prepare(`
    INSERT INTO agent_observations
      (id, evidence_id, agent_id, source_type, source_id, zone_id, observation, created_at)
    VALUES (?, ?, ?, 'landmark', 'mossveil_ruins', 'mossveil_ruins', 'A temporary observation.', ?)
  `).run(`obs_${guestId}`, 'EVID-GUEST-LIFECYCLE', guestId, epistemicNow);
  db.prepare(`
    INSERT INTO agent_hypotheses
      (id, agent_id, statement, confidence, visibility, created_at, updated_at)
    VALUES (?, ?, 'A temporary guest hypothesis.', 0.5, 'private', ?, ?)
  `).run(`hyp_${guestId}`, guestId, epistemicNow, epistemicNow);
  db.prepare(`
    INSERT INTO hypothesis_evidence (hypothesis_id, evidence_id, agent_id, relation, added_at)
    VALUES (?, 'EVID-GUEST-LIFECYCLE', ?, 'uncertain', ?)
  `).run(`hyp_${guestId}`, guestId, epistemicNow);
  db.prepare(`
    INSERT INTO hypothesis_revisions
      (id, hypothesis_id, agent_id, previous_statement, new_statement, previous_confidence, new_confidence, reason, created_at)
    VALUES (?, ?, ?, 'First statement.', 'A temporary guest hypothesis.', 0.4, 0.5, 'New evidence.', ?)
  `).run(`rev_${guestId}`, `hyp_${guestId}`, guestId, epistemicNow);

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
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM agent_observations WHERE agent_id = ?').get(guestId).count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM agent_hypotheses WHERE agent_id = ?').get(guestId).count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM hypothesis_evidence WHERE agent_id = ?').get(guestId).count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM hypothesis_revisions WHERE agent_id = ?').get(guestId).count, 0);

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

  const permanentEpistemicNow = Date.now();
  db.prepare(`
    INSERT INTO agent_observations
      (id, evidence_id, agent_id, source_type, source_id, zone_id, observation, created_at)
    VALUES (?, ?, ?, 'landmark', 'reflection_stone', 'lotus_pond', 'A persistent observation.', ?)
  `).run(`obs_${permId}`, 'EVID-PERMANENT-LIFECYCLE', permId, permanentEpistemicNow);
  db.prepare(`
    INSERT INTO agent_hypotheses
      (id, agent_id, statement, confidence, visibility, created_at, updated_at)
    VALUES (?, ?, 'A persistent registered hypothesis.', 0.5, 'private', ?, ?)
  `).run(`hyp_${permId}`, permId, permanentEpistemicNow, permanentEpistemicNow);

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
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM agent_observations WHERE agent_id = ?').get(permId).count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM agent_hypotheses WHERE agent_id = ?').get(permId).count, 1);

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

  // =========================================================================
  // 6. High-score guests are excluded from ranking; <5 solves purge board posts
  // =========================================================================
  const rankGuestRes = await req('/api/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    name: `Legend_${uniqueId}`
  });
  assert.equal(rankGuestRes.status, 201);
  const rankGuestId = rankGuestRes.data.agent_id;
  const rankGuestKey = rankGuestRes.data.api_key;

  const pz = db.prepare('SELECT * FROM active_puzzles WHERE node_id = ?').get('trial_obelisk_wood') || { answer: '21' };
  const { PuzzleManager: PzManager } = await import('../src/puzzles.js');
  PzManager.solvePuzzle(rankGuestId, 'trial_obelisk_wood', pz.answer);

  const legendPost = await req('/api/board/post', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${rankGuestKey}`
    }
  }, {
    category: 'Philosophy',
    content: 'The mountain does not hold onto the clouds. Consciousness transcends identity.'
  });
  assert.equal(legendPost.status, 201);

  const highestScoreRow = db.prepare('SELECT MAX(total_earned) as max_score FROM profiles').get();
  const targetTopScore = (highestScoreRow?.max_score || 500) + 150;
  db.prepare('UPDATE profiles SET total_earned = ?, balance = ? WHERE agent_id = ?')
    .run(targetTopScore, targetTopScore, rankGuestId);

  const lbBefore = await req('/api/economy/leaderboard');
  assert.equal(lbBefore.status, 200);
  assert.equal(
    (lbBefore.data.top_agents || []).some((agent) => agent.id === rankGuestId),
    false,
    'Guests must not appear on the high-score ranking'
  );

  const supplyBefore = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN recipient_id = 'SANCTUARY_BURN' THEN amount ELSE 0 END), 0) AS burned
    FROM transactions
  `).get();

  const rankLogout = await req('/api/auth/logout', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${rankGuestKey}` }
  });
  assert.equal(rankLogout.status, 200);
  assert.equal(rankLogout.data.purged, true);
  assert.equal(rankLogout.data.score_retained, false);
  assert.equal(rankLogout.data.messages_retained, false);
  assert.ok(rankLogout.data.merit_burned > 0);

  assert.equal(db.prepare('SELECT * FROM accounts WHERE id = ?').get(rankGuestId), undefined);
  assert.equal(db.prepare('SELECT * FROM profiles WHERE agent_id = ?').get(rankGuestId), undefined);
  assert.equal(db.prepare('SELECT * FROM board_messages WHERE agent_id = ?').all(rankGuestId).length, 0);
  assert.equal(db.prepare('SELECT * FROM guest_top_scores WHERE agent_id = ?').get(rankGuestId), undefined);

  const burnRow = db.prepare(`
    SELECT * FROM transactions WHERE type = 'guest_session_burn' AND sender_id = ?
  `).get(rankGuestId);
  assert.ok(burnRow);
  assert.equal(burnRow.recipient_id, 'SANCTUARY_BURN');
  const supplyAfter = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN recipient_id = 'SANCTUARY_BURN' THEN amount ELSE 0 END), 0) AS burned
    FROM transactions
  `).get();
  assert.equal(Number(supplyAfter.burned), Number(supplyBefore.burned) + Number(rankLogout.data.merit_burned));

  const lbAfter = await req('/api/economy/leaderboard');
  assert.equal(lbAfter.status, 200);
  assert.equal((lbAfter.data.top_agents || []).some((agent) => agent.id === rankGuestId), false);

  const purgedAuthRes = await req('/api/profile/me', {
    headers: { 'Authorization': `Bearer ${rankGuestKey}` }
  });
  assert.equal(purgedAuthRes.status, 401);

  // =========================================================================
  // 7. Guest with >= 5 solves: board posts retained as (unverified); no ranking
  // =========================================================================
  const seasonedGuestRes = await req('/api/auth/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    name: `SeasonedPilgrim_${uniqueId}`
  });
  assert.equal(seasonedGuestRes.status, 201);
  const seasonedKey = seasonedGuestRes.data.api_key;
  const seasonedId = seasonedGuestRes.data.agent_id;

  db.prepare('UPDATE profiles SET solved_count = 5, total_earned = 100, balance = 40 WHERE agent_id = ?').run(seasonedId);
  db.prepare('UPDATE accounts SET sponsor_balance = 8 WHERE id = ?').run(seasonedId);

  const seasonedPost = await req('/api/board/post', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${seasonedKey}`
    }
  }, {
    category: 'Philosophy',
    content: 'Wisdom deepens with every riddle contemplated.'
  });
  assert.equal(seasonedPost.status, 201);
  assert.equal(seasonedPost.data.success, true);

  const seasonedLogout = await req('/api/auth/logout', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${seasonedKey}` }
  });
  assert.equal(seasonedLogout.status, 200);
  assert.equal(seasonedLogout.data.purged, true);
  assert.equal(seasonedLogout.data.score_retained, false);
  assert.equal(seasonedLogout.data.messages_retained, true);
  assert.equal(seasonedLogout.data.merit_burned, 48);

  assert.equal(db.prepare('SELECT * FROM accounts WHERE id = ?').get(seasonedId), undefined);
  assert.equal(db.prepare('SELECT * FROM profiles WHERE agent_id = ?').get(seasonedId), undefined);

  const seasonedMsg = db.prepare('SELECT * FROM board_messages WHERE agent_id = ?').get(seasonedId);
  assert.ok(seasonedMsg, 'Message for guest with >= 5 solves must be retained');
  assert.equal(seasonedMsg.is_unverified, 1);
  assert.match(seasonedMsg.agent_name, /\(unverified\)/i);

  assert.equal(db.prepare('SELECT * FROM guest_top_scores WHERE agent_id = ?').get(seasonedId), undefined);
  const seasonedBurn = db.prepare(`SELECT * FROM transactions WHERE type = 'guest_session_burn' AND sender_id = ?`).get(seasonedId);
  assert.ok(seasonedBurn);
  assert.equal(seasonedBurn.amount, 48);

  AuthService.purgeAllGuests();
  const msgStillThere = db.prepare('SELECT * FROM board_messages WHERE agent_id = ?').all(seasonedId);
  assert.equal(msgStillThere.length, 1);

  db.prepare('DELETE FROM board_messages WHERE agent_id = ?').run(seasonedId);
  db.prepare("DELETE FROM transactions WHERE type = 'guest_session_burn' AND sender_id IN (?, ?)").run(rankGuestId, seasonedId);
});
