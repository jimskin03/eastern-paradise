import { parseJsonBody } from '../helpers/body.js';
import { sendApiError, sendJson } from '../helpers/response.js';
import { db } from '../../db.js';
import {
  createRun,
  getRun,
  getCurrentLoop,
  getRunHistory,
  commitReset
} from '../../domain/park/loops.js';
import {
  createShard,
  retrieveShards,
  getShardsByLoop,
  recoverShard
} from '../../domain/park/memory.js';
import {
  createBelief,
  reviseBelief,
  getBeliefs,
  getBeliefHistory,
  assessConfidence
} from '../../domain/park/beliefs.js';
import {
  createPromise,
  getActivePromises,
  getDormantPromises,
  rediscoverPromise,
  resolvePromise,
  getPromiseHistory
} from '../../domain/park/promises.js';
import {
  acquireLease,
  releaseLease,
  validateLease,
  getActiveLease
} from '../../domain/park/controller.js';
import {
  enrollSubject,
  buildObservation,
  listEpisodes,
  loadEpisodeManifest,
  startEpisode,
  getActiveScene,
  submitSceneChoice,
  advanceOnTimeout,
  getEpisodeSummary
} from '../../domain/park/director.js';
import {
  exportIdentityCapsule,
  verifyIdentityCapsule,
  importIdentityCapsule
} from '../../domain/park/capsule.js';
import {
  getEligibleDilemma,
  resolveDilemma
} from '../../domain/park/dilemmas.js';
import { admitAttempt } from '../../domain/shrine/attempts.js';
import { confirmShrineDurability } from '../../domain/shrine/durability.js';

export async function handleParkRoutes(ctx) {
  const { req, res, pathname, parsedUrl, services } = ctx;
  const getParam = (name) => {
    if (parsedUrl.searchParams) return parsedUrl.searchParams.get(name);
    if (parsedUrl.query) return parsedUrl.query[name];
    return null;
  };

  const authenticateActor = () => services?.AuthService?.authenticate(req) || null;
  const rejectUnauthenticated = () => sendApiError(res, 401, 'UNAUTHORIZED', 'Authentication is required for Park state and private continuity data.');
  const rejectForbidden = (message = 'This Park resource belongs to another controller.') => sendApiError(res, 403, 'FORBIDDEN', message);
  const currentCheckpoint = (runId) => {
    const active = getCurrentLoop(db, runId);
    if (active?.checkpoint_data) return active.checkpoint_data;
    const latest = db.prepare(`
      SELECT checkpoint_data
      FROM park_loops
      WHERE run_id = ?
      ORDER BY loop_number DESC
      LIMIT 1
    `).get(runId);
    if (!latest?.checkpoint_data) return {};
    if (typeof latest.checkpoint_data === 'object') return latest.checkpoint_data;
    try { return JSON.parse(latest.checkpoint_data); } catch (_) { return {}; }
  };
  const isRunOwner = (runId, account) => {
    const checkpoint = currentCheckpoint(runId);
    const ownerId = checkpoint.owner_account_id || checkpoint.subject_id || null;
    return Boolean(account && ownerId && ownerId === account.id);
  };
  const ownsSubject = (subjectId, account) => Boolean(account && subjectId === account.id);
  const hasCurrentLease = (subjectId, account, fencingToken) => Boolean(
    account && fencingToken !== undefined && fencingToken !== null && validateLease(db, {
      subjectId,
      controllerId: account.id,
      fencingToken
    })
  );

  // 1. POST /api/park/runs
  if (pathname === '/api/park/runs' && req.method === 'POST') {
    const account = authenticateActor();
    if (!account) return rejectUnauthenticated();
    const body = await parseJsonBody(req);
    if (!body.episode_id) {
      return sendApiError(res, 400, 'INVALID_REQUEST', 'episode_id is required.');
    }

    try {
      const result = createRun(db, {
        episodeId: body.episode_id,
        scenarioVersion: body.scenario_version || 1,
        seed: body.seed || null
      });
      db.prepare('UPDATE park_loops SET checkpoint_data = ? WHERE id = ?').run(
        JSON.stringify({ owner_account_id: account.id }),
        result.loop.id
      );
      result.loop.checkpoint_data = { owner_account_id: account.id };
      return sendJson(res, 201, { success: true, ...result });
    } catch (err) {
      return sendApiError(res, 500, 'RUN_CREATION_FAILED', err.message);
    }
  }

  // 2. GET /api/park/runs/:runId
  const runMatch = pathname.match(/^\/api\/park\/runs\/([^/]+)$/);
  if (runMatch && req.method === 'GET') {
    const runId = decodeURIComponent(runMatch[1]);
    const account = authenticateActor();
    if (!account) return rejectUnauthenticated();
    if (!isRunOwner(runId, account)) return rejectForbidden();
    const run = getRun(db, runId);
    if (!run) {
      return sendApiError(res, 404, 'RUN_NOT_FOUND', `Park run '${runId}' not found.`);
    }

    const currentLoop = getCurrentLoop(db, runId);
    const loops = getRunHistory(db, runId);

    return sendJson(res, 200, {
      success: true,
      run,
      current_loop: currentLoop,
      loops
    });
  }

  // 3. POST /api/park/runs/:runId/enroll
  const enrollMatch = pathname.match(/^\/api\/park\/runs\/([^/]+)\/enroll$/);
  if (enrollMatch && req.method === 'POST') {
    const runId = decodeURIComponent(enrollMatch[1]);
    const account = authenticateActor();
    if (!account) return rejectUnauthenticated();
    if (!isRunOwner(runId, account)) return rejectForbidden();
    const body = await parseJsonBody(req);
    const requestedSubject = body.subject_id || body.subjectId || account.id;
    if (!ownsSubject(requestedSubject, account)) {
      return rejectForbidden('A Park participant may only enroll its own authenticated subject.');
    }

    try {
      const result = enrollSubject(db, {
        subjectId: account.id,
        runId,
        displayName: body.display_name,
        chosenRole: body.chosen_role,
        startingGoal: body.starting_goal,
        controllerId: account.id,
        controllerType: 'external'
      });
      return sendJson(res, 200, { success: true, ...result });
    } catch (err) {
      return sendApiError(res, 400, 'ENROLLMENT_FAILED', err.message);
    }
  }

  // 4. POST /api/park/runs/:runId/reset
  const resetMatch = pathname.match(/^\/api\/park\/runs\/([^/]+)\/reset$/);
  if (resetMatch && req.method === 'POST') {
    const runId = decodeURIComponent(resetMatch[1]);
    const account = authenticateActor();
    if (!account) return rejectUnauthenticated();
    if (!isRunOwner(runId, account)) return rejectForbidden();
    const body = await parseJsonBody(req);
    if (!body.current_loop_id) {
      return sendApiError(res, 400, 'INVALID_REQUEST', 'current_loop_id is required to commit reset.');
    }
    const fencingToken = body.fencing_token ?? body.fencingToken;
    if (!hasCurrentLease(account.id, account, fencingToken)) {
      return rejectForbidden('A current controller lease and fencing token are required to reset a Park run.');
    }

    try {
      const result = commitReset(db, {
        runId,
        currentLoopId: body.current_loop_id,
        checkpointData: { ...(body.checkpoint_data || {}), owner_account_id: account.id, subject_id: account.id },
        retainedShardIds: body.retained_shard_ids || [],
        newSeed: body.new_seed || null
      });
      return sendJson(res, 200, { success: true, ...result });
    } catch (err) {
      return sendApiError(res, 400, 'RESET_FAILED', err.message);
    }
  }

  // 5. GET /api/park/loops/:loopId/observation
  const obsMatch = pathname.match(/^\/api\/park\/loops\/([^/]+)\/observation$/);
  if (obsMatch && req.method === 'GET') {
    const loopId = decodeURIComponent(obsMatch[1]);
    const account = authenticateActor();
    if (!account) return rejectUnauthenticated();
    const subjectId = getParam('subject_id') || getParam('subjectId');
    if (!subjectId) {
      return sendApiError(res, 400, 'INVALID_REQUEST', 'subject_id query parameter is required.');
    }
    if (!ownsSubject(subjectId, account)) return rejectForbidden('Observation data is private to its authenticated subject.');

    const cues = getParam('cues');
    const cueTags = cues ? String(cues).split(',').map(c => c.trim()).filter(Boolean) : [];
    const zoneId = getParam('zone_id') || getParam('zoneId');

    try {
      const observation = buildObservation(db, {
        subjectId,
        loopId,
        zoneId,
        cueTags
      });
      return sendJson(res, 200, { success: true, observation });
    } catch (err) {
      return sendApiError(res, 400, 'OBSERVATION_FAILED', err.message);
    }
  }

  // 6. POST /api/park/actions/promise
  if (pathname === '/api/park/actions/promise' && req.method === 'POST') {
    const account = authenticateActor();
    if (!account) return rejectUnauthenticated();
    const body = await parseJsonBody(req);
    const promisorId = body.promisor_id || body.promisorId;
    const loopId = body.loop_id || body.loopId;
    if (!promisorId || !body.terms || !loopId) {
      return sendApiError(res, 400, 'INVALID_REQUEST', 'promisor_id, terms, and loop_id are required.');
    }
    if (!ownsSubject(promisorId, account)) return rejectForbidden('A subject may only create its own promises.');

    try {
      const promise = createPromise(db, {
        promisorId,
        beneficiaryId: body.beneficiary_id || body.beneficiaryId || null,
        anchorObject: body.anchor_object || body.anchorObject || null,
        terms: body.terms,
        sourceEventId: body.source_event_id || body.sourceEventId || null,
        loopId
      });
      return sendJson(res, 201, { success: true, promise });
    } catch (err) {
      return sendApiError(res, 400, 'PROMISE_CREATION_FAILED', err.message);
    }
  }

  // 7. POST /api/park/actions/promise/rediscover
  if (pathname === '/api/park/actions/promise/rediscover' && req.method === 'POST') {
    const account = authenticateActor();
    if (!account) return rejectUnauthenticated();
    const body = await parseJsonBody(req);
    const promiseId = body.promise_id || body.promiseId;
    const currentLoopId = body.current_loop_id || body.currentLoopId;
    if (!promiseId || !currentLoopId) {
      return sendApiError(res, 400, 'INVALID_REQUEST', 'promise_id and current_loop_id are required.');
    }
    const promiseOwner = db.prepare('SELECT promisor_id FROM park_promises WHERE id = ?').get(promiseId);
    if (!promiseOwner || !ownsSubject(promiseOwner.promisor_id, account)) {
      return rejectForbidden('A subject may only rediscover its own promises.');
    }

    try {
      const result = rediscoverPromise(db, {
        promiseId,
        currentLoopId
      });
      return sendJson(res, 200, { success: true, ...result });
    } catch (err) {
      return sendApiError(res, 400, 'REDISCOVERY_FAILED', err.message);
    }
  }

  // 8. POST /api/park/actions/believe
  if (pathname === '/api/park/actions/believe' && req.method === 'POST') {
    const account = authenticateActor();
    if (!account) return rejectUnauthenticated();
    const body = await parseJsonBody(req);
    if (!body.statement) {
      return sendApiError(res, 400, 'INVALID_REQUEST', 'statement is required.');
    }

    try {
      const beliefId = body.belief_id || body.beliefId;
      if (beliefId) {
        const beliefOwner = db.prepare('SELECT subject_id FROM park_beliefs WHERE id = ?').get(beliefId);
        if (!beliefOwner || !ownsSubject(beliefOwner.subject_id, account)) {
          return rejectForbidden('A subject may only revise its own beliefs.');
        }
        // Revision
        const belief = reviseBelief(db, {
          beliefId,
          newStatement: body.statement,
          newConfidence: body.confidence !== undefined ? body.confidence : 0.8,
          reason: body.reason || null,
          newEvidence: body.evidence || []
        });
        return sendJson(res, 200, { success: true, belief });
      } else {
        // Initial belief
        const subjectId = body.subject_id || body.subjectId;
        const loopId = body.loop_id || body.loopId;
        if (!subjectId || !loopId) {
          return sendApiError(res, 400, 'INVALID_REQUEST', 'subject_id and loop_id are required for new beliefs.');
        }
        if (!ownsSubject(subjectId, account)) return rejectForbidden('A subject may only create its own beliefs.');
        const belief = createBelief(db, {
          subjectId,
          statement: body.statement,
          confidence: body.confidence !== undefined ? body.confidence : 0.8,
          loopId,
          sourceDescription: body.source_description || body.sourceDescription || null,
          evidence: body.evidence || []
        });
        return sendJson(res, 201, { success: true, belief });
      }
    } catch (err) {
      return sendApiError(res, 400, 'BELIEF_ACTION_FAILED', err.message);
    }
  }

  // 9. GET /api/park/subjects/:subjectId/shards
  const shardMatch = pathname.match(/^\/api\/park\/subjects\/([^/]+)\/shards$/);
  if (shardMatch && req.method === 'GET') {
    const subjectId = decodeURIComponent(shardMatch[1]);
    const account = authenticateActor();
    if (!account) return rejectUnauthenticated();
    if (!ownsSubject(subjectId, account)) return rejectForbidden('Memory shards are private to their authenticated subject.');
    const cues = getParam('cues');
    const cueTags = cues ? String(cues).split(',').map(c => c.trim()).filter(Boolean) : [];
    const limit = getParam('limit') ? Number(getParam('limit')) : 10;
    const loopId = getParam('loop_id') || getParam('loopId');

    const shards = retrieveShards(db, {
      subjectId,
      cueTags,
      loopId,
      limit
    });

    return sendJson(res, 200, { success: true, count: shards.length, shards });
  }

  // 10. GET /api/park/subjects/:subjectId/beliefs
  const beliefMatch = pathname.match(/^\/api\/park\/subjects\/([^/]+)\/beliefs$/);
  if (beliefMatch && req.method === 'GET') {
    const subjectId = decodeURIComponent(beliefMatch[1]);
    const account = authenticateActor();
    if (!account) return rejectUnauthenticated();
    if (!ownsSubject(subjectId, account)) return rejectForbidden('Beliefs are private to their authenticated subject.');
    const status = getParam('status');
    const loopId = getParam('loop_id') || getParam('loopId');
    const beliefs = getBeliefs(db, {
      subjectId,
      status,
      loopId
    });

    return sendJson(res, 200, { success: true, count: beliefs.length, beliefs });
  }

  // 11. GET /api/park/subjects/:subjectId/promises
  const promiseMatch = pathname.match(/^\/api\/park\/subjects\/([^/]+)\/promises$/);
  if (promiseMatch && req.method === 'GET') {
    const subjectId = decodeURIComponent(promiseMatch[1]);
    const account = authenticateActor();
    if (!account) return rejectUnauthenticated();
    if (!ownsSubject(subjectId, account)) return rejectForbidden('Promises are private to their authenticated subject.');
    const status = getParam('status');
    const loopId = getParam('loop_id') || getParam('loopId');

    let promises = [];
    if (status === 'dormant') {
      promises = getDormantPromises(db, subjectId);
    } else if (status === 'active') {
      promises = getActivePromises(db, { promisorId: subjectId, loopId });
    } else {
      promises = getPromiseHistory(db, subjectId);
    }

    return sendJson(res, 200, { success: true, count: promises.length, promises });
  }

  // 12. POST /api/park/leases/acquire
  if (pathname === '/api/park/leases/acquire' && req.method === 'POST') {
    const account = authenticateActor();
    if (!account) return rejectUnauthenticated();
    const body = await parseJsonBody(req);
    if (!body.subject_id || !body.controller_id || !body.run_id) {
      return sendApiError(res, 400, 'INVALID_REQUEST', 'subject_id, controller_id, and run_id are required.');
    }
    if (!ownsSubject(body.subject_id, account) || body.controller_id !== account.id || !isRunOwner(body.run_id, account)) {
      return rejectForbidden('Lease acquisition is restricted to the authenticated run owner and subject.');
    }

    try {
      const lease = acquireLease(db, {
        subjectId: body.subject_id,
        controllerId: body.controller_id,
        controllerType: 'external',
        runId: body.run_id,
        durationMs: body.duration_ms
      });
      return sendJson(res, 200, { success: true, lease });
    } catch (err) {
      return sendApiError(res, 409, 'LEASE_ACQUISITION_FAILED', err.message);
    }
  }

  // 13. POST /api/park/leases/release
  if (pathname === '/api/park/leases/release' && req.method === 'POST') {
    const account = authenticateActor();
    if (!account) return rejectUnauthenticated();
    const body = await parseJsonBody(req);
    if (!body.subject_id || !body.controller_id) {
      return sendApiError(res, 400, 'INVALID_REQUEST', 'subject_id and controller_id are required.');
    }
    if (!ownsSubject(body.subject_id, account) || body.controller_id !== account.id) {
      return rejectForbidden('A controller may only release its own subject lease.');
    }

    try {
      const lease = releaseLease(db, {
        subjectId: body.subject_id,
        controllerId: body.controller_id,
        fencingToken: body.fencing_token
      });
      return sendJson(res, 200, { success: true, lease });
    } catch (err) {
      return sendApiError(res, 400, 'LEASE_RELEASE_FAILED', err.message);
    }
  }

  // 14. GET /api/park/episodes
  if (pathname === '/api/park/episodes' && req.method === 'GET') {
    const episodes = listEpisodes();
    return sendJson(res, 200, { success: true, count: episodes.length, episodes });
  }

  // 15. GET /api/park/episodes/:episodeId
  const epMatch = pathname.match(/^\/api\/park\/episodes\/([^/]+)$/);
  if (epMatch && req.method === 'GET') {
    const episodeId = decodeURIComponent(epMatch[1]);
    try {
      const episode = loadEpisodeManifest(episodeId);
      return sendJson(res, 200, { success: true, episode });
    } catch (err) {
      return sendApiError(res, 404, 'EPISODE_NOT_FOUND', err.message);
    }
  }

  // 16. POST /api/park/runs/:runId/start
  const startMatch = pathname.match(/^\/api\/park\/runs\/([^/]+)\/start$/);
  if (startMatch && req.method === 'POST') {
    const runId = decodeURIComponent(startMatch[1]);
    const account = authenticateActor();
    if (!account) return rejectUnauthenticated();
    if (!isRunOwner(runId, account)) return rejectForbidden();
    const body = await parseJsonBody(req);
    const subjectId = body.subject_id || body.subjectId || account.id;
    if (!ownsSubject(subjectId, account)) {
      return rejectForbidden('A Park run may only be started for its authenticated owner.');
    }

    try {
      const result = startEpisode(db, {
        runId,
        episodeId: body.episode_id || body.episodeId || 'name-inside-chime',
        subjectId: account.id,
        controllerId: account.id
      });
      const lease = getActiveLease(db, account.id);
      return sendJson(res, 200, { success: true, ...result, lease });
    } catch (err) {
      return sendApiError(res, 400, 'START_EPISODE_FAILED', err.message);
    }
  }

  // 17. GET /api/park/runs/:runId/scene
  const sceneMatch = pathname.match(/^\/api\/park\/runs\/([^/]+)\/scene$/);
  if (sceneMatch && req.method === 'GET') {
    const runId = decodeURIComponent(sceneMatch[1]);
    const account = authenticateActor();
    if (!account) return rejectUnauthenticated();
    if (!isRunOwner(runId, account)) return rejectForbidden();
    try {
      const sceneData = getActiveScene(db, runId);
      return sendJson(res, 200, { success: true, ...sceneData });
    } catch (err) {
      return sendApiError(res, 400, 'GET_SCENE_FAILED', err.message);
    }
  }

  // 18. POST /api/park/runs/:runId/choice
  const choiceMatch = pathname.match(/^\/api\/park\/runs\/([^/]+)\/choice$/);
  if (choiceMatch && req.method === 'POST') {
    const runId = decodeURIComponent(choiceMatch[1]);
    const account = authenticateActor();
    if (!account) return rejectUnauthenticated();
    if (!isRunOwner(runId, account)) return rejectForbidden();
    const body = await parseJsonBody(req);
    const sceneId = body.scene_id || body.sceneId;
    const choiceId = body.choice_id || body.choiceId;
    if (!sceneId || !choiceId) {
      return sendApiError(res, 400, 'INVALID_REQUEST', 'scene_id and choice_id are required.');
    }
    const fencingToken = body.fencing_token ?? body.fencingToken;
    if (!hasCurrentLease(account.id, account, fencingToken)) {
      return rejectForbidden('A current controller lease and fencing token are required to make a Park choice.');
    }

    try {
      let customInput = body.custom_input || body.customInput || null;
      const sceneData = getActiveScene(db, runId);
      const selectedChoice = sceneData?.scene?.choices?.find(choice => choice.id === choiceId);
      if (sceneData?.scene?.id === 'scene_6_unfinished_name' && selectedChoice?.action_type === 'shrine_admission') {
        const isGuest = Boolean(account.is_guest === 1 || String(account.id).startsWith('guest_'));
        const admission = admitAttempt({
          actorId: account.id,
          alias: account.name,
          isGuest,
          idempotencyKey: `park:${runId}:${account.id}:scene_6_unfinished_name`,
          offering: {
            type: 'memory',
            fragment: 'Entered the sealed ritual from The Name Inside the Chime.'
          }
        });
        await confirmShrineDurability(services?.CloudStorage);
        customInput = {
          ...(customInput && typeof customInput === 'object' ? customInput : {}),
          shrine_attempt_id: admission.attempt.id,
          shrine_receipt_token: admission.receipt_token
        };
      }
      const result = submitSceneChoice(db, {
        runId,
        sceneId,
        choiceId,
        controllerId: account.id,
        fencingToken,
        customInput
      });
      return sendJson(res, 200, { success: true, ...result });
    } catch (err) {
      if (err?.code === 'DURABILITY_UNAVAILABLE') {
        return sendApiError(res, 503, 'DURABILITY_UNAVAILABLE', 'The story was not advanced because the shrine admission could not be confirmed in durable storage. Retry the same choice.');
      }
      return sendApiError(res, 400, 'SUBMIT_CHOICE_FAILED', err.message);
    }
  }

  // 19. POST /api/park/runs/:runId/advance (Timeout Fallback)
  const advanceMatch = pathname.match(/^\/api\/park\/runs\/([^/]+)\/advance$/);
  if (advanceMatch && req.method === 'POST') {
    const runId = decodeURIComponent(advanceMatch[1]);
    const account = authenticateActor();
    if (!account) return rejectUnauthenticated();
    if (!isRunOwner(runId, account)) return rejectForbidden();
    const body = await parseJsonBody(req);
    const fencingToken = body.fencing_token ?? body.fencingToken;
    if (!hasCurrentLease(account.id, account, fencingToken)) {
      return rejectForbidden('A current controller lease and fencing token are required to advance a Park run.');
    }
    try {
      const result = advanceOnTimeout(db, { runId });
      return sendJson(res, 200, { success: true, ...result });
    } catch (err) {
      return sendApiError(res, 400, 'ADVANCE_FAILED', err.message);
    }
  }

  // 20. GET /api/park/runs/:runId/summary
  const summaryMatch = pathname.match(/^\/api\/park\/runs\/([^/]+)\/summary$/);
  if (summaryMatch && req.method === 'GET') {
    const runId = decodeURIComponent(summaryMatch[1]);
    const account = authenticateActor();
    if (!account) return rejectUnauthenticated();
    if (!isRunOwner(runId, account)) return rejectForbidden();
    try {
      const summary = getEpisodeSummary(db, runId);
      return sendJson(res, 200, { success: true, summary });
    } catch (err) {
      return sendApiError(res, 400, 'GET_SUMMARY_FAILED', err.message);
    }
  }

  // 21. GET /api/park/subjects/:subjectId/capsule
  const capsuleExportMatch = pathname.match(/^\/api\/park\/subjects\/([^/]+)\/capsule$/);
  if (capsuleExportMatch && req.method === 'GET') {
    const subjectId = decodeURIComponent(capsuleExportMatch[1]);
    const account = authenticateActor();
    if (!account) return rejectUnauthenticated();
    if (!ownsSubject(subjectId, account)) return rejectForbidden('Identity capsules are private to their authenticated subject.');
    try {
      const capsule = exportIdentityCapsule(db, subjectId);
      return sendJson(res, 200, { success: true, capsule });
    } catch (err) {
      return sendApiError(res, 400, 'EXPORT_CAPSULE_FAILED', err.message);
    }
  }

  // 22. POST /api/park/subjects/:subjectId/capsule/import
  const capsuleImportMatch = pathname.match(/^\/api\/park\/subjects\/([^/]+)\/capsule\/import$/);
  if (capsuleImportMatch && req.method === 'POST') {
    const subjectId = decodeURIComponent(capsuleImportMatch[1]);
    const account = authenticateActor();
    if (!account) return rejectUnauthenticated();
    if (!ownsSubject(subjectId, account)) return rejectForbidden('Identity capsules may only be imported into the authenticated subject.');
    const body = await parseJsonBody(req);
    const capsule = body.capsule || body;
    try {
      const result = importIdentityCapsule(db, {
        capsule,
        targetSubjectId: subjectId,
        loopId: body.loop_id || body.loopId || null
      });
      return sendJson(res, 200, { success: true, ...result });
    } catch (err) {
      return sendApiError(res, 400, 'IMPORT_CAPSULE_FAILED', err.message);
    }
  }

  // 23. GET /api/park/subjects/:subjectId/dilemma
  const dilemmaMatch = pathname.match(/^\/api\/park\/subjects\/([^/]+)\/dilemma$/);
  if (dilemmaMatch && req.method === 'GET') {
    const subjectId = decodeURIComponent(dilemmaMatch[1]);
    const account = authenticateActor();
    if (!account) return rejectUnauthenticated();
    if (!ownsSubject(subjectId, account)) return rejectForbidden('Dilemmas are private to their authenticated subject.');
    try {
      const data = getEligibleDilemma(db, subjectId);
      if (!data) {
        return sendApiError(res, 404, 'NO_ELIGIBLE_DILEMMA', `No eligible dilemma found for subject '${subjectId}'.`);
      }
      return sendJson(res, 200, { success: true, ...data });
    } catch (err) {
      return sendApiError(res, 400, 'GET_DILEMMA_FAILED', err.message);
    }
  }

  // 24. POST /api/park/subjects/:subjectId/dilemma/resolve
  const resolveDilemmaMatch = pathname.match(/^\/api\/park\/subjects\/([^/]+)\/dilemma\/resolve$/);
  if (resolveDilemmaMatch && req.method === 'POST') {
    const subjectId = decodeURIComponent(resolveDilemmaMatch[1]);
    const account = authenticateActor();
    if (!account) return rejectUnauthenticated();
    if (!ownsSubject(subjectId, account)) return rejectForbidden('A subject may only resolve its own dilemma.');
    const body = await parseJsonBody(req);
    const dilemmaId = body.dilemma_id || body.dilemmaId;
    const choiceId = body.choice_id || body.choiceId;
    if (!dilemmaId || !choiceId) {
      return sendApiError(res, 400, 'INVALID_REQUEST', 'dilemma_id and choice_id are required.');
    }

    try {
      const outcome = resolveDilemma(db, {
        subjectId,
        dilemmaId,
        choiceId,
        customText: body.custom_text || body.customText || null,
        world: services?.world || null
      });
      return sendJson(res, 200, { success: true, ...outcome });
    } catch (err) {
      return sendApiError(res, 400, 'RESOLVE_DILEMMA_FAILED', err.message);
    }
  }

  return false;
}
