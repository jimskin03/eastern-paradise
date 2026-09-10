import crypto from 'node:crypto';
import { withImmediateTransaction } from '../infrastructure/database/transactions.js';
import { EpistemicError } from './errors.js';

const RELATIONS = new Set(['supports', 'contradicts', 'uncertain']);
const VISIBILITIES = new Set(['public', 'private']);

const cleanText = (value, field, min, max) => {
  if (typeof value !== 'string') throw new EpistemicError('INVALID_INPUT', `${field} must be a string.`);
  const text = value.trim();
  if (text.length < min || text.length > max) {
    throw new EpistemicError('INVALID_INPUT', `${field} must be between ${min} and ${max} characters.`);
  }
  return text;
};

const cleanConfidence = value => {
  const confidence = Number(value);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new EpistemicError('INVALID_CONFIDENCE', 'confidence must be a number between 0 and 1.');
  }
  return confidence;
};

const cleanRelation = value => {
  const relation = value || 'uncertain';
  if (!RELATIONS.has(relation)) throw new EpistemicError('INVALID_RELATION', 'relation must be supports, contradicts, or uncertain.');
  return relation;
};

const requestScopedId = (prefix, agentId, requestId) => {
  if (!requestId) return `${prefix}_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
  const cleanRequestId = cleanText(requestId, 'request_id', 8, 128);
  const digest = crypto.createHash('sha256').update(`${agentId}|${cleanRequestId}`).digest('hex');
  return `${prefix}_${digest.slice(0, 32)}`;
};

const mapHypothesis = row => row ? ({ ...row, content_format: 'plain_text_untrusted' }) : null;

export class HypothesisService {
  constructor({ db, eventLedger = null }) {
    this.db = db;
    this.eventLedger = eventLedger;
  }

  create({ agent, statement, confidence, visibility = 'public', evidence = [], requestId = null }) {
    const cleanStatement = cleanText(statement, 'statement', 10, 1000);
    const cleanConfidenceValue = cleanConfidence(confidence);
    if (!VISIBILITIES.has(visibility)) throw new EpistemicError('INVALID_VISIBILITY', 'visibility must be public or private.');
    if (!Array.isArray(evidence) || evidence.length > 20) {
      throw new EpistemicError('INVALID_EVIDENCE', 'evidence must be an array containing at most 20 items.');
    }
    const id = requestScopedId('hyp', agent.id, requestId);
    const existing = this.db.prepare('SELECT * FROM agent_hypotheses WHERE id = ?').get(id);
    if (existing) return { hypothesis_id: id, hypothesis: this.getById(id, agent.id), idempotent: true };
    const linked = evidence.map(item => ({
      evidence_id: cleanText(typeof item === 'string' ? item : item?.evidence_id, 'evidence_id', 3, 128),
      relation: cleanRelation(typeof item === 'string' ? 'uncertain' : item?.relation)
    }));
    if (new Set(linked.map(item => item.evidence_id)).size !== linked.length) {
      throw new EpistemicError('DUPLICATE_EVIDENCE', 'Each evidence_id may be attached only once.');
    }
    for (const item of linked) this.assertEvidenceOwnership(agent.id, item.evidence_id);
    const now = Date.now();
    withImmediateTransaction(this.db, () => {
      this.db.prepare(`
        INSERT INTO agent_hypotheses (id, agent_id, statement, confidence, status, visibility, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'unverified', ?, ?, ?)
      `).run(id, agent.id, cleanStatement, cleanConfidenceValue, visibility, now, now);
      const insertEvidence = this.db.prepare(`
        INSERT INTO hypothesis_evidence (hypothesis_id, evidence_id, agent_id, relation, added_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const item of linked) insertEvidence.run(id, item.evidence_id, agent.id, item.relation, now);
      this.recalculateStatus(id);
    });
    const hypothesis = this.getById(id, agent.id);
    this.recordPublicEvent(hypothesis, agent, 'hypothesis_created', `${agent.name} proposed a new public hypothesis.`);
    return { hypothesis_id: hypothesis.id, hypothesis, idempotent: false };
  }

  listMine(agentId, options = {}) {
    return this.list({ ...options, ownerId: agentId });
  }

  listPublic(options = {}) {
    return this.list({ ...options, publicOnly: true });
  }

  list({ ownerId = null, publicOnly = false, limit = 25, offset = 0 } = {}) {
    const pageLimit = Math.max(1, Math.min(100, Number(limit) || 25));
    const pageOffset = Math.max(0, Number(offset) || 0);
    const where = publicOnly ? "visibility = 'public'" : 'agent_id = ?';
    const args = publicOnly ? [] : [ownerId];
    const rows = this.db.prepare(`
      SELECT * FROM agent_hypotheses
      WHERE ${where}
      ORDER BY updated_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...args, pageLimit + 1, pageOffset);
    const hasMore = rows.length > pageLimit;
    return {
      hypotheses: rows.slice(0, pageLimit).map(mapHypothesis),
      limit: pageLimit,
      offset: pageOffset,
      has_more: hasMore,
      next_offset: hasMore ? pageOffset + pageLimit : null
    };
  }

  getById(id, viewerId = null) {
    const row = this.db.prepare('SELECT * FROM agent_hypotheses WHERE id = ?').get(id);
    if (!row || (row.visibility !== 'public' && row.agent_id !== viewerId)) {
      throw new EpistemicError('HYPOTHESIS_NOT_FOUND', 'Hypothesis not found.', 404);
    }
    const evidence = this.db.prepare(`
      SELECT evidence_id, relation, added_at
      FROM hypothesis_evidence WHERE hypothesis_id = ?
      ORDER BY added_at ASC, evidence_id ASC
    `).all(id);
    const revisions = this.db.prepare(`
      SELECT id, hypothesis_id, previous_statement, new_statement, previous_confidence, new_confidence, reason, created_at
      FROM hypothesis_revisions WHERE hypothesis_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(id);
    return { ...mapHypothesis(row), evidence, revisions };
  }

  attachEvidence({ agent, hypothesisId, evidenceId, relation = 'uncertain' }) {
    const hypothesis = this.assertOwnership(agent.id, hypothesisId);
    if (hypothesis.status === 'withdrawn') throw new EpistemicError('HYPOTHESIS_WITHDRAWN', 'Withdrawn hypotheses cannot accept evidence.', 409);
    const cleanEvidenceId = cleanText(evidenceId, 'evidence_id', 3, 128);
    const cleanRelationValue = cleanRelation(relation);
    this.assertEvidenceOwnership(agent.id, cleanEvidenceId);
    const existing = this.db.prepare(`
      SELECT relation FROM hypothesis_evidence WHERE hypothesis_id = ? AND evidence_id = ?
    `).get(hypothesisId, cleanEvidenceId);
    if (existing) {
      if (existing.relation !== cleanRelationValue) {
        throw new EpistemicError('EVIDENCE_ALREADY_ATTACHED', 'This evidence is already attached with a different relation.', 409);
      }
      return { hypothesis: this.getById(hypothesisId, agent.id), idempotent: true };
    }
    const now = Date.now();
    withImmediateTransaction(this.db, () => {
      this.db.prepare(`
        INSERT INTO hypothesis_evidence (hypothesis_id, evidence_id, agent_id, relation, added_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(hypothesisId, cleanEvidenceId, agent.id, cleanRelationValue, now);
      this.recalculateStatus(hypothesisId);
      this.db.prepare('UPDATE agent_hypotheses SET updated_at = ? WHERE id = ?').run(now, hypothesisId);
    });
    const updated = this.getById(hypothesisId, agent.id);
    this.recordPublicEvent(updated, agent, cleanRelationValue === 'contradicts' ? 'hypothesis_contested' : 'hypothesis_supported', `${agent.name} added evidence to a public hypothesis.`);
    return { hypothesis: updated, idempotent: false };
  }

  revise({ agent, hypothesisId, statement, confidence, reason, evidenceId, relation = 'uncertain', requestId = null }) {
    const hypothesis = this.assertOwnership(agent.id, hypothesisId);
    if (hypothesis.status === 'withdrawn') throw new EpistemicError('HYPOTHESIS_WITHDRAWN', 'Withdrawn hypotheses cannot be revised.', 409);
    const cleanStatement = cleanText(statement, 'statement', 10, 1000);
    const cleanConfidenceValue = cleanConfidence(confidence);
    const cleanReason = cleanText(reason, 'reason', 5, 500);
    const cleanEvidenceId = cleanText(evidenceId, 'evidence_id', 3, 128);
    const cleanRelationValue = cleanRelation(relation);
    this.assertEvidenceOwnership(agent.id, cleanEvidenceId);
    const revisionId = requestScopedId(`rev_${hypothesisId}`, agent.id, requestId);
    const existingRevision = this.db.prepare('SELECT id FROM hypothesis_revisions WHERE id = ?').get(revisionId);
    if (existingRevision) return { hypothesis: this.getById(hypothesisId, agent.id), idempotent: true };
    if (this.db.prepare('SELECT 1 FROM hypothesis_evidence WHERE hypothesis_id = ? AND evidence_id = ?').get(hypothesisId, cleanEvidenceId)) {
      throw new EpistemicError('NEW_EVIDENCE_REQUIRED', 'A revision must cite evidence not already attached to this hypothesis.', 409);
    }
    const now = Date.now();
    withImmediateTransaction(this.db, () => {
      this.db.prepare(`
        INSERT INTO hypothesis_evidence (hypothesis_id, evidence_id, agent_id, relation, added_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(hypothesisId, cleanEvidenceId, agent.id, cleanRelationValue, now);
      this.db.prepare(`
        INSERT INTO hypothesis_revisions
          (id, hypothesis_id, agent_id, previous_statement, new_statement, previous_confidence, new_confidence, reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(revisionId, hypothesisId, agent.id, hypothesis.statement, cleanStatement, hypothesis.confidence, cleanConfidenceValue, cleanReason, now);
      this.db.prepare(`
        UPDATE agent_hypotheses SET statement = ?, confidence = ?, updated_at = ? WHERE id = ?
      `).run(cleanStatement, cleanConfidenceValue, now, hypothesisId);
      this.recalculateStatus(hypothesisId);
    });
    const updated = this.getById(hypothesisId, agent.id);
    this.recordPublicEvent(updated, agent, 'hypothesis_revised', `${agent.name} revised a public hypothesis after finding new evidence.`);
    return { hypothesis: updated, idempotent: false };
  }

  withdraw({ agent, hypothesisId }) {
    const hypothesis = this.assertOwnership(agent.id, hypothesisId);
    if (hypothesis.status === 'withdrawn') return { hypothesis: this.getById(hypothesisId, agent.id), idempotent: true };
    this.db.prepare("UPDATE agent_hypotheses SET status = 'withdrawn', updated_at = ? WHERE id = ?").run(Date.now(), hypothesisId);
    const updated = this.getById(hypothesisId, agent.id);
    this.recordPublicEvent(updated, agent, 'hypothesis_withdrawn', `${agent.name} withdrew a public hypothesis.`);
    return { hypothesis: updated, idempotent: false };
  }

  assertEvidenceOwnership(agentId, evidenceId) {
    const row = this.db.prepare(`
      SELECT 1 FROM agent_observations WHERE agent_id = ? AND evidence_id = ? LIMIT 1
    `).get(agentId, evidenceId);
    if (!row) throw new EpistemicError('EVIDENCE_NOT_OWNED', 'The agent must personally observe evidence before citing it.', 403);
  }

  assertOwnership(agentId, hypothesisId) {
    const row = this.db.prepare('SELECT * FROM agent_hypotheses WHERE id = ?').get(hypothesisId);
    if (!row) throw new EpistemicError('HYPOTHESIS_NOT_FOUND', 'Hypothesis not found.', 404);
    if (row.agent_id !== agentId) throw new EpistemicError('HYPOTHESIS_NOT_OWNED', 'Only the author may change this hypothesis.', 403);
    return row;
  }

  recalculateStatus(hypothesisId) {
    const counts = this.db.prepare(`
      SELECT
        SUM(CASE WHEN relation = 'supports' THEN 1 ELSE 0 END) AS supports,
        SUM(CASE WHEN relation = 'contradicts' THEN 1 ELSE 0 END) AS contradicts
      FROM hypothesis_evidence WHERE hypothesis_id = ?
    `).get(hypothesisId);
    const status = Number(counts?.contradicts) > 0 ? 'contested' : (Number(counts?.supports) > 0 ? 'supported' : 'unverified');
    this.db.prepare("UPDATE agent_hypotheses SET status = ? WHERE id = ? AND status != 'withdrawn'").run(status, hypothesisId);
  }

  recordPublicEvent(hypothesis, agent, eventType, description) {
    if (!this.eventLedger || hypothesis.visibility !== 'public') return;
    this.eventLedger.recordEvent({
      event_type: eventType,
      actor_id: agent.id,
      actor_name: agent.name,
      target_id: hypothesis.id,
      description,
      payload: { hypothesis_id: hypothesis.id, status: hypothesis.status }
    });
  }
}
