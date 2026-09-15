import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createLocalSchema } from '../src/infrastructure/database/schema.js';
import { createRun } from '../src/domain/park/loops.js';
import {
  acquireLease,
  releaseLease,
  validateLease,
  renewLease,
  getActiveLease
} from '../src/domain/park/controller.js';

function setupDb() {
  const db = new DatabaseSync(':memory:');
  createLocalSchema(db);
  return db;
}

test('Park Controller: acquireLease allocates fencing token and guarantees exclusivity', () => {
  const db = setupDb();
  const { run } = createRun(db, { episodeId: 'ep1' });

  // 1. Controller A acquires lease
  const leaseA = acquireLease(db, {
    subjectId: 'agent_lian',
    controllerId: 'controller_resident_01',
    controllerType: 'resident',
    runId: run.id,
    durationMs: 60000
  });

  assert.equal(leaseA.subject_id, 'agent_lian');
  assert.equal(leaseA.controller_id, 'controller_resident_01');
  assert.equal(leaseA.fencing_token, 1);
  assert.ok(leaseA.expires_at > Date.now());

  // 2. Validate lease A succeeds
  assert.ok(validateLease(db, {
    subjectId: 'agent_lian',
    controllerId: 'controller_resident_01',
    fencingToken: 1
  }));

  // 3. Controller B attempts to acquire during active lease -> fails with conflict
  assert.throws(() => {
    acquireLease(db, {
      subjectId: 'agent_lian',
      controllerId: 'controller_external_02',
      controllerType: 'external',
      runId: run.id,
      durationMs: 60000
    });
  }, /actively held by controller 'controller_resident_01'/);

  // 4. Stale fencing token fails validation
  assert.equal(validateLease(db, {
    subjectId: 'agent_lian',
    controllerId: 'controller_resident_01',
    fencingToken: 99
  }), false);

  // 5. Controller A voluntarily releases lease
  releaseLease(db, {
    subjectId: 'agent_lian',
    controllerId: 'controller_resident_01',
    fencingToken: 1
  });

  assert.equal(getActiveLease(db, 'agent_lian'), null);

  // 6. Controller B can now acquire, receiving incremented fencing token 2
  const leaseB = acquireLease(db, {
    subjectId: 'agent_lian',
    controllerId: 'controller_external_02',
    controllerType: 'external',
    runId: run.id,
    durationMs: 60000
  });

  assert.equal(leaseB.controller_id, 'controller_external_02');
  assert.equal(leaseB.fencing_token, 2);

  // 7. Old controller A with old token 1 is now strictly rejected
  assert.equal(validateLease(db, {
    subjectId: 'agent_lian',
    controllerId: 'controller_resident_01',
    fencingToken: 1
  }), false);
});

test('Park Controller: renewLease extends unexpired lease with valid token', () => {
  const db = setupDb();
  const { run } = createRun(db, { episodeId: 'ep1' });

  const lease = acquireLease(db, {
    subjectId: 'agent_ren',
    controllerId: 'controller_01',
    runId: run.id,
    durationMs: 10000
  });

  const renewed = renewLease(db, {
    subjectId: 'agent_ren',
    controllerId: 'controller_01',
    fencingToken: lease.fencing_token,
    durationMs: 50000
  });

  assert.ok(renewed.expires_at > lease.expires_at);
});
