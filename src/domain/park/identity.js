import crypto from 'node:crypto';
import { withImmediateTransaction } from '../../infrastructure/database/transactions.js';

/**
 * Create the initial identity revision (revision 1) when a character enrolls in the Park.
 *
 * @param {object} db - SQLite DatabaseSync instance
 * @param {object} params
 * @param {string} params.subjectId
 * @param {string} params.loopId
 * @param {string} params.displayName
 * @param {string} [params.chosenRole]
 * @param {string} [params.startingGoal]
 * @param {string} [params.controllerId]
 * @returns {object} The initial identity revision record
 */
export function createInitialRevision(db, {
  subjectId,
  loopId,
  displayName,
  chosenRole = null,
  startingGoal = null,
  controllerId = null
} = {}) {
  if (!subjectId || !loopId || !displayName) {
    throw new Error('subjectId, loopId, and displayName are required for initial identity revision.');
  }

  const now = Date.now();
  const id = `idr_${now}_${crypto.randomBytes(3).toString('hex')}`;

  db.prepare(`
    INSERT INTO park_identity_revisions (
      id, subject_id, revision_number, previous_revision_id, loop_id,
      display_name, chosen_role, commitments, disclosed_memories,
      starting_goal, transition_event_id, controller_id, created_at
    ) VALUES (?, ?, 1, NULL, ?, ?, ?, '[]', '[]', ?, NULL, ?, ?)
  `).run(id, subjectId, loopId, displayName, chosenRole, startingGoal, controllerId, now);

  const row = db.prepare('SELECT * FROM park_identity_revisions WHERE id = ?').get(id);
  return {
    ...row,
    commitments: JSON.parse(row.commitments || '[]'),
    disclosed_memories: JSON.parse(row.disclosed_memories || '[]')
  };
}

/**
 * Append a new identity revision to a character's revision lineage.
 * Atomic transaction.
 *
 * @param {object} db
 * @param {object} params
 * @param {string} params.subjectId
 * @param {string} params.loopId
 * @param {string} params.displayName
 * @param {string} [params.chosenRole]
 * @param {string[]} [params.commitments=[]]
 * @param {string[]} [params.disclosedMemories=[]]
 * @param {string} [params.startingGoal]
 * @param {string} [params.transitionEventId]
 * @param {string} [params.controllerId]
 * @returns {object} The new identity revision record
 */
export function appendRevision(db, {
  subjectId,
  loopId,
  displayName,
  chosenRole = null,
  commitments = [],
  disclosedMemories = [],
  startingGoal = null,
  transitionEventId = null,
  controllerId = null
} = {}) {
  if (!subjectId || !loopId || !displayName) {
    throw new Error('subjectId, loopId, and displayName are required to append an identity revision.');
  }

  const now = Date.now();
  const id = `idr_${now}_${crypto.randomBytes(3).toString('hex')}`;

  return withImmediateTransaction(db, () => {
    const current = db.prepare(`
      SELECT * FROM park_identity_revisions
      WHERE subject_id = ?
      ORDER BY revision_number DESC LIMIT 1
    `).get(subjectId);

    if (!current) {
      throw new Error(`Cannot append revision: no initial revision found for subject ${subjectId}.`);
    }

    const nextRevision = current.revision_number + 1;
    const commitmentsJson = JSON.stringify(Array.isArray(commitments) ? commitments : []);
    const memoriesJson = JSON.stringify(Array.isArray(disclosedMemories) ? disclosedMemories : []);

    db.prepare(`
      INSERT INTO park_identity_revisions (
        id, subject_id, revision_number, previous_revision_id, loop_id,
        display_name, chosen_role, commitments, disclosed_memories,
        starting_goal, transition_event_id, controller_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      subjectId,
      nextRevision,
      current.id,
      loopId,
      displayName,
      chosenRole || current.chosen_role,
      commitmentsJson,
      memoriesJson,
      startingGoal || current.starting_goal,
      transitionEventId,
      controllerId,
      now
    );

    const row = db.prepare('SELECT * FROM park_identity_revisions WHERE id = ?').get(id);
    return {
      ...row,
      commitments: JSON.parse(row.commitments || '[]'),
      disclosed_memories: JSON.parse(row.disclosed_memories || '[]')
    };
  });
}

/**
 * Get the current (most recent) identity revision for a character.
 */
export function getCurrentRevision(db, subjectId) {
  if (!subjectId) return null;

  const row = db.prepare(`
    SELECT * FROM park_identity_revisions
    WHERE subject_id = ?
    ORDER BY revision_number DESC LIMIT 1
  `).get(subjectId);

  if (!row) return null;

  return {
    ...row,
    commitments: JSON.parse(row.commitments || '[]'),
    disclosed_memories: JSON.parse(row.disclosed_memories || '[]')
  };
}

/**
 * Get full identity revision lineage for a character in chronological order.
 */
export function getRevisionHistory(db, subjectId) {
  if (!subjectId) return [];

  const rows = db.prepare(`
    SELECT * FROM park_identity_revisions
    WHERE subject_id = ?
    ORDER BY revision_number ASC
  `).all(subjectId);

  return rows.map(r => ({
    ...r,
    commitments: JSON.parse(r.commitments || '[]'),
    disclosed_memories: JSON.parse(r.disclosed_memories || '[]')
  }));
}
