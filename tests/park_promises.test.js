import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createLocalSchema } from '../src/infrastructure/database/schema.js';
import { createRun, commitReset } from '../src/domain/park/loops.js';
import {
  createPromise,
  getActivePromises,
  getDormantPromises,
  rediscoverPromise,
  resolvePromise,
  getPromiseHistory
} from '../src/domain/park/promises.js';
import { retrieveShards } from '../src/domain/park/memory.js';

function setupDb() {
  const db = new DatabaseSync(':memory:');
  createLocalSchema(db);
  return db;
}

test('Park Promises: promise creation and anchoring', () => {
  const db = setupDb();
  const { loop } = createRun(db, { episodeId: 'ep1' });

  const promise = createPromise(db, {
    promisorId: 'agent_lian',
    beneficiaryId: 'agent_ren',
    anchorObject: 'blue_thread',
    terms: 'Bring medicine across the river before sunrise',
    loopId: loop.id
  });

  assert.ok(promise.id.startsWith('prm_'));
  assert.equal(promise.promisor_id, 'agent_lian');
  assert.equal(promise.beneficiary_id, 'agent_ren');
  assert.equal(promise.anchor_object, 'blue_thread');
  assert.equal(promise.status, 'active');

  const active = getActivePromises(db, { promisorId: 'agent_lian' });
  assert.equal(active.length, 1);
  assert.equal(active[0].id, promise.id);
});

test('Park Promises: reset sets promises to dormant; rediscovery restores awareness and creates shard', () => {
  const db = setupDb();
  const { run, loop: loop1 } = createRun(db, { episodeId: 'ep1' });

  const promise = createPromise(db, {
    promisorId: 'agent_lian',
    anchorObject: 'wind_chimes',
    terms: 'Tune the chime cords so the third note rings clear',
    loopId: loop1.id
  });

  // Execute reset to loop 2
  const resetResult = commitReset(db, {
    runId: run.id,
    currentLoopId: loop1.id
  });
  const loop2 = resetResult.newLoop;

  // Verify promise is now dormant
  const dormant = getDormantPromises(db, 'agent_lian');
  assert.equal(dormant.length, 1);
  assert.equal(dormant[0].id, promise.id);
  assert.equal(dormant[0].status, 'dormant');

  // Rediscover promise upon inspecting wind_chimes
  const { promise: rediscovered, shard } = rediscoverPromise(db, {
    promiseId: promise.id,
    currentLoopId: loop2.id
  });

  assert.equal(rediscovered.status, 'rediscovered');
  assert.ok(shard);
  assert.equal(shard.source_kind, 'promise_anchor');
  assert.equal(shard.visibility, 'recovered');
  assert.match(shard.fragment, /Tune the chime cords/);

  // Verify memory shard is retrieved by anchor cue
  const shards = retrieveShards(db, {
    subjectId: 'agent_lian',
    cueTags: ['wind_chimes']
  });
  assert.equal(shards.length, 1);
  assert.equal(shards[0].id, shard.id);
});

test('Park Promises: resolvePromise updates terminal status and resolved_at', () => {
  const db = setupDb();
  const { loop } = createRun(db, { episodeId: 'ep1' });

  const promise = createPromise(db, {
    promisorId: 'agent_ren',
    terms: 'Keep the ferry tied until the bell tolls',
    loopId: loop.id
  });

  const resolved = resolvePromise(db, {
    promiseId: promise.id,
    status: 'fulfilled'
  });

  assert.equal(resolved.status, 'fulfilled');
  assert.ok(resolved.resolved_at > 0);

  const history = getPromiseHistory(db, 'agent_ren');
  assert.equal(history.length, 1);
  assert.equal(history[0].status, 'fulfilled');
});
