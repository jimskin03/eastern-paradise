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
