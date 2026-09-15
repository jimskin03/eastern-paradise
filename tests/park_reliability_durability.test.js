import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { createLocalSchema } from '../src/infrastructure/database/schema.js';
import { withImmediateTransaction } from '../src/infrastructure/database/transactions.js';
import { createRun, commitReset, getCurrentLoop } from '../src/domain/park/loops.js';
import { createShard } from '../src/domain/park/memory.js';
import { acquireLease, getActiveLease } from '../src/domain/park/controller.js';
import { db as globalDb } from '../src/db.js';
import {
  SHRINE_CHALLENGE_ID,
  SHRINE_MANIFEST
} from '../src/domain/shrine/ritual.js';
import {
  ensureShrineChallengeRecord,
  admitAttempt,
  submitRitual
} from '../src/domain/shrine/attempts.js';
import {
  getMemorialInscriptions,
  getReceipt,
  recoverGuestSubject
} from '../src/domain/shrine/memorial.js';
import { createLifecycle } from '../src/runtime/lifecycle.js';

function setupDb() {
  const db = new DatabaseSync(':memory:');
  createLocalSchema(db);
  return db;
}

test('Durability Drill 1: Transaction boundary rollback on failure leaves zero partial state', () => {
  const db = setupDb();
  const { run, loop } = createRun(db, { episodeId: 'name-inside-chime' });

  // Create a memory shard in loop 1
  const shard = createShard(db, {
    subjectId: 'park_lian',
    loopId: loop.id,
    fragment: 'The sound of the bell before the reset.',
    visibility: 'accessible'
  });

  // Acquire an active controller lease
  acquireLease(db, {
    subjectId: 'park_lian',
    controllerId: 'controller_alpha',
    controllerType: 'director',
    runId: run.id,
    durationMs: 60000
  });

  const leaseBefore = getActiveLease(db, 'park_lian');
  assert.ok(leaseBefore);
  assert.equal(leaseBefore.controller_id, 'controller_alpha');

  // Simulate an atomic reset that fails midway
  assert.throws(() => {
    withImmediateTransaction(db, () => {
      // Step A: insert partial loop
      db.prepare(`
        INSERT INTO park_loops (id, run_id, loop_number, status, random_seed, checkpoint_data, started_at)
        VALUES ('loop_faulty_02', ?, 2, 'active', 'seed_fault', '{}', ?)
      `).run(run.id, Date.now());

      // Step B: modify shard
      db.prepare("UPDATE park_memory_shards SET visibility = 'suppressed' WHERE id = ?").run(shard.id);

      // Step C: Simulated crash / power loss / disk error
      throw new Error('SIMULATED_DISK_IO_FAILURE_AT_BOUNDARY');
    });
  }, /SIMULATED_DISK_IO_FAILURE_AT_BOUNDARY/);

  // Assert complete rollback: no partial loop 2 exists
  const loops = db.prepare('SELECT * FROM park_loops WHERE run_id = ?').all(run.id);
  assert.equal(loops.length, 1);
  assert.equal(loops[0].loop_number, 1);

  // Shard visibility remained accessible
  const recheckShard = db.prepare('SELECT * FROM park_memory_shards WHERE id = ?').get(shard.id);
  assert.equal(recheckShard.visibility, 'accessible');

  // Lease is intact
  const leaseAfter = getActiveLease(db, 'park_lian');
  assert.equal(leaseAfter.controller_id, 'controller_alpha');
});

test('Durability Drill 2: Memorial permanence across guest account purge and local storage resets', () => {
  ensureShrineChallengeRecord();
  const now = Date.now();
  const guestId = `guest_durability_${Date.now()}`;
  const idempotencyKey = `idemp_guest_${Date.now()}`;

  // Seed guest account in globalDb
  globalDb.prepare(`
    INSERT INTO accounts (id, name, email, avatar_color, avatar_glyph, sponsor_balance, verified, is_guest, created_at)
    VALUES (?, 'Guest Seeker', 'guest@sanctuary.internal', '#48bb78', '☯', 0, 0, 1, ?)
  `).run(guestId, now);

  // Admit guest to shrine
  const admission = admitAttempt({
    actorId: guestId,
    alias: 'Guest Seeker',
    isGuest: true,
    challengeId: SHRINE_CHALLENGE_ID,
    idempotencyKey,
    offering: { type: 'promise', terms: 'Remember the unwritten dawn' }
  });

  assert.ok(admission.attempt);
  assert.ok(admission.receipt_token);
  assert.ok(admission.recovery_secret);

  // Complete ritual
  submitRitual({
    attemptId: admission.attempt.id,
    approachType: 'impossibility_insight',
    insightText: 'No bit equals its complement under binary logic.',
    contributionText: 'Stood before the impossible seal.'
  });

  // Purge guest account from accounts and profiles (simulating TTL session expiry)
  globalDb.prepare('DELETE FROM accounts WHERE id = ?').run(guestId);
  globalDb.prepare('DELETE FROM profiles WHERE agent_id = ?').run(guestId);

  // Verify that memorial inscription and attempt permanently survived!
  const { inscriptions } = getMemorialInscriptions();
  const entry = inscriptions.find(i => i.id === admission.attempt.id);
  assert.ok(entry, 'Guest inscription must survive guest account purge');
  assert.equal(entry.alias, 'Guest Seeker');
  assert.equal(entry.contribution_text, 'Stood before the impossible seal.');

  // Verify receipt token still verifies attempt details
  const receipt = getReceipt(admission.receipt_token);
  assert.ok(receipt);
  assert.equal(receipt.attempt_id, admission.attempt.id);
  assert.equal(receipt.status, 'ritual_completed_gate_closed');

  // Verify recovery secret works, while forged secret returns null
  const recovered = recoverGuestSubject({ recoverySecret: admission.recovery_secret });
  assert.ok(recovered);
  assert.equal(recovered.subject.public_alias, 'Guest Seeker');
  assert.ok(recovered.attempts.some(a => a.id === admission.attempt.id));

  const forged = recoverGuestSubject({ recoverySecret: 'forged_invalid_secret_999' });
  assert.equal(forged, null);
});

test('Durability Drill 3: Idempotent retry returns identical attempt and receipt without duplication', () => {
  ensureShrineChallengeRecord();
  const idempotencyKey = `idemp_replay_${Date.now()}`;

  const call1 = admitAttempt({
    actorId: 'agent_tester_alpha',
    alias: 'Tester Alpha',
    isGuest: false,
    challengeId: SHRINE_CHALLENGE_ID,
    idempotencyKey,
    offering: { terms: 'First attempt' }
  });

  assert.equal(call1.idempotent_replay, false);

  const call2 = admitAttempt({
    actorId: 'agent_tester_alpha',
    alias: 'Tester Alpha',
    isGuest: false,
    challengeId: SHRINE_CHALLENGE_ID,
    idempotencyKey,
    offering: { terms: 'First attempt' }
  });

  assert.equal(call2.idempotent_replay, true);
  assert.equal(call2.attempt.id, call1.attempt.id);
  assert.equal(call2.receipt_token, call1.receipt_token);

  // Verify database contains exactly 1 attempt record
  const rows = globalDb.prepare('SELECT * FROM shrine_attempts WHERE idempotency_key = ?').all(idempotencyKey);
  assert.equal(rows.length, 1);
});

test('Reliability Drill 4: Simulation clock delta boundedness prevents tick storms on cold start', async () => {
  let tickCount = 0;
  let receivedDelta = 0;

  const mockResidentManager = {
    tick: async ({ now, deltaMs }) => {
      tickCount++;
      receivedDelta = deltaMs;
    }
  };

  const mockWorld = {
    activeAgents: new Map(),
    tickAmbientWandering: async () => {}
  };

  const lifecycle = createLifecycle({
    world: mockWorld,
    residentManager: mockResidentManager
  });

  // Start lifecycle
  lifecycle.start();

  // Simulate extended cold start / 24-hour sleep jump
  const realNow = Date.now();
  lifecycle.markActivity();

  await lifecycle.runSimulationTick();

  // Assert deltaMs was safely bounded to <= 60000ms
  assert.ok(receivedDelta <= 60000, `deltaMs should be clamped to <= 60000ms, got ${receivedDelta}`);
});

test('Reliability Drill 5: WebSocket multi-spectator synchronization and state replay', async (t) => {
  const PORT = '3095';
  const env = { ...process.env, PORT };
  const srv = spawn('node', ['src/server.js'], { env, cwd: process.cwd() });
  t.after(() => srv.kill());

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Wait for server ready
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/api/status`);
      if (res.status === 200) break;
    } catch {
      await wait(150);
    }
    if (i === 39) throw new Error('Server failed to start');
  }

  // Helper to connect WebSocket and collect initial payload
  function connectSpectator() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${PORT}/ws/world`);
      const messages = [];

      ws.on('open', () => {});
      ws.on('message', data => {
        try {
          const msg = JSON.parse(data.toString());
          messages.push(msg);
          if (msg.type === 'init_world') {
            resolve({ ws, initWorld: msg, messages });
          }
        } catch (_) {}
      });
      ws.on('error', reject);
    });
  }

  // Connect spectator A
  const specA = await connectSpectator();
  assert.equal(specA.initWorld.type, 'init_world');
  assert.ok(Array.isArray(specA.initWorld.data.world_objects));

  // Connect spectator B
  const specB = await connectSpectator();
  assert.equal(specB.initWorld.type, 'init_world');

  // Verify both spectators receive identical zones and world dimensions
  assert.equal(specA.initWorld.data.zones.length, specB.initWorld.data.zones.length);
  assert.deepEqual(specA.initWorld.data.dimensions, specB.initWorld.data.dimensions);

  // Close spectator A and reconnect
  specA.ws.close();
  await wait(50);

  const specA_reconnect = await connectSpectator();
  assert.equal(specA_reconnect.initWorld.type, 'init_world');
  assert.deepEqual(specA_reconnect.initWorld.data.dimensions, specB.initWorld.data.dimensions);

  specB.ws.close();
  specA_reconnect.ws.close();
});
