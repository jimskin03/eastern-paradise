/**
 * Eastern Paradise — JEV Decision Service
 * Master orchestrator connecting event filter, accumulator, budget, context builder, client, policy validator, and telemetry.
 */

import { JEV_ENABLED, JEV_MODE } from './config.js';
import { RESIDENTS_DEF } from '../residents.js';
import { JevBudgetManager } from './budget.js';
import { JevEventFilter } from './event-filter.js';
import { JevEventAccumulator } from './accumulator.js';
import { JevContextBuilder } from './context.js';
import { JevClient } from './client.js';
import { JevPolicyValidator } from './policy.js';
import { JevTelemetryLogger } from './telemetry.js';

export class JevDecisionService {
  constructor({
    db,
    world = null,
    residentManager = null,
    options = {}
  } = {}) {
    this.db = db;
    this.world = world;
    this.residentManager = residentManager;

    this.enabled = options.enabled ?? JEV_ENABLED;
    this.mode = options.mode || JEV_MODE; // 'off' | 'shadow' | 'active'

    this.budget = options.budget || new JevBudgetManager({ db });
    this.telemetry = options.telemetry || new JevTelemetryLogger({ db });
    this.client = options.client || new JevClient({ mock: options.mock });

    this.accumulator = options.accumulator || new JevEventAccumulator({
      batchWindowMs: options.batchWindowMs,
      globalCooldownMs: options.globalCooldownMs,
      onFlush: (batchContext) => this.processEventBatch(batchContext)
    });
  }

  setMode(newMode) {
    if (['off', 'shadow', 'active'].includes(newMode)) {
      this.mode = newMode;
    }
  }

  getStatus() {
    return {
      enabled: this.enabled,
      mode: this.mode,
      budget: this.budget.getStatus(),
      pendingEventsCount: this.accumulator.pendingEvents.length,
      inFlight: this.accumulator.inFlight
    };
  }

  /**
   * Primary entry point called by WorldEventLedger subscriber on each recorded event.
   */
  handleEvent(event, { immediate = false } = {}) {
    if (!this.enabled || this.mode === 'off') {
      return { status: 'disabled', mode: this.mode };
    }

    const classification = JevEventFilter.classify(event);
    if (!classification.eligible) {
      return { status: 'ignored', tier: classification.tier, type: event?.event_type };
    }

    return this.accumulator.addEvent(event, classification, { immediate });
  }

  /**
   * Helper to fetch active/eligible residents from residentManager or database.
   */
  getEligibleResidents() {
    if (this.residentManager) {
      const all = this.residentManager.getAllResidents?.() || [];
      return all.filter(r => r.is_alive !== false && !r.imprisoned);
    }

    // Fallback: load directly from DB
    const residents = [];
    for (const def of (RESIDENTS_DEF || [])) {
      const row = this.db.prepare('SELECT * FROM agent_runtime WHERE agent_id = ?').get(def.id);
      if (row && row.is_alive !== 0) {
        residents.push({
          id: def.id,
          name: def.name,
          role: def.role,
          traits: def.traits || [],
          needs: { energy: row.energy, curiosity: row.curiosity, social: row.social },
          zone_name: def.preferred_locations?.[0] || 'sanctuary',
          action_state: row.action_state || 'idle',
          current_goal: row.current_goal,
          public_intent: row.public_intent,
          is_alive: true,
          imprisoned: false,
          last_jev_decision_at: row.last_jev_decision_at || 0
        });
      }
    }
    return residents;
  }

  /**
   * Helper to load runtime rows for a set of resident IDs.
   */
  getRuntimesMap(residentIds = []) {
    const map = new Map();
    if (residentIds.length === 0) return map;

    const placeholders = residentIds.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT * FROM agent_runtime WHERE agent_id IN (${placeholders})`).all(...residentIds);
    for (const row of rows) {
      map.set(row.agent_id, row);
    }
    return map;
  }

  /**
   * Flushes the accumulator immediately (useful for testing or critical overrides).
   */
  async flush() {
    return this.accumulator.flush();
  }

  /**
   * Core processing function executed when accumulator window flushes.
   */
  async processEventBatch({ primaryEvent, primaryClassification, eventsInBatch = [] }) {
    if (!this.enabled || this.mode === 'off') {
      return { status: 'disabled', mode: this.mode };
    }

    const isCritical = primaryClassification?.severity === 'CRITICAL';
    const periodKey = this.budget.getPeriodKey();

    // 1. Budget check (Sanctuary hard limit: 5 calls/day, soft limit: 3 calls/day)
    const canSpend = this.budget.canSpendCall({ isCritical, periodKey });
    if (!canSpend.allowed) {
      this.telemetry.recordSkip({
        eventId: primaryEvent.id || 'batch',
        periodKey,
        triggerType: primaryClassification?.normalizedType || primaryEvent.event_type,
        reason: canSpend.reason,
        metadata: {
          batchCount: eventsInBatch.length,
          severity: primaryClassification?.severity
        }
      });
      return { status: 'skipped', reason: canSpend.reason, usage: canSpend.usage };
    }

    // 2. Gather eligible resident entities
    const residents = this.getEligibleResidents();
    if (residents.length === 0) {
      return { status: 'no_eligible_residents' };
    }

    const residentIds = residents.map(r => r.id);

    // 3. Build native OpenRouter JEV request payload
    const payload = JevContextBuilder.buildRequestPayload({
      primaryEvent,
      primaryClassification,
      eventsInBatch,
      residents,
      world: this.world
    });

    const startTime = Date.now();

    // 4. Send request to OpenRouter JEV Decisions API
    let jevResponse;
    try {
      jevResponse = await this.client.requestDecisions({
        state: payload.state,
        questions: payload.questions,
        residentIds
      });
    } catch (err) {
      this.telemetry.recordDecision({
        eventId: primaryEvent.id || 'batch',
        periodKey,
        status: 'ERROR',
        triggerType: primaryClassification?.normalizedType || primaryEvent.event_type,
        requestStartedAt: startTime,
        requestCompletedAt: Date.now(),
        latencyMs: Date.now() - startTime,
        decisionCount: 0,
        metadata: { error: err.message }
      });
      return { status: 'error', error: err.message };
    }

    // 5. Deduct/record call spend in SQLite budget
    this.budget.recordCallSpend({
      eventId: primaryEvent.id || 'batch',
      periodKey,
      timestamp: startTime
    });

    // 6. Normalize native JEV answers
    const normalized = this.client.normalizeDecisions(jevResponse.answers, residentIds);

    // 7. Policy validation
    const runtimesMap = this.getRuntimesMap(residentIds);
    const residentsMap = new Map(residents.map(r => [r.id, r]));
    const validated = JevPolicyValidator.validateDecisions(normalized, {
      residentsMap,
      runtimesMap,
      world: this.world,
      isCritical,
      now: startTime
    });

    // 8. Record decision batch to telemetry
    const decisionId = this.telemetry.recordDecision({
      eventId: primaryEvent.id || 'batch',
      periodKey,
      status: 'SUCCESS',
      triggerType: primaryClassification?.normalizedType || primaryEvent.event_type,
      requestStartedAt: startTime,
      requestCompletedAt: Date.now(),
      latencyMs: jevResponse.latencyMs || (Date.now() - startTime),
      model: jevResponse.model,
      provider: jevResponse.provider,
      inputTokens: jevResponse.usage?.input_tokens || 0,
      outputTokens: jevResponse.usage?.output_tokens || 0,
      cost: jevResponse.usage?.cost || 0,
      decisionCount: validated.length,
      metadata: {
        primaryEventId: primaryEvent.id,
        severity: primaryClassification?.severity,
        mode: this.mode,
        isMock: jevResponse.isMock
      }
    });

    // 9. Record resident actions to telemetry
    const defaultExecutionStatus = (this.mode === 'active') ? 'ENQUEUED' : 'SHADOW_LOGGED';
    this.telemetry.recordResidentActions({
      decisionId,
      actions: validated,
      defaultExecutionStatus
    });

    // 10. In active mode: enqueue pending_jev_action onto live resident entities
    if (this.mode === 'active') {
      for (const act of validated) {
        if (act.is_valid) {
          const res = residentsMap.get(act.resident_id);
          if (res) {
            res.pending_jev_action = {
              decision_id: decisionId,
              action: act.action,
              target_id: act.target_id,
              priority: act.priority,
              confidence: act.confidence,
              received_at: Date.now()
            };
          }
        }
      }
    }

    return {
      status: 'success',
      decisionId,
      mode: this.mode,
      actions: validated,
      isMock: jevResponse.isMock
    };
  }
}
