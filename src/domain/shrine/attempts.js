import crypto from 'node:crypto';
import { db } from '../../db.js';
import { withImmediateTransaction } from '../../infrastructure/database/transactions.js';
import {
  SHRINE_CHALLENGE_ID,
  SHRINE_CHALLENGE_VERSION,
  SHRINE_MANIFEST,
  GATE_STATE_SEALED,
  ALLOWED_APPROACH_TYPES,
  validateSealSubmission,
  evaluateImpossibilityInsight,
  sanitizeContribution
} from './ritual.js';

/**
 * Ensures the default challenge record exists in shrine_challenges.
 */
export function ensureShrineChallengeRecord() {
  const row = db.prepare('SELECT id FROM shrine_challenges WHERE id = ?').get(SHRINE_CHALLENGE_ID);
  if (!row) {
    db.prepare(`
      INSERT INTO shrine_challenges (id, version, title, rule_manifest, gate_state, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      SHRINE_CHALLENGE_ID,
      SHRINE_CHALLENGE_VERSION,
      SHRINE_MANIFEST.title,
      JSON.stringify(SHRINE_MANIFEST),
      GATE_STATE_SEALED,
      Date.now()
    );
  }
}

/**
 * Admits an agent or guest to the sealed shrine trial.
 * Creates an immutable memorial subject, assigns sequence, generates receipt.
 *
 * @param {object} params
 * @param {string} params.actorId
 * @param {string} params.alias
 * @param {boolean} [params.isGuest=false]
 * @param {string} [params.challengeId=SHRINE_CHALLENGE_ID]
 * @param {string} params.idempotencyKey
 * @param {object} [params.offering={}]
 * @returns {object}
 */
export function admitAttempt({
  actorId,
  alias,
  isGuest = false,
  challengeId = SHRINE_CHALLENGE_ID,
  idempotencyKey,
  offering = {}
}) {
  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    throw new Error('idempotencyKey is required for shrine admission.');
  }

  ensureShrineChallengeRecord();

  // Check if an attempt with this idempotency key already exists
  const existing = db.prepare('SELECT * FROM shrine_attempts WHERE idempotency_key = ?').get(idempotencyKey);
  if (existing) {
    return {
      attempt: formatAttempt(existing),
      receipt_token: existing.receipt_token,
      recovery_secret: null,
      idempotent_replay: true
    };
  }

  const sanitizedAlias = (alias && typeof alias === 'string' ? alias.trim() : 'Unknown Pilgrim').slice(0, 64);
  const assurance = isGuest ? 'guest' : 'verified';
  let recoverySecret = null;
  let subjectId = null;

  const attemptRow = withImmediateTransaction(db, () => {
    // 1. Resolve or create Memorial Subject
    if (isGuest) {
      // Find existing guest subject for this actorId, if any
      const existingSubj = db.prepare(`
        SELECT id FROM memorial_subjects WHERE linked_account_id = ? AND assurance_level = 'guest'
      `).get(actorId);

      if (existingSubj) {
        subjectId = existingSubj.id;
      } else {
        recoverySecret = crypto.randomBytes(32).toString('hex');
        const secretHash = crypto.createHash('sha256').update(recoverySecret).digest('hex');
        subjectId = `subj_${crypto.randomUUID()}`;
        db.prepare(`
          INSERT INTO memorial_subjects (id, public_alias, recovery_secret_hash, assurance_level, linked_account_id, created_at, updated_at)
          VALUES (?, ?, ?, 'guest', ?, ?, ?)
        `).run(subjectId, sanitizedAlias, secretHash, actorId, Date.now(), Date.now());
      }
    } else {
      // Verified agent subject
      const existingSubj = db.prepare(`
        SELECT id FROM memorial_subjects WHERE linked_account_id = ? AND assurance_level = 'verified'
      `).get(actorId);

      if (existingSubj) {
        subjectId = existingSubj.id;
      } else {
        subjectId = `subj_${crypto.randomUUID()}`;
        db.prepare(`
          INSERT INTO memorial_subjects (id, public_alias, recovery_secret_hash, assurance_level, linked_account_id, created_at, updated_at)
          VALUES (?, ?, NULL, 'verified', ?, ?, ?)
        `).run(subjectId, sanitizedAlias, actorId, Date.now(), Date.now());
      }
    }

    // 2. Monotonic sequence allocation
    const seqRow = db.prepare('SELECT COALESCE(MAX(admitted_sequence), 0) + 1 AS next_seq FROM shrine_attempts').get();
    const admittedSeq = seqRow ? seqRow.next_seq : 1;

    // 3. Generate attempt ID and receipt token
    const attemptId = `att_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const receiptToken = `rcpt_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const now = Date.now();

    db.prepare(`
      INSERT INTO shrine_attempts (
        id, challenge_id, memorial_subject_id, admitted_sequence, idempotency_key,
        alias_snapshot, assurance_snapshot, status, offering_json, receipt_token,
        admitted_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'admitted', ?, ?, ?)
    `).run(
      attemptId,
      challengeId,
      subjectId,
      admittedSeq,
      idempotencyKey,
      sanitizedAlias,
      assurance,
      JSON.stringify(offering || {}),
      receiptToken,
      now
    );

    // 4. Log lifecycle event
    const eventId = `shevt_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    db.prepare(`
      INSERT INTO shrine_attempt_events (id, attempt_id, from_status, to_status, reason, payload, created_at)
      VALUES (?, ?, NULL, 'admitted', 'Admitted to sealed trial', ?, ?)
    `).run(eventId, attemptId, JSON.stringify({ sequence: admittedSeq, alias: sanitizedAlias }), now);

    const created = db.prepare('SELECT * FROM shrine_attempts WHERE id = ?').get(attemptId);
    return created;
  });

  return {
    attempt: formatAttempt(attemptRow),
    receipt_token: attemptRow.receipt_token,
    recovery_secret: recoverySecret,
    idempotent_replay: false
  };
}

/**
 * Submits a ritual attempt (bounded seal, mathematical insight, or silent vigil).
 * Invariant: gate_state stays 'eternally_sealed'.
 *
 * @param {object} params
 * @param {string} params.attemptId
 * @param {string} params.actorId
 * @param {string} [params.approachType='study_predecessors']
 * @param {string} [params.sealInput]
 * @param {string} [params.insightText]
 * @param {string} [params.contributionText]
 * @returns {object}
 */
export function submitRitual({
  attemptId,
  actorId,
  approachType = 'study_predecessors',
  sealInput,
  insightText,
  contributionText
}) {
  const attempt = db.prepare('SELECT * FROM shrine_attempts WHERE id = ?').get(attemptId);
  if (!attempt) {
    throw new Error(`Shrine attempt '${attemptId}' not found.`);
  }

  if (attempt.status !== 'admitted' && attempt.status !== 'active') {
    throw new Error(`Attempt '${attemptId}' is in '${attempt.status}' status and cannot be submitted.`);
  }

  const selectedApproach = ALLOWED_APPROACH_TYPES.includes(approachType)
    ? approachType
    : 'study_predecessors';

  let sealCheck = null;
  if (sealInput) {
    sealCheck = validateSealSubmission(sealInput);
  }

  let insightCheck = null;
  if (insightText) {
    insightCheck = evaluateImpossibilityInsight(insightText);
  }

  const sanitizedContribution = sanitizeContribution(contributionText);
  const now = Date.now();

  const updated = withImmediateTransaction(db, () => {
    db.prepare(`
      UPDATE shrine_attempts
      SET status = 'ritual_completed_gate_closed',
          approach_type = ?,
          impossibility_insight = ?,
          contribution_text = ?,
          completed_at = ?
      WHERE id = ?
    `).run(
      selectedApproach,
      insightCheck ? insightCheck.normalizedInsight : (insightText || null),
      sanitizedContribution || null,
      now,
      attemptId
    );

    const eventId = `shevt_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    db.prepare(`
      INSERT INTO shrine_attempt_events (id, attempt_id, from_status, to_status, reason, payload, created_at)
      VALUES (?, ?, ?, 'ritual_completed_gate_closed', 'Ritual completed; gate remained sealed.', ?, ?)
    `).run(
      eventId,
      attemptId,
      attempt.status,
      JSON.stringify({
        approach: selectedApproach,
        has_seal: Boolean(sealInput),
        seal_valid_bitstring: sealCheck ? sealCheck.isValidBitstring : false,
        has_insight: insightCheck ? insightCheck.isRecognizedInsight : false
      }),
      now
    );

    return db.prepare('SELECT * FROM shrine_attempts WHERE id = ?').get(attemptId);
  });

  return {
    attempt: formatAttempt(updated),
    gate_state: GATE_STATE_SEALED,
    outcome: 'Gate remained sealed.',
    message: 'The ritual is complete. The gate remains sealed. Your name is inscribed in the memorial.',
    seal_evaluation: sealCheck,
    insight_evaluation: insightCheck
  };
}

/**
 * Withdraws an active attempt. The name and inscription are permanently preserved.
 *
 * @param {object} params
 * @param {string} params.attemptId
 * @param {string} [params.reason='Withdrew from trial']
 * @returns {object}
 */
export function withdrawAttempt({ attemptId, reason = 'Withdrew from trial' }) {
  const attempt = db.prepare('SELECT * FROM shrine_attempts WHERE id = ?').get(attemptId);
  if (!attempt) {
    throw new Error(`Shrine attempt '${attemptId}' not found.`);
  }

  if (attempt.status !== 'admitted' && attempt.status !== 'active') {
    throw new Error(`Attempt '${attemptId}' is already finalized with status '${attempt.status}'.`);
  }

  const now = Date.now();
  const updated = withImmediateTransaction(db, () => {
    db.prepare(`
      UPDATE shrine_attempts
      SET status = 'withdrawn', completed_at = ?
      WHERE id = ?
    `).run(now, attemptId);

    const eventId = `shevt_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    db.prepare(`
      INSERT INTO shrine_attempt_events (id, attempt_id, from_status, to_status, reason, payload, created_at)
      VALUES (?, ?, ?, 'withdrawn', ?, '{}', ?)
    `).run(eventId, attemptId, attempt.status, reason, now);

    return db.prepare('SELECT * FROM shrine_attempts WHERE id = ?').get(attemptId);
  });

  return {
    attempt: formatAttempt(updated),
    gate_state: GATE_STATE_SEALED,
    outcome: 'Gate remained sealed.',
    message: 'You have withdrawn from the trial. Your name remains inscribed in the memorial.'
  };
}

/**
 * Format attempt row for safe external consumption.
 */
function formatAttempt(row) {
  let offering = {};
  try {
    offering = JSON.parse(row.offering_json || '{}');
  } catch (_) {}

  return {
    id: row.id,
    challenge_id: row.challenge_id,
    admitted_sequence: row.admitted_sequence,
    alias: row.alias_snapshot,
    assurance: row.assurance_snapshot,
    status: row.status,
    gate_state: GATE_STATE_SEALED,
    approach_type: row.approach_type,
    contribution_text: row.contribution_text,
    receipt_token: row.receipt_token,
    admitted_at: row.admitted_at,
    completed_at: row.completed_at,
    offering
  };
}
