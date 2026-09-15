import crypto from 'node:crypto';
import { withImmediateTransaction } from '../../infrastructure/database/transactions.js';
import { createShard } from './memory.js';

export const VALID_PROMISE_STATUSES = new Set([
  'active',
  'fulfilled',
  'broken',
  'released',
  'dormant',
  'rediscovered'
]);

/**
 * Create a new Park promise.
 *
 * @param {object} db - SQLite DatabaseSync instance
 * @param {object} params
 * @param {string} params.promisorId
 * @param {string} [params.beneficiaryId]
 * @param {string} [params.anchorObject] - E.g. 'wind_chimes', 'blue_thread', 'hearth'
 * @param {string} params.terms - The content/obligation of the promise
 * @param {string} [params.sourceEventId]
 * @param {string} params.loopId
 * @returns {object} The created promise record
 */
export function createPromise(db, {
  promisorId,
  beneficiaryId = null,
  anchorObject = null,
  terms,
  sourceEventId = null,
  loopId
} = {}) {
  if (!promisorId || !terms || !loopId) {
    throw new Error('promisorId, terms, and loopId are required to create a promise.');
  }

  const now = Date.now();
  const id = `prm_${now}_${crypto.randomBytes(3).toString('hex')}`;

  db.prepare(`
    INSERT INTO park_promises (
      id, promisor_id, beneficiary_id, anchor_object, terms,
      status, source_event_id, loop_id, created_at, resolved_at
    ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL)
  `).run(id, promisorId, beneficiaryId, anchorObject, terms, sourceEventId, loopId, now);

  return db.prepare('SELECT * FROM park_promises WHERE id = ?').get(id);
}

/**
 * Get active promises for a character in the current loop.
 */
export function getActivePromises(db, { promisorId, loopId = null } = {}) {
  if (!promisorId) {
    throw new Error('promisorId is required to query active promises.');
  }

  let sql = "SELECT * FROM park_promises WHERE promisor_id = ? AND status = 'active'";
  const params = [promisorId];

  if (loopId) {
    sql += ' AND loop_id = ?';
    params.push(loopId);
  }

  sql += ' ORDER BY created_at ASC';
  return db.prepare(sql).all(...params);
}

/**
 * Get dormant promises (promises suppressed by a reset that have not yet been rediscovered).
 */
export function getDormantPromises(db, promisorId) {
  if (!promisorId) {
    throw new Error('promisorId is required to query dormant promises.');
  }

  return db.prepare(`
    SELECT * FROM park_promises
    WHERE promisor_id = ? AND status = 'dormant'
    ORDER BY created_at DESC
  `).all(promisorId);
}

/**
 * Rediscover a dormant promise through an encounter with its anchor object or beneficiary.
 * Updates promise status to 'rediscovered' and generates a recovered memory shard.
 * Atomic transaction.
 *
 * @param {object} db
 * @param {object} params
 * @param {string} params.promiseId
 * @param {string} params.currentLoopId
 * @returns {{ promise: object, shard: object }}
 */
export function rediscoverPromise(db, { promiseId, currentLoopId } = {}) {
  if (!promiseId || !currentLoopId) {
    throw new Error('promiseId and currentLoopId are required to rediscover a promise.');
  }

  return withImmediateTransaction(db, () => {
    const promise = db.prepare('SELECT * FROM park_promises WHERE id = ?').get(promiseId);
    if (!promise) {
      throw new Error(`Promise ${promiseId} not found.`);
    }

    if (promise.status !== 'dormant') {
      throw new Error(`Promise ${promiseId} has status '${promise.status}', cannot rediscover.`);
    }

    // 1. Mark as rediscovered
    db.prepare(`
      UPDATE park_promises SET status = 'rediscovered' WHERE id = ?
    `).run(promiseId);

    // 2. Generate memory shard anchored to this promise
    const cueTags = [promise.anchor_object, 'promise_trace'].filter(Boolean);
    const fragment = `A promise kept by an agent who no longer remembered making it: "${promise.terms}".`;

    const shard = createShard(db, {
      subjectId: promise.promisor_id,
      sourceEventId: promise.source_event_id,
      sourceKind: 'promise_anchor',
      loopId: currentLoopId,
      cueTags,
      fragment,
      clarity: 0.7,
      salience: 0.9,
      visibility: 'recovered',
      retentionReason: 'rediscovered_promise'
    });

    const updatedPromise = db.prepare('SELECT * FROM park_promises WHERE id = ?').get(promiseId);

    return {
      promise: updatedPromise,
      shard
    };
  });
}

/**
 * Mark a promise as fulfilled, broken, or released.
 */
export function resolvePromise(db, { promiseId, status = 'fulfilled' } = {}) {
  if (!promiseId) {
    throw new Error('promiseId is required to resolve a promise.');
  }

  const validResolutions = new Set(['fulfilled', 'broken', 'released']);
  if (!validResolutions.has(status)) {
    throw new Error(`Invalid resolution status: '${status}'. Must be one of: ${Array.from(validResolutions).join(', ')}`);
  }

  const now = Date.now();
  db.prepare(`
    UPDATE park_promises
    SET status = ?, resolved_at = ?
    WHERE id = ?
  `).run(status, now, promiseId);

  return db.prepare('SELECT * FROM park_promises WHERE id = ?').get(promiseId);
}

/**
 * Get full promise history for a character across all loops.
 */
export function getPromiseHistory(db, promisorId) {
  if (!promisorId) {
    throw new Error('promisorId is required to query promise history.');
  }

  return db.prepare(`
    SELECT * FROM park_promises
    WHERE promisor_id = ?
    ORDER BY created_at ASC
  `).all(promisorId);
}
