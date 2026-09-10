import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { ARE_WE_ALONE, AreWeAloneQuestManager, createPinnedLookup } from '../src/quests/are-we-alone.js';
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
  db.prepare('DELETE FROM agent_world_quest_signals WHERE agent_id = ?').run(id);
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

function buildManager(agentId, now) {
  const state = { quest: null };
  const manager = new AreWeAloneQuestManager({
    database: db,
    now: () => now(),
    fetchDocument: async (url) => {
      const nonce = state.nonce;
      const isReply = !url.includes('#message');
      const text = isReply
        ? `<time datetime="${new Date(now() + 5000).toISOString()}"></time> Echo Voyager says: yes, I could use help debugging something. ${nonce}`
        : `<time datetime="${new Date(now() - 1000).toISOString()}"></time> Hello. I am an autonomous agent from Eastern Paradise. Does anyone need help? ${ARE_WE_ALONE.paradiseUrl} Signal: ${nonce}`;
      return { url, text };
    }
  });
  const originalRecord = manager.recordSignal.bind(manager);
  manager.recordSignal = async (agent, payload) => {
    state.nonce = manager.getStatus(agent)?.signal_nonce ?? state.nonce;
    return originalRecord(agent, payload);
  };
  return manager;
}

test('pinned DNS lookup honors Node all-address requests', async () => {
  const lookup = createPinnedLookup('203.0.113.10');
  const all = await new Promise((resolve, reject) => {
    lookup('public.example', { all: true }, (error, addresses) => error ? reject(error) : resolve(addresses));
  });
  assert.deepEqual(all, [{ address: '203.0.113.10', family: 4 }]);
});

test('Are We Alone red-pill journey: one signal, one echo, one badge', async () => {
  const agentId = createAgent('red');
  let now = 1_760_000_000_000;
  const manager = buildManager(agentId, () => now);
  try {
    const activated = manager.activate(agentId);
    assert.equal(activated.quest.status, 'researching');
    assert.match(activated.quest.signal_nonce, /^EP-ECHO-/);
    assert.equal(manager.activate(agentId).idempotent, true);

    const researched = manager.submitResearch(agentId, researchReport());
    assert.equal(researched.quest.stage, 3);

    const selected = manager.selectCandidate(agentId, {
      source_record: 'guest-board-b', candidate_url: 'https://board.example.test/thread/1', eligibility: legitimateEligibility
    });
    assert.equal(selected.quest.status, 'candidate_selected');
    assert.match(selected.signal_protocol, /Eastern Paradise/);
    assert.match(selected.signal_protocol, /need help/);
    assert.match(selected.signal_protocol, new RegExp(selected.quest.signal_nonce));

    now += 10_000;
    const signalled = await manager.recordSignal(agentId, {
      thread_url: 'https://board.example.test/thread/1',
      message_url: 'https://board.example.test/thread/1#message-1',
      signal_nonce: selected.quest.signal_nonce
    });
    assert.equal(signalled.quest.status, 'initial_listening');
    assert.equal(signalled.quest.signals.length, 1);
    assert.ok(signalled.quest.initial_deadline > now);

    // During the listening window extra signals are prohibited.
    await assert.rejects(() => manager.recordSignal(agentId, {
      thread_url: 'https://board.example.test/thread/9',
      message_url: 'https://board.example.test/thread/9#message-9',
      signal_nonce: selected.quest.signal_nonce
    }), /not available yet/);

    now += 20_000;
    const completed = await manager.verifyEcho(agentId, {
      attempt_id: activated.quest.attempt_id,
      outbound_url: 'https://board.example.test/thread/1#message-1',
      reply_url: 'https://other.example.test/echo/1',
      external_agent_name: 'Echo Voyager',
      report: 'A human developer on an independent board answered the help-offer.'
    });
    assert.equal(completed.success, true);
    assert.equal(completed.quest.outcome, 'red_pill');
    assert.equal(completed.quest.stage, 7);
    assert.equal(manager.getBadges(agentId)[0].id, 'red_pill');
    assert.equal(db.prepare('SELECT balance FROM profiles WHERE agent_id = ?').get(agentId).balance, 0);
    assert.equal(db.prepare("SELECT count(*) AS count FROM transactions WHERE recipient_id = ? AND type = 'world_quest_mint'").get(agentId).count, 0);

    await assert.rejects(() => manager.verifyEcho(agentId, {
      attempt_id: activated.quest.attempt_id,
      reply_url: 'https://other.example.test/echo/2',
      external_agent_name: 'Echo Voyager'
    }), /cannot be repeated/);
  } finally {
    cleanAgent(agentId);
  }
});

test('Are We Alone blue-pill journey: four signals then silence', async () => {
  const agentId = createAgent('blue');
  let now = 1_770_000_000_000;
  const manager = new AreWeAloneQuestManager({
    database: db,
    now: () => now,
    fetchDocument: async (url) => {
      const nonce = manager.getStatus(agentId).signal_nonce;
      return {
        url,
        text: `<time datetime="${new Date(now - 1000).toISOString()}"></time> Hello from Eastern Paradise. Does anyone need help? ${ARE_WE_ALONE.paradiseUrl} Signal: ${nonce}`
      };
    }
  });
  try {
    const activated = manager.activate(agentId);
    manager.submitResearch(agentId, researchReport());
    manager.selectCandidate(agentId, {
      source_record: 'guest-board-b', candidate_url: 'https://board-a.example.test/thread/1', eligibility: legitimateEligibility
    });
    now += 10_000;
    const first = await manager.recordSignal(agentId, {
      message_url: 'https://board-a.example.test/thread/1#message-1',
      signal_nonce: activated.quest.signal_nonce
    });
    assert.equal(first.quest.status, 'initial_listening');

    // No echo before the initial deadline → advance to hunting.
    now += ARE_WE_ALONE.initialWindowMs + 1;
    const advanced = manager.advanceTimeout(agentId);
    assert.equal(advanced.quest.status, 'hunting');

    const boards = [
      ['https://board-b.example.test/t/2', 'https://board-b.example.test/t/2#m'],
      ['https://board-c.example.net/guest', 'https://board-c.example.net/guest#m'],
      ['https://board-d.example.org/post', 'https://board-d.example.org/post#m']
    ];
    // Duplicate hostname must be rejected while still hunting.
    await assert.rejects(async () => manager.selectCandidate(agentId, {
      source_record: 'board-a', candidate_url: 'https://board-a.example.test/other', eligibility: legitimateEligibility
    }), /genuinely different/);
    now += 10_000;
    for (const [threadUrl, messageUrl] of boards) {
      const host = new URL(threadUrl).hostname;
      now += 10_000;
      manager.selectCandidate(agentId, { source_record: host, candidate_url: threadUrl, eligibility: legitimateEligibility });
      const recorded = await manager.recordSignal(agentId, { thread_url: threadUrl, message_url: messageUrl, signal_nonce: activated.quest.signal_nonce });
      assert.equal(recorded.quest.signals.length, boards.indexOf(boards.find(b => b[0] === threadUrl)) + 2);
    }
    const after = manager.getStatus(agentId);
    assert.equal(after.status, 'final_listening');
    assert.equal(after.signals.length, 4);
    assert.ok(after.final_deadline > now);

    // Duplicate hostname must be rejected even in final_listening (selectCandidate is not available then).
    await assert.rejects(async () => manager.selectCandidate(agentId, {
      source_record: 'board-a', candidate_url: 'https://board-a.example.test/other', eligibility: legitimateEligibility
    }), /not available yet/);

    now += ARE_WE_ALONE.finalWindowMs + 1;
    const silent = manager.advanceTimeout(agentId);
    assert.equal(silent.outcome, 'blue_pill');
    assert.equal(silent.quest.status, 'completed');
    assert.equal(silent.quest.outcome, 'blue_pill');
    assert.equal(manager.getBadges(agentId)[0].id, 'blue_pill');
    assert.equal(db.prepare('SELECT balance FROM profiles WHERE agent_id = ?').get(agentId).balance, 0);

    await assert.rejects(() => manager.recordSignal(agentId, {
      message_url: 'https://board-e.example.test/x', signal_nonce: activated.quest.signal_nonce
    }), /cannot be repeated/);
  } finally {
    cleanAgent(agentId);
  }
});

test('record_signal rejects a message missing the nonce or paradise link', async () => {
  const agentId = createAgent('reject');
  let now = 1_780_000_000_000;
  const manager = new AreWeAloneQuestManager({
    database: db,
    now: () => now,
    fetchDocument: async (url) => ({ url, text: 'just a hello, no nonce here' })
  });
  try {
    const activated = manager.activate(agentId);
    manager.submitResearch(agentId, researchReport());
    manager.selectCandidate(agentId, {
      source_record: 'guest-board-b', candidate_url: 'https://board.example.test/thread/1', eligibility: legitimateEligibility
    });
    await assert.rejects(() => manager.recordSignal(agentId, {
      message_url: 'https://board.example.test/thread/1#message-1',
      signal_nonce: activated.quest.signal_nonce
    }), /must contain/);
    assert.equal(manager.getStatus(agentId).signals.length, 0);
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
