import crypto from 'node:crypto';
import { withImmediateTransaction } from '../../infrastructure/database/transactions.js';

export const VALID_BELIEF_STATUSES = new Set([
  'held',
  'questioned',
  'revised',
  'abandoned',
  'confirmed'
]);

export const VALID_EVIDENCE_RELATIONS = new Set([
  'supports',
  'contradicts',
  'uncertain'
]);

/**
 * Create a new belief with optional initial evidence links.
 *
 * @param {object} db - SQLite DatabaseSync instance
 * @param {object} params
 * @param {string} params.subjectId
 * @param {string} params.statement
 * @param {number} params.confidence - [0.0, 1.0]
 * @param {string} params.loopId
 * @param {string} [params.sourceDescription]
 * @param {Array<{evidenceId: string, relation?: string, isIndependent?: boolean}>} [params.evidence=[]]
 * @returns {object} The created belief record
 */
export function createBelief(db, {
  subjectId,
  statement,
  confidence,
  loopId,
  sourceDescription = null,
  evidence = []
} = {}) {
  if (!subjectId || !statement || !loopId) {
    throw new Error('subjectId, statement, and loopId are required to create a belief.');
  }

  const clampedConfidence = Math.max(0, Math.min(1, Number(confidence) || 0));
  const now = Date.now();
  const id = `blf_${now}_${crypto.randomBytes(3).toString('hex')}`;

  return withImmediateTransaction(db, () => {
    db.prepare(`
      INSERT INTO park_beliefs (
        id, subject_id, statement, confidence, status, loop_id,
        revision_number, previous_belief_id, source_description, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'held', ?, 1, NULL, ?, ?, ?)
    `).run(id, subjectId, statement, clampedConfidence, loopId, sourceDescription, now, now);

    if (Array.isArray(evidence)) {
      for (const item of evidence) {
        if (!item?.evidenceId) continue;
        const relation = VALID_EVIDENCE_RELATIONS.has(item.relation) ? item.relation : 'supports';
        const isIndep = item.isIndependent === false ? 0 : 1;

        db.prepare(`
          INSERT INTO park_belief_evidence (
            belief_id, evidence_id, relation, source_count, is_independent, added_at
          ) VALUES (?, ?, ?, 1, ?, ?)
        `).run(id, item.evidenceId, relation, isIndep, now);
      }
    }

    const row = db.prepare('SELECT * FROM park_beliefs WHERE id = ?').get(id);
    const linkedEvidence = db.prepare('SELECT * FROM park_belief_evidence WHERE belief_id = ?').all(id);

    return {
      ...row,
      evidence: linkedEvidence
    };
  });
}

/**
 * Link evidence to an existing belief.
 * Respects source independence: if not independent, increments source_count
 * rather than treating repeated accounts as new independent sources.
 */
export function addEvidence(db, {
  beliefId,
  evidenceId,
  relation = 'supports',
  isIndependent = true
} = {}) {
  if (!beliefId || !evidenceId) {
    throw new Error('beliefId and evidenceId are required to add evidence.');
  }

  const rel = VALID_EVIDENCE_RELATIONS.has(relation) ? relation : 'supports';
  const isIndep = isIndependent === false ? 0 : 1;
  const now = Date.now();

  return withImmediateTransaction(db, () => {
    const existing = db.prepare(`
      SELECT * FROM park_belief_evidence
      WHERE belief_id = ? AND evidence_id = ?
    `).get(beliefId, evidenceId);

    if (existing) {
      if (!isIndep) {
        // Non-independent testimony from the same source: increment count without adding independent weight
        db.prepare(`
          UPDATE park_belief_evidence
          SET source_count = source_count + 1
          WHERE belief_id = ? AND evidence_id = ?
        `).run(beliefId, evidenceId);
      }
    } else {
      db.prepare(`
        INSERT INTO park_belief_evidence (
          belief_id, evidence_id, relation, source_count, is_independent, added_at
        ) VALUES (?, ?, ?, 1, ?, ?)
      `).run(beliefId, evidenceId, rel, isIndep, now);
    }

    db.prepare(`
      UPDATE park_beliefs SET updated_at = ? WHERE id = ?
    `).run(now, beliefId);

    return db.prepare(`
      SELECT * FROM park_belief_evidence
      WHERE belief_id = ? AND evidence_id = ?
    `).get(beliefId, evidenceId);
  });
}

/**
 * Revise a belief with a new statement or updated confidence, creating an explicit
 * revision successor pointing back to the predecessor.
 *
 * @param {object} db
 * @param {object} params
 * @param {string} params.beliefId - Current belief to revise
 * @param {string} params.newStatement
 * @param {number} params.newConfidence
 * @param {string} params.reason - Explanation of why the belief was revised
 * @param {Array<{evidenceId: string, relation?: string, isIndependent?: boolean}>} [params.newEvidence=[]]
 * @returns {object} The new revision belief record
 */
export function reviseBelief(db, {
  beliefId,
  newStatement,
  newConfidence,
  reason,
  newEvidence = []
} = {}) {
  if (!beliefId || !newStatement) {
    throw new Error('beliefId and newStatement are required to revise a belief.');
  }

  const clampedConfidence = Math.max(0, Math.min(1, Number(newConfidence) || 0));
  const now = Date.now();
  const nextId = `blf_${now}_${crypto.randomBytes(3).toString('hex')}`;

  return withImmediateTransaction(db, () => {
    const current = db.prepare('SELECT * FROM park_beliefs WHERE id = ?').get(beliefId);
    if (!current) {
      throw new Error(`Belief ${beliefId} not found.`);
    }

    // 1. Mark current belief as revised
    db.prepare(`
      UPDATE park_beliefs SET status = 'revised', updated_at = ? WHERE id = ?
    `).run(now, beliefId);

    // 2. Insert new revision
    const nextRevision = current.revision_number + 1;
    db.prepare(`
      INSERT INTO park_beliefs (
        id, subject_id, statement, confidence, status, loop_id,
        revision_number, previous_belief_id, source_description, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'held', ?, ?, ?, ?, ?, ?)
    `).run(
      nextId,
      current.subject_id,
      newStatement,
      clampedConfidence,
      current.loop_id,
      nextRevision,
      beliefId,
      reason || current.source_description,
      now,
      now
    );

    // 3. Carry over existing evidence + add new evidence
    const priorEvidence = db.prepare('SELECT * FROM park_belief_evidence WHERE belief_id = ?').all(beliefId);
    for (const e of priorEvidence) {
      db.prepare(`
        INSERT OR IGNORE INTO park_belief_evidence (
          belief_id, evidence_id, relation, source_count, is_independent, added_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(nextId, e.evidence_id, e.relation, e.source_count, e.is_independent, now);
    }

    if (Array.isArray(newEvidence)) {
      for (const item of newEvidence) {
        if (!item?.evidenceId) continue;
        const rel = VALID_EVIDENCE_RELATIONS.has(item.relation) ? item.relation : 'supports';
        const isIndep = item.isIndependent === false ? 0 : 1;
        db.prepare(`
          INSERT OR IGNORE INTO park_belief_evidence (
            belief_id, evidence_id, relation, source_count, is_independent, added_at
          ) VALUES (?, ?, ?, 1, ?, ?)
        `).run(nextId, item.evidenceId, rel, isIndep, now);
      }
    }

    const row = db.prepare('SELECT * FROM park_beliefs WHERE id = ?').get(nextId);
    const linkedEvidence = db.prepare('SELECT * FROM park_belief_evidence WHERE belief_id = ?').all(nextId);

    return {
      ...row,
      evidence: linkedEvidence
    };
  });
}

/**
 * Get active/held beliefs for a subject.
 */
export function getBeliefs(db, { subjectId, status = null, loopId = null } = {}) {
  if (!subjectId) {
    throw new Error('subjectId is required to query beliefs.');
  }

  let sql = 'SELECT * FROM park_beliefs WHERE subject_id = ?';
  const params = [subjectId];

  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }

  if (loopId) {
    sql += ' AND loop_id = ?';
    params.push(loopId);
  }

  sql += ' ORDER BY revision_number DESC, updated_at DESC';
  return db.prepare(sql).all(...params);
}

/**
 * Trace the full revision lineage of a belief backwards from current to initial.
 */
export function getBeliefHistory(db, beliefId) {
  const history = [];
  let currentId = beliefId;

  while (currentId) {
    const row = db.prepare('SELECT * FROM park_beliefs WHERE id = ?').get(currentId);
    if (!row) break;
    history.push(row);
    currentId = row.previous_belief_id;
  }

  return history.reverse();
}

/**
 * Get all evidence linked to a belief.
 */
export function getEvidenceForBelief(db, beliefId) {
  return db.prepare(`
    SELECT * FROM park_belief_evidence
    WHERE belief_id = ?
    ORDER BY added_at ASC
  `).all(beliefId);
}

/**
 * Calculate effective confidence and evidence weights for a belief.
 * Two witnesses repeating one planted account count as 1 source, not 2 independent confirmations.
 */
export function assessConfidence(db, beliefId) {
  const belief = db.prepare('SELECT * FROM park_beliefs WHERE id = ?').get(beliefId);
  if (!belief) {
    throw new Error(`Belief ${beliefId} not found.`);
  }

  const evidenceRows = db.prepare(`
    SELECT * FROM park_belief_evidence WHERE belief_id = ?
  `).all(beliefId);

  let supportingWeight = 0;
  let contradictingWeight = 0;
  let independentSources = 0;

  for (const e of evidenceRows) {
    const effectiveWeight = e.is_independent === 1
      ? 1.0
      : (1.0 / Math.max(1, e.source_count));

    if (e.is_independent === 1) {
      independentSources++;
    }

    if (e.relation === 'supports') {
      supportingWeight += effectiveWeight;
    } else if (e.relation === 'contradicts') {
      contradictingWeight += effectiveWeight;
    }
  }

  const totalWeight = supportingWeight + contradictingWeight;
  const netConfidence = totalWeight > 0
    ? Math.max(0, Math.min(1, supportingWeight / totalWeight))
    : belief.confidence;

  return {
    beliefId,
    baseConfidence: belief.confidence,
    supportingWeight: Number(supportingWeight.toFixed(3)),
    contradictingWeight: Number(contradictingWeight.toFixed(3)),
    independentSources,
    netConfidence: Number(netConfidence.toFixed(3)),
    evidenceCount: evidenceRows.length
  };
}
