import { EpistemicError } from './errors.js';
import { perceivePilotEvidence } from './perception.js';

const clampLimit = value => Math.max(1, Math.min(100, Number(value) || 25));
const clampOffset = value => Math.max(0, Number(value) || 0);

export function serializeObservation(row) {
  if (!row) return null;
  const { canonical_ref: _canonicalRef, ...publicRow } = row;
  return {
    ...publicRow,
    observation_id: row.id,
    observed_at: row.created_at,
    content_format: 'plain_text_untrusted'
  };
}

export class EvidenceService {
  constructor({ db, eventLedger = null, epochProvider = null }) {
    this.db = db;
    this.eventLedger = eventLedger;
    this.epochProvider = epochProvider || (() => Math.floor(Date.now() / 86_400_000));
  }

  observe({ agent, nodeId, perceptionMode = 'normal' }) {
    if (perceptionMode !== 'normal') {
      throw new EpistemicError('UNSUPPORTED_PERCEPTION_MODE', 'Only normal perception is available in this milestone.', 400);
    }
    const worldEpoch = Number(this.epochProvider());
    const perceived = perceivePilotEvidence({
      agentId: agent.id,
      nodeId,
      worldEpoch,
      perceptionMode
    });
    if (!perceived) {
      throw new EpistemicError('NOT_PERCEPTIBLE', 'This location has no epistemic observation in the current pilot.', 404);
    }

    const id = `obs_${perceived.perception_hash.slice(0, 32)}`;
    const createdAt = Date.now();
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO agent_observations
        (id, evidence_id, agent_id, source_type, source_id, zone_id, perception_mode, observation, reliability, canonical_ref, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      perceived.evidence_id,
      agent.id,
      perceived.source_type,
      perceived.source_id,
      perceived.zone_id,
      perceived.perception_mode,
      perceived.observation,
      perceived.reliability,
      perceived.canonical_ref,
      createdAt
    );
    const row = this.db.prepare('SELECT * FROM agent_observations WHERE id = ?').get(id);

    if (insert.changes > 0 && this.eventLedger) {
      this.eventLedger.recordEvent({
        event_type: 'observation_recorded',
        actor_id: agent.id,
        actor_name: agent.name,
        target_id: nodeId,
        zone_id: perceived.zone_id,
        description: `${agent.name} paused to study an uncertain detail.`,
        payload: { source_id: nodeId, perception_mode: perceptionMode }
      });
    }

    return { observation_id: row.id, evidence_id: row.evidence_id, observation: serializeObservation(row), idempotent: insert.changes === 0 };
  }

  listMine(agentId, { limit, offset } = {}) {
    const pageLimit = clampLimit(limit);
    const pageOffset = clampOffset(offset);
    const rows = this.db.prepare(`
      SELECT * FROM agent_observations
      WHERE agent_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(agentId, pageLimit + 1, pageOffset);
    const hasMore = rows.length > pageLimit;
    return {
      observations: rows.slice(0, pageLimit).map(serializeObservation),
      limit: pageLimit,
      offset: pageOffset,
      has_more: hasMore,
      next_offset: hasMore ? pageOffset + pageLimit : null
    };
  }

  getMine(agentId, evidenceId) {
    const row = this.db.prepare(`
      SELECT * FROM agent_observations
      WHERE agent_id = ? AND evidence_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(agentId, evidenceId);
    if (!row) throw new EpistemicError('EVIDENCE_NOT_FOUND', 'No observation of that evidence belongs to this agent.', 404);
    return serializeObservation(row);
  }
}
