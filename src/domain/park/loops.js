import crypto from 'node:crypto';
import { withImmediateTransaction } from '../../infrastructure/database/transactions.js';

/**
 * Create a new Park run and its initial loop (loop_number = 1).
 * Atomic transaction.
 *
 * @param {object} db - SQLite DatabaseSync instance
 * @param {object} params
 * @param {string} params.episodeId - Episode identifier (e.g. 'name-inside-chime')
 * @param {number} [params.scenarioVersion=1]
 * @param {string} [params.seed] - Deterministic random seed
 * @returns {{ run: object, loop: object }}
 */
export function createRun(db, { episodeId, scenarioVersion = 1, seed = null } = {}) {
  if (!episodeId) {
    throw new Error('episodeId is required to create a Park run.');
  }

  const now = Date.now();
  const runId = `run_${now}_${crypto.randomBytes(3).toString('hex')}`;
  const initialLoopId = `loop_${now}_${crypto.randomBytes(3).toString('hex')}`;
  const randomSeed = seed || `seed_${now}_${crypto.randomBytes(4).toString('hex')}`;

  return withImmediateTransaction(db, () => {
    db.prepare(`
      INSERT INTO park_runs (id, episode_id, scenario_version, status, random_seed, started_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?)
    `).run(runId, episodeId, scenarioVersion, randomSeed, now, now);

    db.prepare(`
      INSERT INTO park_loops (id, run_id, loop_number, status, random_seed, checkpoint_data, started_at)
      VALUES (?, ?, 1, 'active', ?, '{}', ?)
    `).run(initialLoopId, runId, randomSeed, now);

    const run = db.prepare('SELECT * FROM park_runs WHERE id = ?').get(runId);
    const loop = db.prepare('SELECT * FROM park_loops WHERE id = ?').get(initialLoopId);

    return {
      run,
      loop: {
        ...loop,
        checkpoint_data: JSON.parse(loop.checkpoint_data || '{}')
      }
    };
  });
}

/**
 * Get a run by ID.
 */
export function getRun(db, runId) {
  return db.prepare('SELECT * FROM park_runs WHERE id = ?').get(runId) || null;
}

/**
 * Get the currently active loop for a run.
 */
export function getCurrentLoop(db, runId) {
  const row = db.prepare(`
    SELECT * FROM park_loops
    WHERE run_id = ? AND status = 'active'
    ORDER BY loop_number DESC
    LIMIT 1
  `).get(runId);

  if (!row) return null;
  return {
    ...row,
    checkpoint_data: JSON.parse(row.checkpoint_data || '{}')
  };
}

/**
 * Get all loops for a run in chronological order.
 */
export function getRunHistory(db, runId) {
  const rows = db.prepare(`
    SELECT * FROM park_loops
    WHERE run_id = ?
    ORDER BY loop_number ASC
  `).all(runId);

  return rows.map(r => ({
    ...r,
    checkpoint_data: JSON.parse(r.checkpoint_data || '{}')
  }));
}

/**
 * Execute an atomic loop reset.
 *
 * Sequence:
 * 1. Validate active loop.
 * 2. Mark previous loop as 'reset', saving checkpoint metadata.
 * 3. Increment loop_number and insert new loop as 'active'.
 * 4. Suppress accessible memory shards from the previous loop (except retainedShardIds).
 * 5. Mark active promises from the previous loop as 'dormant'.
 * 6. Update park_runs updated_at.
 *
 * @param {object} db - SQLite DatabaseSync instance
 * @param {object} params
 * @param {string} params.runId
 * @param {string} params.currentLoopId
 * @param {object} [params.checkpointData={}]
 * @param {string[]} [params.retainedShardIds=[]] - Shards explicitly preserved across reset
 * @param {string} [params.newSeed]
 * @returns {{ previousLoopId: string, newLoop: object }}
 */
export function commitReset(db, {
  runId,
  currentLoopId,
  checkpointData = {},
  newLoopCheckpointData = undefined,
  retainedShardIds = [],
  newSeed = null
} = {}) {
  if (!runId || !currentLoopId) {
    throw new Error('runId and currentLoopId are required to commit a reset.');
  }

  const now = Date.now();

  return withImmediateTransaction(db, () => {
    const currentLoop = db.prepare(`
      SELECT * FROM park_loops WHERE id = ? AND run_id = ?
    `).get(currentLoopId, runId);

    if (!currentLoop) {
      throw new Error(`Loop ${currentLoopId} not found in run ${runId}.`);
    }

    if (currentLoop.status !== 'active' && currentLoop.status !== 'checkpoint') {
      throw new Error(`Loop ${currentLoopId} has status '${currentLoop.status}', cannot reset.`);
    }

    // 1. Mark current loop as reset
    db.prepare(`
      UPDATE park_loops
      SET status = 'reset', completed_at = ?, checkpoint_data = ?
      WHERE id = ?
    `).run(now, JSON.stringify(checkpointData), currentLoopId);

    // 2. Create next loop
    const nextLoopNumber = currentLoop.loop_number + 1;
    const nextLoopId = `loop_${now}_${crypto.randomBytes(3).toString('hex')}`;
    const nextSeed = newSeed || `${currentLoop.random_seed}_${nextLoopNumber}`;
    const newCheckpoint = newLoopCheckpointData !== undefined ? newLoopCheckpointData : checkpointData;

    db.prepare(`
      INSERT INTO park_loops (id, run_id, loop_number, status, random_seed, checkpoint_data, started_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?)
    `).run(nextLoopId, runId, nextLoopNumber, nextSeed, JSON.stringify(newCheckpoint || {}), now);

    // 3. Suppress accessible memory shards in the resetting loop
    if (Array.isArray(retainedShardIds) && retainedShardIds.length > 0) {
      const placeholders = retainedShardIds.map(() => '?').join(',');
      db.prepare(`
        UPDATE park_memory_shards
        SET visibility = 'suppressed'
        WHERE loop_id = ? AND visibility = 'accessible' AND id NOT IN (${placeholders})
      `).run(currentLoopId, ...retainedShardIds);
    } else {
      db.prepare(`
        UPDATE park_memory_shards
        SET visibility = 'suppressed'
        WHERE loop_id = ? AND visibility = 'accessible'
      `).run(currentLoopId);
    }

    // 4. Mark active promises from resetting loop as dormant
    db.prepare(`
      UPDATE park_promises
      SET status = 'dormant'
      WHERE loop_id = ? AND status = 'active'
    `).run(currentLoopId);

    // 5. Update run updated_at
    db.prepare(`
      UPDATE park_runs SET updated_at = ? WHERE id = ?
    `).run(now, runId);

    const newLoop = db.prepare('SELECT * FROM park_loops WHERE id = ?').get(nextLoopId);

    return {
      previousLoopId: currentLoopId,
      newLoop: {
        ...newLoop,
        checkpoint_data: JSON.parse(newLoop.checkpoint_data || '{}')
      }
    };
  });
}

/**
 * Complete a loop without triggering a reset (e.g. at end of episode).
 */
export function completeLoop(db, loopId) {
  const now = Date.now();
  db.prepare(`
    UPDATE park_loops SET status = 'completed', completed_at = ? WHERE id = ?
  `).run(now, loopId);
}

/**
 * Complete a run and its active loop.
 */
export function completeRun(db, runId) {
  const now = Date.now();
  return withImmediateTransaction(db, () => {
    db.prepare(`
      UPDATE park_loops SET status = 'completed', completed_at = ?
      WHERE run_id = ? AND status = 'active'
    `).run(now, runId);

    db.prepare(`
      UPDATE park_runs SET status = 'completed', completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, runId);
  });
}

/**
 * Startup crash recovery check.
 * If a loop was left in 'checkpoint' state without finishing a reset,
 * resets it safely.
 */
export function recoverIncompleteReset(db, runId) {
  const checkpointLoop = db.prepare(`
    SELECT * FROM park_loops
    WHERE run_id = ? AND status = 'checkpoint'
    ORDER BY loop_number DESC LIMIT 1
  `).get(runId);

  if (!checkpointLoop) return null;

  return commitReset(db, {
    runId,
    currentLoopId: checkpointLoop.id,
    checkpointData: JSON.parse(checkpointLoop.checkpoint_data || '{}')
  });
}
