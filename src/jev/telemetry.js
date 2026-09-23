/**
 * Eastern Paradise — JEV Telemetry & Persistence Logger
 * Logs decisions, resident actions, probabilities, and skip reasons to SQLite.
 */

import crypto from 'node:crypto';
import { withImmediateTransaction } from '../infrastructure/database/transactions.js';

export class JevTelemetryLogger {
  constructor({ db }) {
    this.db = db;
  }

  /**
   * Record a completed or evaluated JEV decision batch.
   */
  recordDecision({
    id = `dec_${crypto.randomUUID()}`,
    eventId,
    periodKey,
    status = 'SUCCESS',
    requestHash = null,
    triggerType = 'event',
    requestStartedAt = Date.now(),
    requestCompletedAt = Date.now(),
    latencyMs = 0,
    model = null,
    provider = null,
    inputTokens = 0,
    outputTokens = 0,
    cost = 0,
    decisionCount = 0,
    metadata = {}
  }) {
    const metaStr = typeof metadata === 'string' ? metadata : JSON.stringify(metadata);

    this.db.prepare(`
      INSERT INTO jev_decisions (
        id, event_id, period_key, status, request_hash, trigger_type,
        request_started_at, request_completed_at, latency_ms,
        model, provider, input_tokens, output_tokens, cost,
        decision_count, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      eventId,
      periodKey,
      status,
      requestHash,
      triggerType,
      requestStartedAt,
      requestCompletedAt,
      latencyMs,
      model,
      provider,
      inputTokens,
      outputTokens,
      cost,
      decisionCount,
      metaStr
    );

    return id;
  }

  /**
   * Record a skipped JEV decision (budget limit, cooldown, etc.).
   */
  recordSkip({
    eventId = 'none',
    periodKey,
    triggerType = 'event',
    reason,
    metadata = {}
  }) {
    const now = Date.now();
    const id = `skip_${crypto.randomUUID()}`;
    const fullMeta = { reason, ...metadata };

    return this.recordDecision({
      id,
      eventId,
      periodKey,
      status: 'SKIPPED',
      triggerType,
      requestStartedAt: now,
      requestCompletedAt: now,
      latencyMs: 0,
      decisionCount: 0,
      metadata: fullMeta
    });
  }

  /**
   * Record validated resident actions associated with a decision.
   */
  recordResidentActions({
    decisionId,
    actions = [],
    defaultExecutionStatus = 'SHADOW_LOGGED'
  }) {
    const stmt = this.db.prepare(`
      INSERT INTO jev_resident_actions (
        id, jev_decision_id, resident_id, action, target_id,
        priority, confidence, probabilities, reason_code,
        validation_status, execution_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = Date.now();
    const records = [];

    withImmediateTransaction(this.db, () => {
      for (const act of actions) {
        const actionId = `act_${crypto.randomUUID()}`;
        const probs = typeof act.probabilities === 'string'
          ? act.probabilities
          : JSON.stringify(act.probabilities || {});

        const validationStatus = act.validation_status || (act.is_valid ? 'VALID' : 'INVALID');
        const executionStatus = act.execution_status || defaultExecutionStatus;

        stmt.run(
          actionId,
          decisionId,
          act.resident_id,
          act.action,
          act.target_id || null,
          act.priority ?? 0.5,
          act.confidence ?? 0.5,
          probs,
          act.reason_code || act.validation_reason || 'OK',
          validationStatus,
          executionStatus,
          now
        );

        records.push({ id: actionId, ...act });
      }
    });

    return records;
  }

  /**
   * Retrieve recent decisions for monitoring / debugging.
   */
  getRecentDecisions(limit = 20) {
    return this.db.prepare(`
      SELECT * FROM jev_decisions ORDER BY request_started_at DESC LIMIT ?
    `).all(limit);
  }

  /**
   * Retrieve recent resident actions for a given resident.
   */
  getResidentActions(residentId, limit = 20) {
    return this.db.prepare(`
      SELECT * FROM jev_resident_actions WHERE resident_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(residentId, limit);
  }
}
