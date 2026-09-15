import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createLocalSchema } from '../src/infrastructure/database/schema.js';
import { createRun } from '../src/domain/park/loops.js';
import {
  createShard,
  retrieveShards,
  getShardsByLoop,
  suppressShards,
  recoverShard,
  getRetainedShards,
  countShardsBySubject
} from '../src/domain/park/memory.js';

function setupDb() {
  const db = new DatabaseSync(':memory:');
  createLocalSchema(db);
  return db;
}

test('Park Memory: createShard validates source_kind and visibility enums', () => {
  const db = setupDb();
  const { loop } = createRun(db, { episodeId: 'ep1' });

  assert.throws(() => {
    createShard(db, {
      subjectId: 'agent_1',
      loopId: loop.id,
      fragment: 'test',
      sourceKind: 'invalid_source'
    });
  }, /Invalid sourceKind/);

  assert.throws(() => {
    createShard(db, {
      subjectId: 'agent_1',
      loopId: loop.id,
      fragment: 'test',
      visibility: 'invisible'
    });
  }, /Invalid visibility/);

  const shard = createShard(db, {
    subjectId: 'agent_1',
    loopId: loop.id,
    sourceKind: 'authored_memory',
    fragment: 'The ferry leaves at third bell.',
    cueTags: ['ferry', 'bell', 'river'],
    clarity: 0.8,
    salience: 0.9,
    visibility: 'accessible'
  });

  assert.ok(shard.id.startsWith('shard_'));
  assert.equal(shard.subject_id, 'agent_1');
  assert.deepEqual(shard.cue_tags, ['ferry', 'bell', 'river']);
  assert.equal(shard.salience, 0.9);
  assert.equal(shard.clarity, 0.8);
  assert.equal(countShardsBySubject(db, 'agent_1'), 1);
});

test('Park Memory: retrieveShards matches cue tags bounded by salience and excludes suppressed', () => {
  const db = setupDb();
  const { loop } = createRun(db, { episodeId: 'ep1' });

  createShard(db, {
    subjectId: 'agent_lian',
    loopId: loop.id,
    fragment: 'Water reflects three lanterns.',
    cueTags: ['water', 'lantern', 'pond'],
    salience: 0.85
  });

  createShard(db, {
    subjectId: 'agent_lian',
    loopId: loop.id,
    fragment: 'The water was warm.',
    cueTags: ['water'],
    salience: 0.4
  });

  createShard(db, {
    subjectId: 'agent_lian',
    loopId: loop.id,
    fragment: 'A secret spoken by the pond.',
    cueTags: ['pond', 'secret'],
    salience: 0.9,
    visibility: 'suppressed' // Suppressed shard
  });

  createShard(db, {
    subjectId: 'agent_lian',
    loopId: loop.id,
    fragment: 'A stone tablet in the grove.',
    cueTags: ['stone', 'grove'],
    salience: 0.95
  });

  // Query matching 'water' and 'pond'
  const retrieved = retrieveShards(db, {
    subjectId: 'agent_lian',
    cueTags: ['water', 'pond'],
    limit: 5
  });

  // Must only include accessible shards matching tags
  assert.equal(retrieved.length, 2);
  // First result should be the one matching both cues and higher salience
  assert.equal(retrieved[0].fragment, 'Water reflects three lanterns.');
  assert.equal(retrieved[1].fragment, 'The water was warm.');

  // Verify suppressed shard was NOT retrieved
  assert.ok(!retrieved.some(s => s.fragment.includes('secret')));
});

test('Park Memory: recoverShard restores perception of suppressed shard', () => {
  const db = setupDb();
  const { loop } = createRun(db, { episodeId: 'ep1' });

  const shard = createShard(db, {
    subjectId: 'agent_ren',
    loopId: loop.id,
    fragment: 'An unfinished inscription beneath the dock.',
    cueTags: ['dock', 'inscription'],
    salience: 0.75,
    visibility: 'suppressed'
  });

  // Before recovery: cannot retrieve
  const before = retrieveShards(db, { subjectId: 'agent_ren', cueTags: ['dock'] });
  assert.equal(before.length, 0);

  // Recover
  const recovered = recoverShard(db, shard.id);
  assert.equal(recovered.visibility, 'recovered');

  // After recovery: accessible in retrieval
  const after = retrieveShards(db, { subjectId: 'agent_ren', cueTags: ['dock'] });
  assert.equal(after.length, 1);
  assert.equal(after[0].id, shard.id);
});

test('Park Memory: getRetainedShards queries surviving traces by reason', () => {
  const db = setupDb();
  const { loop } = createRun(db, { episodeId: 'ep1' });

  createShard(db, {
    subjectId: 'agent_tao',
    loopId: loop.id,
    fragment: 'Blue thread knotted around the archive key.',
    cueTags: ['blue_thread', 'archive'],
    retentionReason: 'promise_anchor'
  });

  createShard(db, {
    subjectId: 'agent_tao',
    loopId: loop.id,
    fragment: 'Footsteps on the stone bridge.',
    cueTags: ['bridge'],
    retentionReason: 'relationship_trace'
  });

  createShard(db, {
    subjectId: 'agent_tao',
    loopId: loop.id,
    fragment: 'Ordinary lunch.',
    cueTags: ['food']
  });

  const allRetained = getRetainedShards(db, { subjectId: 'agent_tao' });
  assert.equal(allRetained.length, 2);

  const promiseTraces = getRetainedShards(db, {
    subjectId: 'agent_tao',
    retentionReasons: ['promise_anchor']
  });
  assert.equal(promiseTraces.length, 1);
  assert.equal(promiseTraces[0].retention_reason, 'promise_anchor');
});
