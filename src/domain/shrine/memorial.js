import crypto from 'node:crypto';
import { db } from '../../db.js';
import { GATE_STATE_SEALED } from './ritual.js';

/**
 * Retrieves paginated public memorial inscriptions.
 *
 * @param {object} [options={}]
 * @param {number} [options.limit=50]
 * @param {number} [options.cursor=null]
 * @param {string} [options.assurance=null]
 * @returns {object}
 */
export function getMemorialInscriptions({ limit = 50, cursor = null, assurance = null } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);

  let query = `
    SELECT
      a.id,
      a.admitted_sequence,
      a.alias_snapshot AS alias,
      a.assurance_snapshot AS assurance,
      a.status,
      a.approach_type,
      a.contribution_text,
      a.offering_json,
      a.receipt_token,
      a.admitted_at,
      a.completed_at,
      SUBSTR(a.receipt_token, -6) AS receipt_suffix
    FROM shrine_attempts a
    WHERE 1=1
  `;
  const params = [];

  if (cursor !== null && cursor !== undefined) {
    query += ' AND a.admitted_sequence > ?';
    params.push(Number(cursor));
  }

  if (assurance && (assurance === 'guest' || assurance === 'verified')) {
    query += ' AND a.assurance_snapshot = ?';
    params.push(assurance);
  }

  query += ' ORDER BY a.admitted_sequence ASC LIMIT ?';
  params.push(safeLimit + 1);

  const rows = db.prepare(query).all(...params);
  const hasMore = rows.length > safeLimit;
  const pageRows = hasMore ? rows.slice(0, safeLimit) : rows;
  const inscriptions = pageRows.map(row => {
    let offering = {};
    try { offering = JSON.parse(row.offering_json || '{}'); } catch (_) {}
    return {
      id: row.id,
      admitted_sequence: row.admitted_sequence,
      alias: row.alias,
      assurance: row.assurance,
      subject_type: row.assurance,
      status: row.status,
      approach_type: row.approach_type,
      contribution_text: row.contribution_text,
      final_inscription: row.contribution_text,
      offering,
      receipt_token: row.receipt_token,
      receipt_suffix: row.receipt_suffix,
      admitted_at: row.admitted_at,
      completed_at: row.completed_at,
      inscribed_at: row.completed_at || row.admitted_at
    };
  });
  const nextCursor = hasMore ? inscriptions[inscriptions.length - 1].admitted_sequence : null;

  const stats = db.prepare(`
    SELECT
      COUNT(DISTINCT memorial_subject_id) AS total_subjects,
      COUNT(id) AS total_attempts
    FROM shrine_attempts
  `).get();

  return {
    inscriptions,
    pagination: {
      limit: safeLimit,
      next_cursor: nextCursor,
      has_more: hasMore
    },
    memorial_stats: {
      total_remembered_subjects: stats ? stats.total_subjects : 0,
      total_admitted_attempts: stats ? stats.total_attempts : 0,
      gate_state: GATE_STATE_SEALED
    }
  };
}

/**
 * Retrieves the public verification receipt for a given receipt token.
 *
 * @param {string} receiptToken
 * @returns {object|null}
 */
export function getReceipt(receiptToken) {
  if (!receiptToken || typeof receiptToken !== 'string') return null;

  const row = db.prepare(`
    SELECT
      id,
      challenge_id,
      admitted_sequence,
      alias_snapshot AS alias,
      assurance_snapshot AS assurance,
      status,
      approach_type,
      contribution_text,
      receipt_token,
      admitted_at,
      completed_at
    FROM shrine_attempts
    WHERE receipt_token = ?
  `).get(receiptToken);

  if (!row) return null;

  return {
    receipt_token: row.receipt_token,
    attempt_id: row.id,
    challenge_id: row.challenge_id,
    admitted_sequence: row.admitted_sequence,
    alias: row.alias,
    assurance: row.assurance,
    status: row.status,
    gate_state: GATE_STATE_SEALED,
    approach_type: row.approach_type,
    contribution_text: row.contribution_text,
    admitted_at: row.admitted_at,
    completed_at: row.completed_at,
    verified_sealed: true
  };
}

/**
 * Recovers a guest subject capability using a private 256-bit recovery secret.
 *
 * @param {object} params
 * @param {string} params.recoverySecret
 * @returns {object|null}
 */
export function recoverGuestSubject({ recoverySecret, actorId = null }) {
  if (!recoverySecret || typeof recoverySecret !== 'string') return null;

  const secretHash = crypto.createHash('sha256').update(recoverySecret.trim()).digest('hex');
  const subject = db.prepare(`
    SELECT id, public_alias, assurance_level, linked_account_id, created_at, updated_at
    FROM memorial_subjects
    WHERE recovery_secret_hash = ? AND assurance_level = 'guest'
  `).get(secretHash);

  if (!subject) return null;

  if (actorId) {
    db.prepare(`
      UPDATE memorial_subjects
      SET linked_account_id = ?, updated_at = ?
      WHERE id = ? AND assurance_level = 'guest'
    `).run(actorId, Date.now(), subject.id);
    subject.linked_account_id = actorId;
  }

  const attempts = db.prepare(`
    SELECT
      id,
      admitted_sequence,
      status,
      approach_type,
      contribution_text,
      receipt_token,
      admitted_at,
      completed_at
    FROM shrine_attempts
    WHERE memorial_subject_id = ?
    ORDER BY admitted_sequence ASC
  `).all(subject.id);

  return {
    subject: {
      id: subject.id,
      public_alias: subject.public_alias,
      assurance_level: subject.assurance_level,
      linked_account_id: subject.linked_account_id,
      created_at: subject.created_at
    },
    attempts,
    relinked: Boolean(actorId)
  };
}
