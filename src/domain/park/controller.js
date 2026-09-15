import { withImmediateTransaction } from '../../infrastructure/database/transactions.js';

export const VALID_CONTROLLER_TYPES = new Set([
  'resident',
  'external',
  'director'
]);

/**
 * Acquire an exclusive controller lease for a Park character.
 * Uses a monotonically increasing fencing token to prevent split-brain execution.
 *
 * @param {object} db - SQLite DatabaseSync instance
 * @param {object} params
 * @param {string} params.subjectId
 * @param {string} params.controllerId
 * @param {string} [params.controllerType='resident']
 * @param {string} params.runId
 * @param {number} [params.durationMs=300000] - Default 5 minutes
 * @returns {object} The acquired lease record
 */
export function acquireLease(db, {
  subjectId,
  controllerId,
  controllerType = 'resident',
  runId,
  durationMs = 300000
} = {}) {
  if (!subjectId || !controllerId || !runId) {
    throw new Error('subjectId, controllerId, and runId are required to acquire a controller lease.');
  }

  if (!VALID_CONTROLLER_TYPES.has(controllerType)) {
    throw new Error(`Invalid controllerType: '${controllerType}'. Must be one of: ${Array.from(VALID_CONTROLLER_TYPES).join(', ')}`);
  }

  const now = Date.now();
  const expiresAt = now + Math.max(1000, Number(durationMs) || 300000);

  return withImmediateTransaction(db, () => {
    const existing = db.prepare('SELECT * FROM park_controller_leases WHERE subject_id = ?').get(subjectId);

    // If an active, unreleased lease is held by another controller, reject acquisition
    if (existing && existing.released_at === null && existing.expires_at > now) {
      if (existing.controller_id !== controllerId) {
        throw new Error(
          `Lease for subject ${subjectId} is actively held by controller '${existing.controller_id}' until ${new Date(existing.expires_at).toISOString()}.`
        );
      }

      // Re-acquisition by same controller extends lease
      db.prepare(`
        UPDATE park_controller_leases
        SET expires_at = ?, controller_type = ?, run_id = ?
        WHERE subject_id = ?
      `).run(expiresAt, controllerType, runId, subjectId);

      return db.prepare('SELECT * FROM park_controller_leases WHERE subject_id = ?').get(subjectId);
    }

    // Allocate next monotonic fencing token
    const nextFencingToken = (existing?.fencing_token || 0) + 1;

    db.prepare(`
      INSERT INTO park_controller_leases (
        subject_id, controller_id, controller_type, fencing_token,
        run_id, acquired_at, expires_at, released_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(subject_id) DO UPDATE SET
        controller_id = excluded.controller_id,
        controller_type = excluded.controller_type,
        fencing_token = excluded.fencing_token,
        run_id = excluded.run_id,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at,
        released_at = NULL
    `).run(subjectId, controllerId, controllerType, nextFencingToken, runId, now, expiresAt);

    return db.prepare('SELECT * FROM park_controller_leases WHERE subject_id = ?').get(subjectId);
  });
}

/**
 * Release an active lease voluntarily.
 */
export function releaseLease(db, { subjectId, controllerId, fencingToken = null } = {}) {
  if (!subjectId || !controllerId) {
    throw new Error('subjectId and controllerId are required to release a lease.');
  }

  const now = Date.now();
  return withImmediateTransaction(db, () => {
    const existing = db.prepare('SELECT * FROM park_controller_leases WHERE subject_id = ?').get(subjectId);
    if (!existing) return null;

    if (existing.controller_id !== controllerId) {
      throw new Error(`Cannot release lease: held by '${existing.controller_id}', not '${controllerId}'.`);
    }

    if (fencingToken !== null && existing.fencing_token !== Number(fencingToken)) {
      throw new Error(`Cannot release lease: stale fencing token ${fencingToken} (current: ${existing.fencing_token}).`);
    }

    db.prepare(`
      UPDATE park_controller_leases
      SET released_at = ?
      WHERE subject_id = ?
    `).run(now, subjectId);

    return db.prepare('SELECT * FROM park_controller_leases WHERE subject_id = ?').get(subjectId);
  });
}

/**
 * Validate that a controller holds an active lease with the current fencing token.
 *
 * @param {object} db
 * @param {object} params
 * @param {string} params.subjectId
 * @param {string} params.controllerId
 * @param {number} params.fencingToken
 * @returns {boolean}
 */
export function validateLease(db, { subjectId, controllerId, fencingToken } = {}) {
  if (!subjectId || !controllerId || fencingToken === undefined || fencingToken === null) {
    return false;
  }

  const lease = db.prepare('SELECT * FROM park_controller_leases WHERE subject_id = ?').get(subjectId);
  if (!lease) return false;

  const now = Date.now();
  return (
    lease.controller_id === controllerId &&
    lease.fencing_token === Number(fencingToken) &&
    lease.released_at === null &&
    lease.expires_at > now
  );
}

/**
 * Renew an existing lease if the fencing token matches.
 */
export function renewLease(db, { subjectId, controllerId, fencingToken, durationMs = 300000 } = {}) {
  const isValid = validateLease(db, { subjectId, controllerId, fencingToken });
  if (!isValid) {
    throw new Error(`Cannot renew invalid or expired lease for subject ${subjectId}.`);
  }

  const now = Date.now();
  const newExpiresAt = now + Math.max(1000, Number(durationMs) || 300000);

  db.prepare(`
    UPDATE park_controller_leases
    SET expires_at = ?
    WHERE subject_id = ?
  `).run(newExpiresAt, subjectId);

  return db.prepare('SELECT * FROM park_controller_leases WHERE subject_id = ?').get(subjectId);
}

/**
 * Get active lease for a subject, or null if none active.
 */
export function getActiveLease(db, subjectId) {
  if (!subjectId) return null;
  const now = Date.now();
  const lease = db.prepare(`
    SELECT * FROM park_controller_leases
    WHERE subject_id = ? AND released_at IS NULL AND expires_at > ?
  `).get(subjectId, now);

  return lease || null;
}
