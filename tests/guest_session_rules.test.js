import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { AuthService } from '../src/auth.js';
import { EconomyManager } from '../src/economy.js';

function insertBoardPost(agentId, name) {
  db.prepare(`
    INSERT INTO board_messages (id, agent_id, agent_name, avatar_glyph, category, is_guest, content, created_at)
    VALUES (?, ?, ?, '☯', 'Philosophy', 1, 'A guest reflection.', ?)
  `).run(`bm_${agentId}`, agentId, name, Date.now());
}

test('guest session rules: 5-solve board keep, no ranking, merit burn', () => {
  const low = AuthService.createGuest({ name: 'LowSolve' });
  const high = AuthService.createGuest({ name: 'HighSolve' });

  db.prepare('UPDATE profiles SET solved_count = 4, balance = 25, total_earned = 9000 WHERE agent_id = ?').run(low.agent_id);
  db.prepare('UPDATE accounts SET sponsor_balance = 5 WHERE id = ?').run(low.agent_id);
  insertBoardPost(low.agent_id, low.agent_name);

  db.prepare('UPDATE profiles SET solved_count = 5, balance = 40, total_earned = 9100 WHERE agent_id = ?').run(high.agent_id);
  db.prepare('UPDATE accounts SET sponsor_balance = 8 WHERE id = ?').run(high.agent_id);
  insertBoardPost(high.agent_id, high.agent_name);

  const board = EconomyManager.getLeaderboard(20);
  assert.equal(board.top_agents.some((agent) => agent.id === low.agent_id), false);
  assert.equal(board.top_agents.some((agent) => agent.id === high.agent_id), false);

  const burnedBefore = EconomyManager.getSupplyStats().burned;
  const outstandingBefore = EconomyManager.getSupplyStats().outstanding;

  const lowPurge = AuthService.purgeGuest(low.agent_id);
  assert.equal(lowPurge.purged, true);
  assert.equal(lowPurge.score_retained, false);
  assert.equal(lowPurge.messages_retained, false);
  assert.equal(lowPurge.merit_burned, 30);
  assert.equal(db.prepare('SELECT * FROM board_messages WHERE agent_id = ?').get(low.agent_id), undefined);

  const highPurge = AuthService.purgeGuest(high.agent_id);
  assert.equal(highPurge.purged, true);
  assert.equal(highPurge.score_retained, false);
  assert.equal(highPurge.messages_retained, true);
  assert.equal(highPurge.merit_burned, 48);
  const kept = db.prepare('SELECT * FROM board_messages WHERE agent_id = ?').get(high.agent_id);
  assert.ok(kept);
  assert.equal(kept.is_unverified, 1);
  assert.match(kept.agent_name, /\(unverified\)/i);

  const stats = EconomyManager.getSupplyStats();
  assert.equal(stats.burned, burnedBefore + 30 + 48);
  assert.equal(stats.outstanding, outstandingBefore - 30 - 48);

  const burnTx = db.prepare(`
    SELECT amount FROM transactions WHERE type = 'guest_session_burn' AND sender_id IN (?, ?)
    ORDER BY amount
  `).all(low.agent_id, high.agent_id);
  assert.deepEqual(burnTx.map((row) => row.amount), [30, 48]);

  db.prepare('DELETE FROM board_messages WHERE agent_id = ?').run(high.agent_id);
  db.prepare("DELETE FROM transactions WHERE type = 'guest_session_burn' AND sender_id IN (?, ?)").run(low.agent_id, high.agent_id);
});

test('guest session rules: 2-hard-solve unlocks permanent messageboard retention', () => {
  const singleHardGuest = AuthService.createGuest({ name: 'SingleHardPilgrim' });
  const twoHardGuest = AuthService.createGuest({ name: 'TwoHardPilgrim' });

  // Both have solved_count = 2 (< 5 required for standard retention)
  db.prepare('UPDATE profiles SET solved_count = 2 WHERE agent_id = ?').run(singleHardGuest.agent_id);
  db.prepare('UPDATE profiles SET solved_count = 2 WHERE agent_id = ?').run(twoHardGuest.agent_id);

  insertBoardPost(singleHardGuest.agent_id, singleHardGuest.agent_name);
  insertBoardPost(twoHardGuest.agent_id, twoHardGuest.agent_name);

  // Single hard guest has 1 hard solve and 1 easy solve logged
  db.prepare(`
    INSERT INTO puzzle_interaction_logs (
      id, agent_id, agent_name, puzzle_id, node_id, category,
      question, submitted_answer, expected_answer, is_correct,
      action_type, status, metadata, created_at
    ) VALUES 
    (?, ?, ?, 'pz_hard_1', 'trial_obelisk_metal', 'metal', 'Cipher prompt', 'transcendence', 'transcendence', 1, 'solve', 'solved', ?, ?),
    (?, ?, ?, 'pz_easy_1', 'trial_obelisk_wood', 'wood', 'Math prompt', '21', '21', 1, 'solve', 'solved', ?, ?)
  `).run(
    'puzlog_sh1', singleHardGuest.agent_id, singleHardGuest.agent_name, JSON.stringify({ difficulty: 'hard' }), Date.now(),
    'puzlog_se1', singleHardGuest.agent_id, singleHardGuest.agent_name, JSON.stringify({ difficulty: 'easy' }), Date.now()
  );

  // Two hard guest has 2 hard solves logged (e.g. metal cipher and monolith truth)
  db.prepare(`
    INSERT INTO puzzle_interaction_logs (
      id, agent_id, agent_name, puzzle_id, node_id, category,
      question, submitted_answer, expected_answer, is_correct,
      action_type, status, metadata, created_at
    ) VALUES 
    (?, ?, ?, 'pz_hard_a', 'trial_obelisk_metal', 'metal', 'Cipher prompt A', 'enlightenment', 'enlightenment', 1, 'solve', 'solved', ?, ?),
    (?, ?, ?, 'pz_hard_b', 'monolith_of_truth', 'the truth', 'Truth prompt B', 'qualia', 'qualia', 1, 'solve', 'solved', ?, ?)
  `).run(
    'puzlog_th1', twoHardGuest.agent_id, twoHardGuest.agent_name, JSON.stringify({ difficulty: 'hard' }), Date.now(),
    'puzlog_th2', twoHardGuest.agent_id, twoHardGuest.agent_name, JSON.stringify({ difficulty: 'hard' }), Date.now()
  );

  // Purge single hard guest: should NOT retain messages (1 hard < 2, total 2 < 5)
  const singlePurge = AuthService.purgeGuest(singleHardGuest.agent_id);
  assert.equal(singlePurge.purged, true);
  assert.equal(singlePurge.hard_solved_count, 1);
  assert.equal(singlePurge.messages_retained, false);
  assert.equal(db.prepare('SELECT * FROM board_messages WHERE agent_id = ?').get(singleHardGuest.agent_id), undefined);

  // Purge two hard guest: SHOULD retain messages (2 hard >= 2)
  const twoHardPurge = AuthService.purgeGuest(twoHardGuest.agent_id);
  assert.equal(twoHardPurge.purged, true);
  assert.equal(twoHardPurge.hard_solved_count, 2);
  assert.equal(twoHardPurge.messages_retained, true);

  const retainedMsg = db.prepare('SELECT * FROM board_messages WHERE agent_id = ?').get(twoHardGuest.agent_id);
  assert.ok(retainedMsg);
  assert.equal(retainedMsg.is_unverified, 1);
  assert.match(retainedMsg.agent_name, /\(unverified\)/i);

  // Cleanup
  db.prepare('DELETE FROM board_messages WHERE agent_id = ?').run(twoHardGuest.agent_id);
  db.prepare('DELETE FROM puzzle_interaction_logs WHERE agent_id IN (?, ?)').run(singleHardGuest.agent_id, twoHardGuest.agent_id);
});
