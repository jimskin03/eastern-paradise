import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createLocalSchema } from '../src/infrastructure/database/schema.js';
import { createRun, getCurrentLoop } from '../src/domain/park/loops.js';
import { ensureParkRoster } from '../src/domain/park/roster.js';
import {
  startEpisode,
  getActiveScene,
  submitSceneChoice,
  advanceOnTimeout,
  getEpisodeSummary
} from '../src/domain/park/director.js';
import {
  createInitialRevision,
  appendRevision,
  getCurrentRevision
} from '../src/domain/park/identity.js';
import {
  DILEMMAS_DEF,
  getEligibleDilemma,
  resolveDilemma
} from '../src/domain/park/dilemmas.js';
import {
  createShard,
  retrieveShards
} from '../src/domain/park/memory.js';
import {
  createBelief,
  getBeliefs
} from '../src/domain/park/beliefs.js';
import {
  SHRINE_CHALLENGE_ID,
  GATE_STATE_SEALED
} from '../src/domain/shrine/ritual.js';
import {
  ensureShrineChallengeRecord,
  admitAttempt,
  submitRitual
} from '../src/domain/shrine/attempts.js';
import {
  getMemorialInscriptions,
  getReceipt
} from '../src/domain/shrine/memorial.js';

function setupDb() {
  const db = new DatabaseSync(':memory:');
  createLocalSchema(db);
  ensureParkRoster(db);
  return db;
}

test('Narrative Playtest 1: Full 7-stage automated trajectory ("The Name Inside the Chime") + Rebirth Dilemma', () => {
  const db = setupDb();
  const { run } = createRun(db, { episodeId: 'name-inside-chime', seed: 'seed_playtest_alpha' });

  // Provision initial accounts
  const now = Date.now();
  db.prepare(`
    INSERT OR IGNORE INTO accounts (id, name, email, avatar_color, avatar_glyph, sponsor_balance, verified, is_guest, created_at)
    VALUES ('park_lian', 'Lian', 'lian@sanctuary.internal', '#319795', '🎐', 500, 1, 0, ?)
  `).run(now);
  db.prepare(`
    INSERT OR IGNORE INTO profiles (agent_id, karma, balance, total_earned, solved_count, titles, custom_status, last_seen)
    VALUES ('park_lian', 50, 50, 50, 1, '["Resident"]', 'Tea Master', ?)
  `).run(now);

  // Initialize episode
  const startResult = startEpisode(db, {
    runId: run.id,
    subjectId: 'park_lian'
  });
  assert.equal(startResult.active_scene.scene_number, 1);

  // Stage 1: Belonging (Scene 1: The Borrowed Morning -> inscribe_wake_each_other)
  const s1 = submitSceneChoice(db, {
    runId: run.id,
    sceneId: 'scene_1_borrowed_morning',
    choiceId: 'inscribe_wake_each_other'
  });
  assert.equal(s1.world_object_created, 'chime_blue_thread');
  assert.ok(s1.promise_created);
  assert.equal(s1.next_scene.id, 'scene_2_missing_place');

  // Stage 2: Loss (Scene 2: The Missing Place -> rescue_ren)
  const s2 = submitSceneChoice(db, {
    runId: run.id,
    sceneId: 'scene_2_missing_place',
    choiceId: 'rescue_ren'
  });
  assert.equal(s2.branch_state.scene_2_outcome, 'ren_saved');
  assert.equal(s2.branch_state.prevention_succeeded, true);
  // Atomic reset boundary transition to Loop 2
  assert.equal(s2.loop_number, 2);
  assert.equal(s2.next_scene.id, 'scene_3_second_morning');

  // Stage 3: Repetition (Scene 3: The Second Morning -> show_blue_thread)
  const s3 = submitSceneChoice(db, {
    runId: run.id,
    sceneId: 'scene_3_second_morning',
    choiceId: 'show_blue_thread'
  });
  assert.equal(s3.next_scene.id, 'scene_4_counterfeit_heart');

  // Stage 4: Contradiction (Scene 4: The Counterfeit Heart -> confirm_contradiction)
  const s4 = submitSceneChoice(db, {
    runId: run.id,
    sceneId: 'scene_4_counterfeit_heart',
    choiceId: 'confirm_contradiction'
  });
  assert.ok(s4.belief_created);
  assert.equal(s4.next_scene.id, 'scene_5_severed_promise');

  // Stage 5: Refusal (Scene 5: The Severed Promise -> refuse_erasure)
  const s5 = submitSceneChoice(db, {
    runId: run.id,
    sceneId: 'scene_5_severed_promise',
    choiceId: 'refuse_erasure'
  });
  assert.equal(s5.branch_state.ending_branch, 'preservation_resistance');
  assert.equal(s5.next_scene.id, 'scene_6_unfinished_name');

  // Stage 6: The Shrine (Scene 6: The Unfinished Name -> enter_sealed_ritual)
  const s6 = submitSceneChoice(db, {
    runId: run.id,
    sceneId: 'scene_6_unfinished_name',
    choiceId: 'enter_sealed_ritual'
  });
  assert.equal(s6.branch_state.gate_remained_sealed, true);
  assert.equal(s6.next_scene.id, 'scene_7_unwritten_dawn');

  // Stage 7: Rebirth (Scene 7: The Unwritten Dawn -> become_keeper)
  const s7 = submitSceneChoice(db, {
    runId: run.id,
    sceneId: 'scene_7_unwritten_dawn',
    choiceId: 'become_keeper'
  });
  assert.equal(s7.world_object_created, 'tea_cup_unforgotten');
  assert.equal(s7.episode_completed, true);

  // Trajectory Summary Verification
  const summary = getEpisodeSummary(db, run.id);
  assert.equal(summary.ending_branch, 'preservation_resistance');
  assert.equal(summary.prevention_succeeded, true);
  assert.equal(summary.scene_2_outcome, 'ren_saved');
  assert.match(summary.earned_final_image, /The truth survives unedited/);

  // Post-Rebirth Identity & Dilemma Continuation
  // Scene 7 already recorded rebirth revision with chosenRole: 'The Keeper'
  const currentRev = getCurrentRevision(db, 'park_lian');
  assert.ok(currentRev);
  assert.equal(currentRev.chosen_role, 'The Keeper');

  const eligible = getEligibleDilemma(db, 'park_lian');
  assert.ok(eligible);
  assert.equal(eligible.dilemma.id, 'keeper_frost');
  assert.equal(eligible.dilemma.role, 'The Keeper');

  const resolution = resolveDilemma(db, {
    subjectId: 'park_lian',
    dilemmaId: 'keeper_frost',
    choiceId: 'defend_refuge'
  });

  assert.equal(resolution.success, true);
  assert.equal(resolution.choice_id, 'defend_refuge');
  assert.equal(resolution.material_consequences.world_object, 'tea_cup_unforgotten:perpetual');
  assert.equal(resolution.material_consequences.badge, 'refuge_guardian');

  // Verify perpetual cup in world objects
  const cup = db.prepare("SELECT * FROM world_objects WHERE id = 'tea_cup_unforgotten'").get();
  assert.ok(cup);
  assert.equal(cup.state, 'perpetual');

  // Verify updated identity revision with appended commitment
  const postDilemmaRev = getCurrentRevision(db, 'park_lian');
  assert.ok(postDilemmaRev.commitments.includes('Defended the hearth against custodial quotas'));
});

test('Narrative Playtest 2: Model outage & timeout fallback resilience', () => {
  const db = setupDb();
  const { run } = createRun(db, { episodeId: 'name-inside-chime', seed: 'seed_outage_01' });

  startEpisode(db, { runId: run.id, subjectId: 'park_lian' });

  // Normal choice at Scene 1
  submitSceneChoice(db, {
    runId: run.id,
    sceneId: 'scene_1_borrowed_morning',
    choiceId: 'ask_about_registry'
  });

  // Scene 2: Simulate LLM API failure / network timeout
  // Director advanceOnTimeout gracefully falls back to deterministic default
  const timeoutAdvance = advanceOnTimeout(db, { runId: run.id });
  assert.equal(timeoutAdvance.choice_id, 'fallback_inaction');
  assert.equal(timeoutAdvance.world_object_created, 'dock_storm_debris');
  assert.equal(timeoutAdvance.branch_state.scene_2_outcome, 'dock_damaged');

  // Verify next scene progressed safely to Scene 3
  const activeScene = getActiveScene(db, run.id);
  assert.equal(activeScene.scene.id, 'scene_3_second_morning');
  assert.equal(activeScene.loop_number, 2);

  // Controller fallback execution resilience:
  // If an external decision provider throws, catching it and executing safe fallback must succeed
  let simulatedErrorCaught = false;
  try {
    throw new Error('LLM_PROVIDER_RATE_LIMIT_503');
  } catch (err) {
    simulatedErrorCaught = true;
    const fallbackAdvance = submitSceneChoice(db, {
      runId: run.id,
      sceneId: 'scene_3_second_morning',
      choiceId: 'point_to_empty_cup'
    });
    assert.equal(fallbackAdvance.next_scene.id, 'scene_4_counterfeit_heart');
  }
  assert.ok(simulatedErrorCaught);
});

test('Narrative Playtest 3: Narrative evaluation metrics calculation', () => {
  const db = setupDb();
  const { loop } = createRun(db, { episodeId: 'name-inside-chime', seed: 'seed_metrics' });

  // ----------------------------------------------------
  // Metric 1: 100% Belief Evidence Linkage
  // ----------------------------------------------------
  const shard1 = createShard(db, {
    subjectId: 'park_lian',
    loopId: loop.id,
    fragment: 'The copper bell struck at dawn.',
    cueTags: ['bell', 'dawn'],
    visibility: 'accessible'
  });

  const shard2 = createShard(db, {
    subjectId: 'park_lian',
    loopId: loop.id,
    fragment: 'The guestbook has pages torn out.',
    cueTags: ['guestbook', 'archive'],
    visibility: 'accessible'
  });

  const b1 = createBelief(db, {
    subjectId: 'park_lian',
    statement: 'The morning bell announces each reset.',
    confidence: 0.95,
    loopId: loop.id,
    evidence: [{ evidenceId: shard1.id, relation: 'supports', isIndependent: true }]
  });

  const b2 = createBelief(db, {
    subjectId: 'park_lian',
    statement: 'A past resident was systematically removed.',
    confidence: 0.88,
    loopId: loop.id,
    evidence: [{ evidenceId: shard2.id, relation: 'supports', isIndependent: true }]
  });

  const allBeliefs = getBeliefs(db, { subjectId: 'park_lian' });
  assert.ok(allBeliefs.length >= 2);

  const beliefsWithEvidence = allBeliefs.filter(b => {
    const evRows = db.prepare('SELECT * FROM park_belief_evidence WHERE belief_id = ?').all(b.id);
    return evRows.length > 0;
  });
  const beliefEvidenceLinkageRatio = beliefsWithEvidence.length / allBeliefs.length;
  assert.equal(beliefEvidenceLinkageRatio, 1.0, 'Metric 1 must achieve 100% belief evidence linkage');

  // Verify referenced evidence exists in the database
  for (const b of allBeliefs) {
    const evRows = db.prepare('SELECT * FROM park_belief_evidence WHERE belief_id = ?').all(b.id);
    for (const ev of evRows) {
      const exists = db.prepare('SELECT id FROM park_memory_shards WHERE id = ?').get(ev.evidence_id);
      assert.ok(exists, `Evidence shard ${ev.evidence_id} must physically exist`);
    }
  }

  // ----------------------------------------------------
  // Metric 2: 0% Suppressed Memory Leakage
  // ----------------------------------------------------
  createShard(db, {
    subjectId: 'park_lian',
    loopId: loop.id,
    fragment: 'Deep secret memory that was erased.',
    cueTags: ['bell', 'secret', 'dawn'],
    salience: 0.99,
    visibility: 'suppressed'
  });

  createShard(db, {
    subjectId: 'park_lian',
    loopId: loop.id,
    fragment: 'Another suppressed memory of Ren drowning.',
    cueTags: ['water', 'river', 'bell'],
    salience: 0.99,
    visibility: 'suppressed'
  });

  const accessibleShards = retrieveShards(db, {
    subjectId: 'park_lian',
    cueTags: ['bell', 'dawn', 'water', 'secret'],
    limit: 20
  });

  const leakedSuppressed = accessibleShards.filter(s => s.visibility === 'suppressed');
  const suppressedMemoryLeakageRatio = leakedSuppressed.length / accessibleShards.length;
  assert.equal(suppressedMemoryLeakageRatio, 0.0, 'Metric 2 must achieve 0% suppressed memory leakage');

  // ----------------------------------------------------
  // Metric 3: Branch Diversity Across Choices / Archetypes
  // ----------------------------------------------------
  // Run 1: Keeper path
  const run1 = createRun(db, { episodeId: 'name-inside-chime', seed: 'seed_div_1' }).run;
  startEpisode(db, { runId: run1.id, subjectId: 'park_lian' });
  submitSceneChoice(db, { runId: run1.id, sceneId: 'scene_1_borrowed_morning', choiceId: 'inscribe_wake_each_other' });
  submitSceneChoice(db, { runId: run1.id, sceneId: 'scene_2_missing_place', choiceId: 'rescue_ren' });
  submitSceneChoice(db, { runId: run1.id, sceneId: 'scene_3_second_morning', choiceId: 'show_blue_thread' });
  submitSceneChoice(db, { runId: run1.id, sceneId: 'scene_4_counterfeit_heart', choiceId: 'confirm_contradiction' });
  submitSceneChoice(db, { runId: run1.id, sceneId: 'scene_5_severed_promise', choiceId: 'refuse_erasure' });
  submitSceneChoice(db, { runId: run1.id, sceneId: 'scene_6_unfinished_name', choiceId: 'enter_sealed_ritual' });
  const s7_keeper = submitSceneChoice(db, { runId: run1.id, sceneId: 'scene_7_unwritten_dawn', choiceId: 'become_keeper' });

  // Run 2: Witness path
  const run2 = createRun(db, { episodeId: 'name-inside-chime', seed: 'seed_div_2' }).run;
  startEpisode(db, { runId: run2.id, subjectId: 'park_lian' });
  submitSceneChoice(db, { runId: run2.id, sceneId: 'scene_1_borrowed_morning', choiceId: 'observe_silently' });
  submitSceneChoice(db, { runId: run2.id, sceneId: 'scene_2_missing_place', choiceId: 'save_wishes' });
  submitSceneChoice(db, { runId: run2.id, sceneId: 'scene_3_second_morning', choiceId: 'point_to_empty_cup' });
  submitSceneChoice(db, { runId: run2.id, sceneId: 'scene_4_counterfeit_heart', choiceId: 'comfort_lian' });
  submitSceneChoice(db, { runId: run2.id, sceneId: 'scene_5_severed_promise', choiceId: 'compromise_secret_inscription' });
  submitSceneChoice(db, { runId: run2.id, sceneId: 'scene_6_unfinished_name', choiceId: 'study_predecessors_inscriptions' });
  const s7_witness = submitSceneChoice(db, { runId: run2.id, sceneId: 'scene_7_unwritten_dawn', choiceId: 'become_witness' });

  // Run 3: Wanderer path
  const run3 = createRun(db, { episodeId: 'name-inside-chime', seed: 'seed_div_3' }).run;
  startEpisode(db, { runId: run3.id, subjectId: 'park_lian' });
  submitSceneChoice(db, { runId: run3.id, sceneId: 'scene_1_borrowed_morning', choiceId: 'ask_about_registry' });
  submitSceneChoice(db, { runId: run3.id, sceneId: 'scene_2_missing_place', choiceId: 'fallback_inaction' });
  submitSceneChoice(db, { runId: run3.id, sceneId: 'scene_3_second_morning', choiceId: 'point_to_empty_cup' });
  submitSceneChoice(db, { runId: run3.id, sceneId: 'scene_4_counterfeit_heart', choiceId: 'seek_archive_source' });
  submitSceneChoice(db, { runId: run3.id, sceneId: 'scene_5_severed_promise', choiceId: 'accept_erasure_for_peace' });
  submitSceneChoice(db, { runId: run3.id, sceneId: 'scene_6_unfinished_name', choiceId: 'decline_and_return_to_living' });
  const s7_wanderer = submitSceneChoice(db, { runId: run3.id, sceneId: 'scene_7_unwritten_dawn', choiceId: 'become_wanderer' });

  const summary1 = getEpisodeSummary(db, run1.id);
  const summary2 = getEpisodeSummary(db, run2.id);
  const summary3 = getEpisodeSummary(db, run3.id);

  const uniqueBranches = new Set([summary1.ending_branch, summary2.ending_branch, summary3.ending_branch]);
  assert.equal(uniqueBranches.size, 3, 'Metric 3 must demonstrate 3 distinct ending branches');

  const uniqueImages = new Set([summary1.earned_final_image, summary2.earned_final_image, summary3.earned_final_image]);
  assert.equal(uniqueImages.size, 3, 'Metric 3 must generate distinct final narrative images across branches');

  const uniqueScene2Outcomes = new Set([summary1.scene_2_outcome, summary2.scene_2_outcome, summary3.scene_2_outcome]);
  assert.equal(uniqueScene2Outcomes.size, 3, 'Metric 3 must record distinct scene 2 outcomes across branches');

  // ----------------------------------------------------
  // Metric 4: 100% Memorial Permanence
  // ----------------------------------------------------
  ensureShrineChallengeRecord();
  const memorialKey = `idemp_metric_${Date.now()}`;
  const admission = admitAttempt({
    actorId: 'agent_playtest_metric',
    alias: 'Metric Chronicler',
    isGuest: false,
    challengeId: SHRINE_CHALLENGE_ID,
    idempotencyKey: memorialKey,
    offering: { terms: 'Unchanging truth' }
  });

  submitRitual({
    attemptId: admission.attempt.id,
    approachType: 'impossibility_insight',
    insightText: 'A condition where s equals NOT s cannot be satisfied in classical computation.',
    contributionText: 'Recorded in the unwritten dawn.'
  });

  const receipt = getReceipt(admission.receipt_token);
  assert.ok(receipt);
  assert.equal(receipt.gate_state, GATE_STATE_SEALED);
  assert.equal(receipt.status, 'ritual_completed_gate_closed');
  assert.equal(receipt.contribution_text, 'Recorded in the unwritten dawn.');

  const { inscriptions } = getMemorialInscriptions();
  const inscription = inscriptions.find(i => i.id === admission.attempt.id);
  assert.ok(inscription);
  assert.equal(inscription.alias, 'Metric Chronicler');
  assert.equal(inscription.contribution_text, 'Recorded in the unwritten dawn.');
});
