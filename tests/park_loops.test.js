import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createLocalSchema } from '../src/infrastructure/database/schema.js';
import {
  createRun,
  getRun,
  getCurrentLoop,
  getRunHistory,
  commitReset,
  completeLoop,
  completeRun,
  recoverIncompleteReset
} from '../src/domain/park/loops.js';
import { createShard, retrieveShards } from '../src/domain/park/memory.js';
import { createPromise, getActivePromises, getDormantPromises } from '../src/domain/park/promises.js';

function setupDb() {
  const db = new DatabaseSync(':memory:');
  createLocalSchema(db);
  return db;
}

test('Park Loops: createRun initializes run and first loop atomically', () => {
  const db = setupDb();
  const { run, loop } = createRun(db, {
    episodeId: 'name-inside-chime',
    scenarioVersion: 1,
    seed: 'test_seed_42'
  });

  assert.ok(run.id.startsWith('run_'));
  assert.equal(run.episode_id, 'name-inside-chime');
  assert.equal(run.scenario_version, 1);
  assert.equal(run.status, 'active');
  assert.equal(run.random_seed, 'test_seed_42');

  assert.ok(loop.id.startsWith('loop_'));
  assert.equal(loop.run_id, run.id);
  assert.equal(loop.loop_number, 1);
  assert.equal(loop.status, 'active');
  assert.equal(loop.random_seed, 'test_seed_42');

  const current = getCurrentLoop(db, run.id);
  assert.equal(current.id, loop.id);
  assert.equal(current.loop_number, 1);
});

test('Park Loops: commitReset executes atomic transition with memory suppression and promise dormancy', () => {
  const db = setupDb();
  const { run, loop: loop1 } = createRun(db, { episodeId: 'name-inside-chime' });

  // Add memory shards to loop 1
  const shard1 = createShard(db, {
    subjectId: 'agent_lian',
    loopId: loop1.id,
    fragment: 'A blue knot on the bell cord.',
    cueTags: ['bell', 'blue_knot'],
    salience: 0.9,
    retentionReason: 'chosen_promise'
  });

  const shard2 = createShard(db, {
    subjectId: 'agent_lian',
    loopId: loop1.id,
    fragment: 'The morning tea was cold.',
    cueTags: ['tea', 'hearth'],
    salience: 0.3
  });

  // Add active promise in loop 1
  const promise1 = createPromise(db, {
    promisorId: 'agent_lian',
    terms: 'Tend the chimes at dusk',
    loopId: loop1.id
  });

  // Execute reset retaining shard1
  const resetResult = commitReset(db, {
    runId: run.id,
    currentLoopId: loop1.id,
    checkpointData: { cause: 'bell_fell', tick: 1200 },
    retainedShardIds: [shard1.id]
  });

  assert.equal(resetResult.previousLoopId, loop1.id);
  assert.equal(resetResult.newLoop.loop_number, 2);
  assert.equal(resetResult.newLoop.status, 'active');

  // Verify loop 1 is now 'reset'
  const history = getRunHistory(db, run.id);
  assert.equal(history.length, 2);
  assert.equal(history[0].status, 'reset');
  assert.equal(history[0].checkpoint_data.cause, 'bell_fell');
  assert.equal(history[1].status, 'active');
  assert.equal(history[1].loop_number, 2);

  // Verify memory visibility: shard1 retained (accessible), shard2 suppressed
  const s1 = db.prepare('SELECT * FROM park_memory_shards WHERE id = ?').get(shard1.id);
  const s2 = db.prepare('SELECT * FROM park_memory_shards WHERE id = ?').get(shard2.id);
  assert.equal(s1.visibility, 'accessible');
  assert.equal(s2.visibility, 'suppressed');

  // Verify promise transitioned to dormant
  const p1 = db.prepare('SELECT * FROM park_promises WHERE id = ?').get(promise1.id);
  assert.equal(p1.status, 'dormant');
  assert.equal(getActivePromises(db, { promisorId: 'agent_lian' }).length, 0);
  assert.equal(getDormantPromises(db, 'agent_lian').length, 1);
});

test('Park Loops: crash recovery resumes incomplete checkpoint loop', () => {
  const db = setupDb();
  const { run, loop } = createRun(db, { episodeId: 'name-inside-chime' });

  // Simulate process interrupt after checkpointing loop
  db.prepare("UPDATE park_loops SET status = 'checkpoint', checkpoint_data = '{\"paused\": true}' WHERE id = ?").run(loop.id);

  const recovered = recoverIncompleteReset(db, run.id);
  assert.ok(recovered);
  assert.equal(recovered.previousLoopId, loop.id);
  assert.equal(recovered.newLoop.loop_number, 2);
  assert.equal(recovered.newLoop.status, 'active');
});

test('Park Loops: completeRun marks run and loops completed', () => {
  const db = setupDb();
  const { run, loop } = createRun(db, { episodeId: 'name-inside-chime' });

  completeRun(db, run.id);

  const updatedRun = getRun(db, run.id);
  assert.equal(updatedRun.status, 'completed');
  assert.ok(updatedRun.completed_at > 0);

  const updatedLoop = db.prepare('SELECT * FROM park_loops WHERE id = ?').get(loop.id);
  assert.equal(updatedLoop.status, 'completed');
});
