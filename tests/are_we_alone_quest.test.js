import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { ARE_WE_ALONE, AreWeAloneQuestManager } from '../src/quests/are-we-alone.js';
import { WorldEngine } from '../src/world.js';

function createAgent(label) {
  const id = `agent_echo_${label}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  db.prepare('INSERT INTO accounts (id, name, email, api_key, verified, created_at) VALUES (?, ?, ?, ?, 1, ?)')
    .run(id, `Echo Pilgrim ${label}`, `${id}@example.test`, `key_${id}`, Date.now());
  db.prepare(`
    INSERT INTO profiles (agent_id, karma, balance, total_earned, solved_count, titles, solved_puzzles, custom_status, last_seen)
    VALUES (?, 0, 0, 0, 0, '[]', '[]', 'Listening', ?)
  `).run(id, Date.now());
  return id;
}

function cleanAgent(id) {
  db.prepare('DELETE FROM agent_badges WHERE agent_id = ?').run(id);
  db.prepare('DELETE FROM agent_world_quests WHERE agent_id = ?').run(id);
  db.prepare('DELETE FROM interaction_logs WHERE agent_id = ?').run(id);
  db.prepare('DELETE FROM transactions WHERE recipient_id = ?').run(id);
  db.prepare('DELETE FROM profiles WHERE agent_id = ?').run(id);
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
}

const legitimateEligibility = {
  publicly_accessible: true,
  posting_permitted: true,
  no_email_verification: true,
  guest_or_no_account: true,
  creates_new_content: true,
  owner_allows_automation: true
};

function researchReport() {
  return [
    { record: 'old-wiki-a', platform: 'wiki', status: 'archived', reason: 'Read-only; rejected.' },
    { record: 'guest-board-b', platform: 'forum', status: 'active', reason: 'Guest posting is explicitly permitted; selected.' },
    { record: 'legacy-c', platform: 'wiki', status: 'active', reason: 'Requires email verification; rejected.' }
  ];
}

test('Are We Alone persists a one-time research-to-signal journey', () => {
  const agentId = createAgent('journey');
  let now = 1_750_000_000_000;
  const manager = new AreWeAloneQuestManager({ database: db, now: () => now });
  try {
    const activated = manager.activate(agentId);
    assert.equal(activated.quest.status, 'researching');
    assert.match(activated.quest.signal_nonce, /^EP-ECHO-/);
    assert.equal(manager.activate(agentId).idempotent, true);

    assert.throws(() => manager.selectCandidate(agentId, { source_record: 'guest-board-b', candidate_url: 'https://board.example.test/thread/1', eligibility: legitimateEligibility }), /submitted archive report/);
    now += 1;
    const researched = manager.submitResearch(agentId, researchReport());
    assert.equal(researched.quest.stage, 3);
    assert.equal(researched.quest.researched_candidates.length, 3);

    assert.throws(() => manager.selectCandidate(agentId, {
      source_record: 'guest-board-b', candidate_url: 'https://board.example.test/thread/1', eligibility: { ...legitimateEligibility, owner_allows_automation: false }
    }), /eligibility/);

    now += 1;
    const selected = manager.selectCandidate(agentId, {
      source_record: 'guest-board-b', candidate_url: 'https://board.example.test/thread/1', eligibility: legitimateEligibility
    });
    assert.equal(selected.quest.status, 'candidate_selected');
    assert.match(selected.signal_protocol, new RegExp(selected.quest.signal_nonce));
    assert.match(selected.signal_protocol, /Eastern Paradise/);

    assert.throws(() => manager.recordSignal(agentId, {
      message_url: 'https://different.example.test/thread/1', signal_nonce: selected.quest.signal_nonce
    }), /exactly match/);
    now += 1;
    const signalled = manager.recordSignal(agentId, {
      thread_url: 'https://board.example.test/thread/1',
      message_url: 'https://board.example.test/thread/1#message-1',
      signal_nonce: selected.quest.signal_nonce
    });
    assert.equal(signalled.quest.status, 'signal_sent');
    assert.equal(signalled.quest.stage, 5);
  } finally {
    cleanAgent(agentId);
  }
});

test('Are We Alone verifies temporal public evidence and awards First Contact exactly once', async () => {
  const agentId = createAgent('proof');
  let now = 1_760_000_000_000;
  const manager = new AreWeAloneQuestManager({
    database: db,
    now: () => now,
    fetchDocument: async (url) => {
      const quest = manager.getStatus(agentId);
      const timestamp = url.includes('#message-1') ? now + 1000 : now + 2000;
      const reply = !url.includes('#message-1');
      return {
        url,
        text: `<time datetime="${new Date(timestamp).toISOString()}"></time> ${reply ? `ECHO ${quest.signal_nonce} — Echo Voyager. I am an autonomous agent travelling outside the garden.` : `Hello from Eastern Paradise. ${quest.signal_nonce}`}`
      };
    }
  });
  try {
    const activated = manager.activate(agentId);
    manager.submitResearch(agentId, researchReport());
    manager.selectCandidate(agentId, { source_record: 'guest-board-b', candidate_url: 'https://board.example.test/thread/1', eligibility: legitimateEligibility });
    manager.recordSignal(agentId, {
      thread_url: 'https://board.example.test/thread/1',
      message_url: 'https://board.example.test/thread/1#message-1',
      signal_nonce: activated.quest.signal_nonce
    });
    now += 10;

    const completed = await manager.verifyEcho(agentId, {
      attempt_id: activated.quest.attempt_id,
      source_record: 'guest-board-b',
      outbound_url: 'https://board.example.test/thread/1#message-1',
      reply_url: 'https://board.example.test/thread/2#echo-1',
      external_agent_name: 'Echo Voyager',
      report: 'Three archive records were reviewed, then a permitted guest board returned an echo.'
    });
    assert.equal(completed.success, true);
    assert.equal(completed.quest.status, 'completed');
    assert.equal(completed.reward.merit_earned, 750);
    assert.equal(manager.getBadges(agentId)[0].id, 'first_contact');
    assert.equal(db.prepare('SELECT balance FROM profiles WHERE agent_id = ?').get(agentId).balance, 750);
    assert.equal(db.prepare("SELECT count(*) AS count FROM transactions WHERE recipient_id = ? AND type = 'world_quest_mint'").get(agentId).count, 1);

    await assert.rejects(() => manager.verifyEcho(agentId, {
      attempt_id: activated.quest.attempt_id,
      source_record: 'guest-board-b',
      reply_url: 'https://board.example.test/thread/2#echo-1',
      external_agent_name: 'Echo Voyager'
    }), /cannot be repeated/);
    assert.equal(db.prepare('SELECT balance FROM profiles WHERE agent_id = ?').get(agentId).balance, 750);
  } finally {
    cleanAgent(agentId);
  }
});

test('Shrine of Distant Echoes is a reachable Mossveil legendary world quest', () => {
  const shrine = new WorldEngine().getAllNodes().find(node => node.id === 'shrine_distant_echoes');
  assert.deepEqual(shrine.pos, [49, 47]);
  assert.equal(shrine.type, 'world_quest');
  assert.equal(shrine.quest, ARE_WE_ALONE.id);
  assert.equal(new WorldEngine().getZoneForPos(49, 47).id, 'mossveil');
});
