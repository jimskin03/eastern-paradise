import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createLocalSchema } from '../src/infrastructure/database/schema.js';
import { createRun } from '../src/domain/park/loops.js';
import {
  createBelief,
  addEvidence,
  reviseBelief,
  getBeliefs,
  getBeliefHistory,
  assessConfidence
} from '../src/domain/park/beliefs.js';

function setupDb() {
  const db = new DatabaseSync(':memory:');
  createLocalSchema(db);
  return db;
}

test('Park Beliefs: createBelief links evidence and initializes revision 1', () => {
  const db = setupDb();
  const { loop } = createRun(db, { episodeId: 'ep1' });

  const belief = createBelief(db, {
    subjectId: 'agent_lian',
    statement: 'The wind chimes ring on their own when the wind rises.',
    confidence: 0.9,
    loopId: loop.id,
    sourceDescription: 'Personal observation at the pavilion',
    evidence: [
      { evidenceId: 'obs_chime_sound_01', relation: 'supports', isIndependent: true }
    ]
  });

  assert.ok(belief.id.startsWith('blf_'));
  assert.equal(belief.subject_id, 'agent_lian');
  assert.equal(belief.revision_number, 1);
  assert.equal(belief.status, 'held');
  assert.equal(belief.confidence, 0.9);
  assert.equal(belief.evidence.length, 1);
  assert.equal(belief.evidence[0].evidence_id, 'obs_chime_sound_01');
});

test('Park Beliefs: source independence prevents planted rumor from counting as independent confirmations', () => {
  const db = setupDb();
  const { loop } = createRun(db, { episodeId: 'ep1' });

  const belief = createBelief(db, {
    subjectId: 'agent_tao',
    statement: 'The archive records are complete.',
    confidence: 0.8,
    loopId: loop.id
  });

  // Independent evidence: official stamp
  addEvidence(db, {
    beliefId: belief.id,
    evidenceId: 'ev_official_stamp',
    relation: 'supports',
    isIndependent: true
  });

  // Non-independent evidence: visitor hearsay (first hearing)
  addEvidence(db, {
    beliefId: belief.id,
    evidenceId: 'ev_planted_hearsay',
    relation: 'supports',
    isIndependent: false
  });

  // Same non-independent evidence: another visitor repeating the identical planted account
  addEvidence(db, {
    beliefId: belief.id,
    evidenceId: 'ev_planted_hearsay',
    relation: 'supports',
    isIndependent: false
  });

  const assessed = assessConfidence(db, belief.id);
  // ev_official_stamp weight = 1.0
  // ev_planted_hearsay has source_count = 2, so weight = 1/2 = 0.5
  // Total supporting = 1.5
  assert.equal(assessed.independentSources, 1);
  assert.equal(assessed.supportingWeight, 1.5);
  assert.equal(assessed.contradictingWeight, 0);
  assert.equal(assessed.netConfidence, 1.0);
});

test('Park Beliefs: reviseBelief records explicit successor and traces lineage', () => {
  const db = setupDb();
  const { loop } = createRun(db, { episodeId: 'ep1' });

  // Initial belief
  const initial = createBelief(db, {
    subjectId: 'agent_ren',
    statement: 'The river gate opens only on the solstice.',
    confidence: 0.9,
    loopId: loop.id
  });

  // Revision 2: questioned by contradiction
  const revision2 = reviseBelief(db, {
    beliefId: initial.id,
    newStatement: 'The river gate might never open.',
    newConfidence: 0.4,
    reason: 'Discovered rusted mechanisms that cannot turn',
    newEvidence: [
      { evidenceId: 'ev_rusted_mechanism', relation: 'contradicts', isIndependent: true }
    ]
  });

  assert.equal(revision2.revision_number, 2);
  assert.equal(revision2.previous_belief_id, initial.id);
  assert.equal(revision2.confidence, 0.4);

  // Check initial was marked 'revised'
  const oldBelief = db.prepare('SELECT * FROM park_beliefs WHERE id = ?').get(initial.id);
  assert.equal(oldBelief.status, 'revised');

  // Trace full history
  const history = getBeliefHistory(db, revision2.id);
  assert.equal(history.length, 2);
  assert.equal(history[0].id, initial.id);
  assert.equal(history[1].id, revision2.id);

  // Assess confidence of revised belief with contradiction
  const assessed = assessConfidence(db, revision2.id);
  assert.ok(assessed.contradictingWeight > 0);
  assert.equal(assessed.netConfidence, 0); // 0 supporting, 1 contradicting
});
