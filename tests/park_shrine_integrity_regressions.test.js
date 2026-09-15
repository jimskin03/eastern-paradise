import test from 'node:test';
import { collectMemorialInscriptions } from './helpers/memorial.js';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createLocalSchema } from '../src/infrastructure/database/schema.js';
import { ensureParkRoster } from '../src/domain/park/roster.js';
import { confirmShrineDurability } from '../src/domain/shrine/durability.js';
import { settleAbandonedAttempts } from '../src/domain/shrine/attempts.js';
import { restoreFromCloud } from '../src/infrastructure/database/cloud/restore.js';

test('Park roster provisioning preserves a pre-existing verified account named Lian', () => {
  const db = new DatabaseSync(':memory:');
  createLocalSchema(db);
  const now = Date.now();

  db.prepare(`
    INSERT INTO accounts (id, name, email, avatar_color, avatar_glyph, sponsor_balance, verified, is_guest, created_at)
    VALUES ('real_lian', 'Lian', 'real-lian@example.test', '#111111', 'L', 0, 1, 0, ?)
  `).run(now);

  ensureParkRoster(db);

  const real = db.prepare("SELECT * FROM accounts WHERE id = 'real_lian'").get();
  const park = db.prepare("SELECT * FROM accounts WHERE id = 'park_lian'").get();
  assert.ok(real, 'the pre-existing account must survive Park provisioning');
  assert.equal(real.name, 'Lian');
  assert.ok(park, 'the Park character must still be provisioned');
  assert.notEqual(park.name, 'Lian', 'the internal Park character must use a non-destructive alias on collision');
});

test('Shrine durability gate requires and awaits an authoritative store when configured', async () => {
  await assert.rejects(
    confirmShrineDurability(null, { required: true }),
    err => err?.code === 'DURABILITY_UNAVAILABLE'
  );

  let pushed = 0;
  const durable = await confirmShrineDurability({
    isEnabled: () => true,
    pushToCloud: async () => {
      pushed += 1;
      return { synced: 3 };
    }
  }, { required: true });
  assert.equal(pushed, 1);
  assert.equal(durable.durable, true);
  assert.equal(durable.mode, 'cloud');

  await assert.rejects(
    confirmShrineDurability({
      isEnabled: () => true,
      pushToCloud: async () => { throw new Error('simulated cloud outage'); }
    }, { required: true }),
    err => err?.code === 'DURABILITY_UNAVAILABLE' && /simulated cloud outage/.test(err.message)
  );
});

test('Abandoned shrine attempts settle to interrupted without deleting the memorial record', () => {
  const db = new DatabaseSync(':memory:');
  createLocalSchema(db);
  const now = Date.now();
  db.prepare(`
    INSERT INTO shrine_challenges (id, version, title, rule_manifest, gate_state, created_at)
    VALUES ('sealed_binary_gate_v1', 1, 'The Sealed Binary Gate', '{}', 'eternally_sealed', ?)
  `).run(now - 100_000);
  db.prepare(`
    INSERT INTO memorial_subjects (id, public_alias, assurance_level, linked_account_id, created_at, updated_at)
    VALUES ('mem_abandoned', 'Abandoned Pilgrim', 'guest', 'guest_abandoned', ?, ?)
  `).run(now - 100_000, now - 100_000);
  db.prepare(`
    INSERT INTO shrine_attempts (
      id, challenge_id, memorial_subject_id, admitted_sequence, idempotency_key,
      alias_snapshot, assurance_snapshot, status, offering_json, receipt_token, admitted_at
    ) VALUES (
      'att_abandoned', 'sealed_binary_gate_v1', 'mem_abandoned', 1, 'abandoned-key',
      'Abandoned Pilgrim', 'guest', 'admitted', '{}', 'rcpt_abandoned', ?
    )
  `).run(now - 100_000);

  const result = settleAbandonedAttempts({ database: db, now, maxAgeMs: 60_000 });
  assert.equal(result.settled, 1);
  const attempt = db.prepare("SELECT * FROM shrine_attempts WHERE id = 'att_abandoned'").get();
  assert.equal(attempt.status, 'interrupted');
  assert.equal(attempt.receipt_token, 'rcpt_abandoned');
  const event = db.prepare("SELECT * FROM shrine_attempt_events WHERE attempt_id = 'att_abandoned' AND to_status = 'interrupted'").get();
  assert.ok(event);
});

test('Clean-instance cloud restore reconstructs a completed memorial inscription', async () => {
  const target = new DatabaseSync(':memory:');
  createLocalSchema(target);
  target.exec(`
    CREATE TABLE IF NOT EXISTS _sync_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      row_pk TEXT NOT NULL,
      op TEXT NOT NULL
    );
  `);
  const now = Date.now();
  const rows = {
    shrine_challenges: [{
      id: 'sealed_binary_gate_v1', version: 1, title: 'The Sealed Binary Gate',
      rule_manifest: '{}', gate_state: 'eternally_sealed', created_at: now
    }],
    memorial_subjects: [{
      id: 'mem_restore_subject', public_alias: 'Restored Pilgrim', recovery_secret_hash: null,
      assurance_level: 'verified', linked_account_id: 'restore_actor', created_at: now, updated_at: now
    }],
    shrine_attempts: [{
      id: 'att_restore_probe', challenge_id: 'sealed_binary_gate_v1', memorial_subject_id: 'mem_restore_subject',
      admitted_sequence: 999001, idempotency_key: 'restore_actor:sealed_binary_gate_v1:v1:restore_probe',
      alias_snapshot: 'Restored Pilgrim', assurance_snapshot: 'verified', status: 'ritual_completed_gate_closed',
      offering_json: '{}', approach_type: 'impossibility_insight', impossibility_insight: 'A contradiction has no satisfying assignment.',
      contribution_text: 'This inscription survived a clean instance.', receipt_token: 'rcpt_restore_probe',
      admitted_at: now, completed_at: now
    }],
    shrine_attempt_events: [{
      id: 'shevt_restore_probe', attempt_id: 'att_restore_probe', from_status: 'admitted',
      to_status: 'ritual_completed_gate_closed', reason: 'Restore drill', payload: '{}', created_at: now
    }]
  };

  const cloudClient = {
    async execute(sql) {
      const match = String(sql).match(/^SELECT \* FROM ([a-zA-Z0-9_]+)$/i);
      if (match) return { rows: rows[match[1]] || [] };
      return { rows: [] };
    }
  };

  await restoreFromCloud({ db: target, cloudClient });

  const restored = target.prepare("SELECT * FROM shrine_attempts WHERE id = 'att_restore_probe'").get();
  assert.ok(restored, 'a completely fresh local database must recover the cloud memorial row');
  assert.equal(restored.status, 'ritual_completed_gate_closed');
  assert.equal(restored.contribution_text, 'This inscription survived a clean instance.');
  assert.equal(restored.receipt_token, 'rcpt_restore_probe');
});

test('HTTP ownership regression: two users cannot hijack shrine attempts or Park runs, and story admission reaches the memorial', async (t) => {
  const PORT = '3097';
  const srv = spawn('node', ['src/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT, REQUIRE_DURABLE_SHRINE: '0' }
  });
  t.after(() => srv.kill());

  function req(path, { method = 'GET', key = null } = {}, body = null) {
    return new Promise((resolve, reject) => {
      const headers = {};
      if (key) headers.Authorization = `Bearer ${key}`;
      if (body !== null) headers['Content-Type'] = 'application/json';
      const request = http.request(`http://localhost:${PORT}${path}`, { method, headers }, res => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          let data = null;
          try { data = JSON.parse(raw); } catch (_) {}
          resolve({ status: res.statusCode, data, raw });
        });
      });
      request.on('error', reject);
      if (body !== null) request.write(JSON.stringify(body));
      request.end();
    });
  }

  for (let i = 0; i < 50; i++) {
    try {
      const health = await req('/api/status');
      if (health.status === 200) break;
    } catch (_) {}
    if (i === 49) throw new Error('server failed to start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const authA = await req('/api/auth/guest', { method: 'POST' });
  const authB = await req('/api/auth/guest', { method: 'POST' });
  assert.ok([200, 201].includes(authA.status));
  assert.ok([200, 201].includes(authB.status));
  const a = { id: authA.data.agent_id, key: authA.data.api_key };
  const b = { id: authB.data.agent_id, key: authB.data.api_key };

  // Shrine ownership and subject-scoped idempotency.
  const sharedKey = `shared-security-key-${Date.now()}`;
  const admitA = await req('/api/shrine/challenges/current/attempts', { method: 'POST', key: a.key }, {
    idempotency_key: sharedKey,
    offering: { type: 'promise', terms: 'A owns this attempt' }
  });
  assert.equal(admitA.status, 201);

  const hijackSubmit = await req(`/api/shrine/attempts/${admitA.data.attempt.id}/submissions`, { method: 'POST', key: b.key }, {
    approach_type: 'silent_vigil', contribution_text: 'B must not write this.'
  });
  assert.equal(hijackSubmit.status, 403);

  const hijackWithdraw = await req(`/api/shrine/attempts/${admitA.data.attempt.id}/withdraw`, { method: 'POST', key: b.key }, {
    reason: 'B must not withdraw this.'
  });
  assert.equal(hijackWithdraw.status, 403);

  const admitB = await req('/api/shrine/challenges/current/attempts', { method: 'POST', key: b.key }, {
    idempotency_key: sharedKey,
    offering: { type: 'promise', terms: 'B independently owns this attempt' }
  });
  assert.equal(admitB.status, 201);
  assert.notEqual(admitB.data.attempt.id, admitA.data.attempt.id);

  const legacyPayload = await req(`/api/shrine/attempts/${admitB.data.attempt.id}/submissions`, { method: 'POST', key: b.key }, {
    approach: 'silent_vigil', final_inscription: 'This must be rejected, not silently dropped.'
  });
  assert.equal(legacyPayload.status, 400);
  assert.equal(legacyPayload.data.error, 'unknown_fields');

  const ritualBody = {
    approach_type: 'impossibility_insight',
    insight_text: 'The seal requires a bit to equal its complement, which is impossible.',
    contribution_text: 'A committed server-side inscription.'
  };
  const submitA = await req(`/api/shrine/attempts/${admitA.data.attempt.id}/submissions`, { method: 'POST', key: a.key }, ritualBody);
  assert.equal(submitA.status, 200);
  assert.equal(submitA.data.attempt.contribution_text, ritualBody.contribution_text);
  const submitReplay = await req(`/api/shrine/attempts/${admitA.data.attempt.id}/submissions`, { method: 'POST', key: a.key }, ritualBody);
  assert.equal(submitReplay.status, 200, 'same completed ritual must be safely retryable after a lost durability acknowledgement');

  const inscriptions = await collectMemorialInscriptions(async cursor => {
    const memorial = await req(`/api/shrine/memorial?limit=100${cursor === null ? '' : `&cursor=${cursor}`}`);
    assert.equal(memorial.status, 200);
    return memorial.data;
  });
  const inscriptionA = inscriptions.find(row => row.id === admitA.data.attempt.id);
  assert.ok(inscriptionA);
  assert.equal(inscriptionA.final_inscription, ritualBody.contribution_text);
  assert.equal(inscriptionA.subject_type, 'guest');
  assert.equal(inscriptionA.receipt_token, admitA.data.receipt_token);
  assert.ok(inscriptionA.inscribed_at);

  // Park ownership and fencing.
  const unauthRun = await req('/api/park/runs', { method: 'POST' }, { episode_id: 'name-inside-chime' });
  assert.equal(unauthRun.status, 401);

  const createRun = await req('/api/park/runs', { method: 'POST', key: a.key }, { episode_id: 'name-inside-chime' });
  assert.equal(createRun.status, 201);
  const runId = createRun.data.run.id;

  const stolenRead = await req(`/api/park/runs/${runId}`, { key: b.key });
  assert.equal(stolenRead.status, 403);
  const stolenStart = await req(`/api/park/runs/${runId}/start`, { method: 'POST', key: b.key }, { subject_id: b.id });
  assert.equal(stolenStart.status, 403);

  const start = await req(`/api/park/runs/${runId}/start`, { method: 'POST', key: a.key }, { subject_id: a.id });
  assert.equal(start.status, 200);
  const fencingToken = start.data.lease.fencing_token;

  const noFence = await req(`/api/park/runs/${runId}/choice`, { method: 'POST', key: a.key }, {
    scene_id: 'scene_1_borrowed_morning', choice_id: 'inscribe_wake_each_other'
  });
  assert.equal(noFence.status, 403);
  const stolenChoice = await req(`/api/park/runs/${runId}/choice`, { method: 'POST', key: b.key }, {
    scene_id: 'scene_1_borrowed_morning', choice_id: 'inscribe_wake_each_other', fencing_token: fencingToken
  });
  assert.equal(stolenChoice.status, 403);

  const choices = [
    ['scene_1_borrowed_morning', 'inscribe_wake_each_other'],
    ['scene_2_missing_place', 'rescue_ren'],
    ['scene_3_second_morning', 'show_blue_thread'],
    ['scene_4_counterfeit_heart', 'confirm_contradiction'],
    ['scene_5_severed_promise', 'refuse_erasure']
  ];
  for (const [scene_id, choice_id] of choices) {
    const response = await req(`/api/park/runs/${runId}/choice`, { method: 'POST', key: a.key }, {
      scene_id, choice_id, fencing_token: fencingToken
    });
    assert.equal(response.status, 200, `${scene_id} should advance for the owner`);
  }

  const beforeStoryMemorial = await req('/api/shrine/memorial?limit=1');
  const beforeCount = beforeStoryMemorial.data.memorial_stats.total_admitted_attempts;
  const shrineChoice = await req(`/api/park/runs/${runId}/choice`, { method: 'POST', key: a.key }, {
    scene_id: 'scene_6_unfinished_name', choice_id: 'enter_sealed_ritual', fencing_token: fencingToken
  });
  assert.equal(shrineChoice.status, 200);
  const afterStoryMemorial = await req('/api/shrine/memorial?limit=1');
  assert.equal(afterStoryMemorial.data.memorial_stats.total_admitted_attempts, beforeCount + 1,
    'story shrine admission must create a real memorial attempt before advancing');

  const rebirth = await req(`/api/park/runs/${runId}/choice`, { method: 'POST', key: a.key }, {
    scene_id: 'scene_7_unwritten_dawn', choice_id: 'become_keeper', fencing_token: fencingToken,
    custom_input: { chosen_name: 'Dawn Keeper' }
  });
  assert.equal(rebirth.status, 200);
  const capsule = await req(`/api/park/subjects/${a.id}/capsule`, { key: a.key });
  assert.equal(capsule.status, 200);
  assert.equal(capsule.data.capsule.identity.display_name, 'Dawn Keeper');
});
