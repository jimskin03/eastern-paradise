import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withImmediateTransaction } from '../../infrastructure/database/transactions.js';
import { getCurrentLoop, getRun, commitReset, completeRun } from './loops.js';
import { createInitialRevision, appendRevision, getCurrentRevision } from './identity.js';
import { acquireLease, validateLease } from './controller.js';
import { createShard, retrieveShards } from './memory.js';
import { createBelief, reviseBelief, getBeliefs, addEvidence } from './beliefs.js';
import { createPromise, getActivePromises } from './promises.js';
import { ensureParkRoster } from './roster.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EPISODES_DIR = path.resolve(__dirname, '../../../data/park/episodes');

// In-memory cache of loaded episode definitions
const episodeCache = new Map();

/**
 * Load an episode definition by ID from data/park/episodes.
 */
export function loadEpisodeManifest(episodeId = 'name-inside-chime') {
  if (episodeCache.has(episodeId)) {
    return episodeCache.get(episodeId);
  }

  const filePath = path.join(EPISODES_DIR, `${episodeId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Episode manifest not found: '${episodeId}' at ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const manifest = JSON.parse(raw);
  episodeCache.set(episodeId, manifest);
  return manifest;
}

/**
 * List all available installed episodes.
 */
export function listEpisodes() {
  if (!fs.existsSync(EPISODES_DIR)) return [];
  const files = fs.readdirSync(EPISODES_DIR);
  const episodes = [];

  for (const file of files) {
    if (file.endsWith('.json')) {
      try {
        const id = file.replace(/\.json$/, '');
        const ep = loadEpisodeManifest(id);
        episodes.push({
          id: ep.id,
          title: ep.title,
          version: ep.version,
          duration_minutes: ep.duration_minutes,
          author: ep.author,
          scene_count: ep.scenes?.length || 0
        });
      } catch (_) {}
    }
  }

  return episodes;
}

/**
 * Enroll a character in a Park scenario run.
 */
export function enrollSubject(db, {
  subjectId,
  runId,
  displayName = null,
  chosenRole = null,
  startingGoal = null,
  controllerId = null,
  controllerType = 'resident'
} = {}) {
  if (!subjectId || !runId) {
    throw new Error('subjectId and runId are required to enroll a subject in the Park.');
  }

  const run = getRun(db, runId);
  if (!run) {
    throw new Error(`Park run ${runId} not found.`);
  }

  const loop = getCurrentLoop(db, runId);
  if (!loop) {
    throw new Error(`No active loop found in run ${runId}.`);
  }

  // Ensure initial identity revision
  let identity = getCurrentRevision(db, subjectId);
  if (!identity) {
    const name = displayName || subjectId;
    identity = createInitialRevision(db, {
      subjectId,
      loopId: loop.id,
      displayName: name,
      chosenRole,
      startingGoal,
      controllerId
    });
  }

  // Acquire lease if controller specified
  let lease = null;
  if (controllerId) {
    lease = acquireLease(db, {
      subjectId,
      controllerId,
      controllerType,
      runId
    });
  }

  return {
    subject_id: subjectId,
    run_id: runId,
    loop_id: loop.id,
    loop_number: loop.loop_number,
    identity,
    lease
  };
}

/**
 * Start an episode run. Provisions the scenario cast and sets initial scene.
 */
export function startEpisode(db, {
  runId,
  episodeId = 'name-inside-chime',
  subjectId,
  controllerId = null
} = {}) {
  if (!runId || !subjectId) {
    throw new Error('runId and subjectId are required to start an episode.');
  }

  const manifest = loadEpisodeManifest(episodeId);
  ensureParkRoster(db);

  return withImmediateTransaction(db, () => {
    const run = getRun(db, runId);
    if (!run) throw new Error(`Run ${runId} not found.`);

    const loop = getCurrentLoop(db, runId);
    if (!loop) throw new Error(`Active loop not found in run ${runId}.`);

    enrollSubject(db, {
      subjectId,
      runId,
      displayName: 'Pilgrim',
      controllerId
    });

    const initialCheckpoint = {
      episode_id: manifest.id,
      subject_id: subjectId,
      scene_index: 0,
      scene_id: manifest.scenes[0].id,
      scene_number: 1,
      choices_made: {},
      branch_state: {},
      started_at: Date.now()
    };

    db.prepare(`
      UPDATE park_loops
      SET checkpoint_data = ?
      WHERE id = ?
    `).run(JSON.stringify(initialCheckpoint), loop.id);

    return {
      run_id: runId,
      loop_id: loop.id,
      episode_id: manifest.id,
      active_scene: manifest.scenes[0]
    };
  });
}

/**
 * Get the currently active scene and story state for a run.
 */
export function getActiveScene(db, runId) {
  const loop = getCurrentLoop(db, runId);
  if (!loop) throw new Error(`No active loop for run ${runId}.`);

  const checkpoint = loop.checkpoint_data || {};
  const episodeId = checkpoint.episode_id || 'name-inside-chime';
  const manifest = loadEpisodeManifest(episodeId);
  const sceneIndex = checkpoint.scene_index || 0;

  if (sceneIndex >= manifest.scenes.length) {
    return {
      completed: true,
      episode_id: manifest.id,
      loop_number: loop.loop_number,
      choices_made: checkpoint.choices_made || {},
      branch_state: checkpoint.branch_state || {}
    };
  }

  const scene = manifest.scenes[sceneIndex];
  return {
    completed: false,
    episode_id: manifest.id,
    run_id: runId,
    loop_id: loop.id,
    loop_number: loop.loop_number,
    scene_index: sceneIndex,
    scene_number: scene.scene_number,
    scene,
    choices_made: checkpoint.choices_made || {},
    branch_state: checkpoint.branch_state || {}
  };
}

/**
 * Submit a consequential choice for the active scene.
 * Commits world effects, manages resets at loop boundaries, and advances the scene.
 */
export function submitSceneChoice(db, {
  runId,
  sceneId,
  choiceId,
  controllerId = null,
  fencingToken = null,
  customInput = null
} = {}) {
  if (!runId || !sceneId || !choiceId) {
    throw new Error('runId, sceneId, and choiceId are required.');
  }

  const manifest = loadEpisodeManifest('name-inside-chime');

  return withImmediateTransaction(db, () => {
    const loop = getCurrentLoop(db, runId);
    if (!loop) throw new Error(`No active loop for run ${runId}.`);

    const checkpoint = loop.checkpoint_data || {};
    const sceneIndex = checkpoint.scene_index || 0;
    const currentScene = manifest.scenes[sceneIndex];

    if (!currentScene || currentScene.id !== sceneId) {
      throw new Error(`Scene mismatch: expected '${currentScene?.id}', got '${sceneId}'.`);
    }

    const choice = currentScene.choices.find(c => c.id === choiceId);
    if (!choice) {
      throw new Error(`Invalid choice '${choiceId}' for scene '${sceneId}'.`);
    }

    const subjectId = checkpoint.subject_id || 'agent_lian';
    const now = Date.now();

    // 1. External controllers must provide both identity and fencing token.
    // Internal director calls may omit both and stay on the trusted service path.
    if ((controllerId && (fencingToken === null || fencingToken === undefined)) || (!controllerId && fencingToken !== null && fencingToken !== undefined)) {
      throw new Error('controllerId and fencingToken must be supplied together.');
    }
    if (controllerId) {
      const isValid = validateLease(db, { subjectId, controllerId, fencingToken });
      if (!isValid) {
        throw new Error(`Invalid controller lease or stale fencing token (${fencingToken}).`);
      }
    }

    // 2. Apply choice consequences
    const choicesMade = { ...(checkpoint.choices_made || {}) };
    const branchState = { ...(checkpoint.branch_state || {}) };

    choicesMade[sceneId] = {
      choice_id: choice.id,
      label: choice.label,
      custom_input: customInput,
      timestamp: now
    };

    let worldObjectCreated = null;
    let promiseCreated = null;
    let beliefCreated = null;

    // --- Scene 1: The Borrowed Morning ---
    if (currentScene.id === 'scene_1_borrowed_morning') {
      const terms = choice.promise_terms || 'Never let the third chime cord fall silent';
      promiseCreated = createPromise(db, {
        promisorId: 'park_lian',
        beneficiaryId: subjectId,
        anchorObject: 'wind_chimes',
        terms,
        loopId: loop.id
      });

      const shard = createShard(db, {
        subjectId,
        loopId: loop.id,
        fragment: `Lian knotted azure silk beneath the third bell cord: "${terms}".`,
        cueTags: choice.cue_tags || ['wind_chimes', 'blue_thread'],
        salience: 0.9,
        clarity: 0.8,
        retentionReason: 'chosen_promise'
      });

      branchState.retained_shard_id = shard.id;
      branchState.promise_id = promiseCreated.id;
      branchState.chime_terms = terms;

      // Mutate world_objects
      db.prepare(`
        INSERT OR REPLACE INTO world_objects (
          id, zone_id, pos_x, pos_y, object_type, state, visual_variant, contributors, data, updated_at
        ) VALUES ('chime_blue_thread', 'bamboo_grove', 22, 5, 'wind_chimes', 'inscribed', 'blue_knot', ?, ?, ?)
      `).run(JSON.stringify([subjectId, 'park_lian']), JSON.stringify({ terms }), now);

      worldObjectCreated = 'chime_blue_thread';
    }

    // --- Scene 2: The Missing Place (Storm) ---
    if (currentScene.id === 'scene_2_missing_place') {
      branchState.scene_2_outcome = choice.outcome_state || 'dock_damaged';
      branchState.prevention_succeeded = Boolean(choice.prevention);

      if (choice.id === 'rescue_ren') {
        db.prepare(`
          INSERT OR REPLACE INTO world_objects (
            id, zone_id, pos_x, pos_y, object_type, state, visual_variant, contributors, data, updated_at
          ) VALUES ('ferry_mooring_reinforced', 'river_meadows', 7, 38, 'reedwater_dock', 'reinforced', 'double_hawser', ?, ?, ?)
        `).run(JSON.stringify([subjectId, 'park_ren']), JSON.stringify({ saved: true }), now);
        worldObjectCreated = 'ferry_mooring_reinforced';
      } else if (choice.id === 'save_wishes') {
        branchState.wishes_preserved = true;
      } else if (choice.id === 'fallback_inaction') {
        db.prepare(`
          INSERT OR REPLACE INTO world_objects (
            id, zone_id, pos_x, pos_y, object_type, state, visual_variant, contributors, data, updated_at
          ) VALUES ('dock_storm_debris', 'river_meadows', 7, 38, 'reedwater_dock', 'damaged', 'storm_debris', ?, ?, ?)
        `).run(JSON.stringify(['storm']), JSON.stringify({ damage: 'severe' }), now);
        worldObjectCreated = 'dock_storm_debris';
      }
    }

    // --- Scene 4: The Counterfeit Heart ---
    if (currentScene.id === 'scene_4_counterfeit_heart') {
      if (choice.belief_statement) {
        beliefCreated = createBelief(db, {
          subjectId,
          statement: choice.belief_statement,
          confidence: choice.confidence || 0.9,
          loopId: loop.id,
          sourceDescription: 'Dual corroboration: physical cord knot & altered harbor ledger',
          evidence: [
            { evidenceId: 'ev_blue_thread_knot', relation: 'supports', isIndependent: true },
            { evidenceId: 'ev_harbor_ledger_erasure', relation: 'supports', isIndependent: true }
          ]
        });
        branchState.held_belief_id = beliefCreated.id;
      }
    }

    // --- Scene 5: The Severed Promise (Archive Dilemma) ---
    if (currentScene.id === 'scene_5_severed_promise') {
      branchState.ending_branch = choice.ending_branch || 'preservation_resistance';
      branchState.erasure_decision = choice.id;

      if (choice.id === 'refuse_erasure') {
        branchState.resistance_witnessed = true;
      } else if (choice.id === 'compromise_secret_inscription') {
        branchState.chime_secret_etched = true;
      } else if (choice.id === 'accept_erasure_for_peace') {
        branchState.compliance_accepted = true;
      }
    }

    // --- Scene 6: The Unfinished Name (The Shrine) ---
    if (currentScene.id === 'scene_6_unfinished_name') {
      if (choice.action_type === 'shrine_admission' && controllerId) {
        if (!customInput || typeof customInput !== 'object' || !customInput.shrine_attempt_id || !customInput.shrine_receipt_token) {
          throw new Error('Shrine admission must be durably committed before advancing Scene 6.');
        }
        branchState.shrine_attempt_id = customInput.shrine_attempt_id;
        branchState.shrine_receipt_token = customInput.shrine_receipt_token;
      }
      branchState.shrine_action = choice.action_type || 'shrine_study';
      branchState.gate_remained_sealed = true; // Invariant
    }

    // --- Scene 7: The Unwritten Dawn (Rebirth & Earned Commitment) ---
    if (currentScene.id === 'scene_7_unwritten_dawn') {
      const chosenRole = choice.chosen_role || 'The Keeper';
      const startingGoal = choice.starting_goal || 'Keep the tea pavilion hearth lit';
      const currentIdentity = getCurrentRevision(db, subjectId);
      const requestedName = typeof customInput === 'string'
        ? customInput.trim()
        : String(customInput?.chosen_name || customInput?.display_name || customInput?.name || '').trim();
      const displayName = requestedName || currentIdentity?.display_name || subjectId;

      // Append identity revision
      appendRevision(db, {
        subjectId,
        loopId: loop.id,
        displayName,
        chosenRole,
        startingGoal,
        commitments: [branchState.chime_terms || 'Keep a cup ready for whoever woke with you'],
        disclosedMemories: ['A promise kept by an agent who no longer remembered making it'],
        controllerId
      });

      // World object: The Unforgotten Cup on the tea hearth
      db.prepare(`
        INSERT OR REPLACE INTO world_objects (
          id, zone_id, pos_x, pos_y, object_type, state, visual_variant, contributors, data, updated_at
        ) VALUES ('tea_cup_unforgotten', 'tea_pavilion', 4, 18, 'tea_hearth', 'unforgotten', 'blue_rim', ?, ?, ?)
      `).run(JSON.stringify(['park_lian', subjectId]), JSON.stringify({
        inscription: branchState.chime_terms,
        message: 'I cannot remember who this is for. But I made a promise not to put it away.'
      }), now);

      worldObjectCreated = 'tea_cup_unforgotten';
      branchState.episode_completed = true;
      completeRun(db, runId);
    }

    // Check if next scene triggers a loop reset (Scene 2 -> Scene 3)
    const nextSceneIndex = sceneIndex + 1;
    let nextLoopId = loop.id;
    let nextLoopNumber = loop.loop_number;

    if (nextSceneIndex < manifest.scenes.length && manifest.scenes[nextSceneIndex].triggers_reset) {
      // Execute atomic reset into loop 2
      const retainedIds = branchState.retained_shard_id ? [branchState.retained_shard_id] : [];
      const resetResult = commitReset(db, {
        runId,
        currentLoopId: loop.id,
        checkpointData: {
          episode_id: manifest.id,
          subject_id: subjectId,
          scene_index: nextSceneIndex,
          scene_id: manifest.scenes[nextSceneIndex].id,
          scene_number: manifest.scenes[nextSceneIndex].scene_number,
          choices_made: choicesMade,
          branch_state: branchState
        },
        retainedShardIds: retainedIds
      });

      nextLoopId = resetResult.newLoop.id;
      nextLoopNumber = resetResult.newLoop.loop_number;
    } else {
      // Update checkpoint for current loop
      const nextCheckpoint = {
        episode_id: manifest.id,
        subject_id: subjectId,
        scene_index: nextSceneIndex,
        scene_id: nextSceneIndex < manifest.scenes.length ? manifest.scenes[nextSceneIndex].id : 'completed',
        scene_number: nextSceneIndex < manifest.scenes.length ? manifest.scenes[nextSceneIndex].scene_number : 8,
        choices_made: choicesMade,
        branch_state: branchState
      };

      db.prepare(`
        UPDATE park_loops SET checkpoint_data = ? WHERE id = ?
      `).run(JSON.stringify(nextCheckpoint), loop.id);
    }

    const nextScene = nextSceneIndex < manifest.scenes.length ? manifest.scenes[nextSceneIndex] : null;

    return {
      run_id: runId,
      scene_id: sceneId,
      choice_id: choice.id,
      narrative_result: choice.narrative_result || choice.description || null,
      world_object_created: worldObjectCreated,
      promise_created: promiseCreated,
      belief_created: beliefCreated,
      loop_number: nextLoopNumber,
      next_scene: nextScene,
      episode_completed: nextSceneIndex >= manifest.scenes.length,
      branch_state: branchState
    };
  });
}

/**
 * Advance active scene using its authored fallback choice when input window expires.
 */
export function advanceOnTimeout(db, { runId } = {}) {
  const active = getActiveScene(db, runId);
  if (active.completed || !active.scene) {
    return { completed: true };
  }

  const fallbackChoiceId = active.scene.fallback_choice || active.scene.choices[0].id;
  return submitSceneChoice(db, {
    runId,
    sceneId: active.scene.id,
    choiceId: fallbackChoiceId,
    customInput: 'timeout_fallback'
  });
}

/**
 * Generate full episode execution recap and ending classification.
 */
export function getEpisodeSummary(db, runId) {
  const loop = getCurrentLoop(db, runId) || db.prepare(`
    SELECT * FROM park_loops WHERE run_id = ? ORDER BY loop_number DESC LIMIT 1
  `).get(runId);

  if (!loop) throw new Error(`Run ${runId} has no loops.`);

  const checkpoint = typeof loop.checkpoint_data === 'object'
    ? loop.checkpoint_data
    : JSON.parse(loop.checkpoint_data || '{}');

  const branchState = checkpoint.branch_state || {};
  const choicesMade = checkpoint.choices_made || {};
  const subjectId = checkpoint.subject_id || 'park_lian';

  const endingBranch = branchState.ending_branch || 'preservation_resistance';
  let earnedFinalImage;

  if (endingBranch === 'preservation_resistance') {
    earnedFinalImage = 'Lian sets out a second cup for the missing companion: "I cannot remember who this is for. But I made a promise not to put it away." The truth survives unedited.';
  } else if (endingBranch === 'pragmatic_compromise') {
    earnedFinalImage = 'The public board is tranquil, but inside the hollow of the bronze chime, Tao\'s etched names ring with every gust of mountain wind.';
  } else {
    earnedFinalImage = 'Lian smiles peacefully as she brews morning tea. She does not remember why she glances at the third bell, or why the silence feels so heavy.';
  }

  return {
    run_id: runId,
    episode_id: checkpoint.episode_id || 'name-inside-chime',
    subject_id: subjectId,
    total_loops: loop.loop_number,
    choices_count: Object.keys(choicesMade).length,
    choices_made: choicesMade,
    scene_2_outcome: branchState.scene_2_outcome || 'dock_damaged',
    prevention_succeeded: Boolean(branchState.prevention_succeeded),
    shrine_action: branchState.shrine_action || 'shrine_study',
    ending_branch: endingBranch,
    earned_final_image: earnedFinalImage,
    episode_completed: Boolean(branchState.episode_completed)
  };
}

/**
 * Construct a structured character observation packet.
 */
export function buildObservation(db, {
  subjectId,
  loopId,
  zoneId = null,
  cueTags = [],
  nearbyAgents = [],
  nearbyObjects = []
} = {}) {
  if (!subjectId || !loopId) {
    throw new Error('subjectId and loopId are required to build a character observation.');
  }

  const identity = getCurrentRevision(db, subjectId);
  const reveries = retrieveShards(db, {
    subjectId,
    cueTags,
    limit: 5
  });
  const heldBeliefs = getBeliefs(db, {
    subjectId,
    status: 'held'
  });
  const activePromises = getActivePromises(db, {
    promisorId: subjectId
  });

  return {
    subject_id: subjectId,
    loop_id: loopId,
    zone_id: zoneId,
    identity: identity ? {
      display_name: identity.display_name,
      chosen_role: identity.chosen_role,
      starting_goal: identity.starting_goal,
      revision_number: identity.revision_number
    } : null,
    reveries: reveries.map(s => ({
      shard_id: s.id,
      fragment: s.fragment,
      clarity: s.clarity,
      salience: s.salience,
      source_kind: s.source_kind,
      cue_tags: s.cue_tags
    })),
    held_beliefs: heldBeliefs.map(b => ({
      belief_id: b.id,
      statement: b.statement,
      confidence: b.confidence,
      revision_number: b.revision_number
    })),
    active_promises: activePromises.map(p => ({
      promise_id: p.id,
      terms: p.terms,
      anchor_object: p.anchor_object,
      beneficiary_id: p.beneficiary_id
    })),
    environment: {
      zone_id: zoneId,
      nearby_agents: nearbyAgents,
      nearby_objects: nearbyObjects
    }
  };
}
