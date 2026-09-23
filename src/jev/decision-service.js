/**
 * Eastern Paradise — JEV Decision Service
 * Master orchestrator connecting event filter, accumulator, budget, context builder, client, policy validator, and telemetry.
 */

import {
  JEV_ENABLED,
  JEV_MODE,
  JEV_COMBAT_DECISIONS_ENABLED,
  ACTION_CRITERIA,
  PRIORITY_CRITERIA
} from './config.js';
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

    // Combat attacks are synchronously adjudicated by decideCombatResponse()
    // so the attack cannot resolve before the surviving resident responds.
    // Do not enqueue a second generic JEV request for the same combat event.
    if (event?.payload?.combat_resolution === 'pre_resolve' || event?.payload?.combat_resolution === 'post_resolve') {
      return { status: 'handled_by_combat', type: event.event_type };
    }

    const classification = JevEventFilter.classify(event);
    if (!classification.eligible) {
      return { status: 'ignored', tier: classification.tier, type: event?.event_type };
    }

    return this.accumulator.addEvent(event, classification, { immediate });
  }

  /**
   * Resolve the single surviving resident selected by the combat layer.
   * This is intentionally synchronous from gameplay's perspective (the
   * caller awaits the returned promise) and is never driven by simulation ticks.
   */
  async decideCombatResponse({ event, decisionMaker, survivors = [] } = {}) {
    const fallback = {
      action: 'IGNORE',
      resident_id: decisionMaker?.id || null,
      target_id: event?.actor_id || 'NONE',
      confidence: 0,
      reason: 'combat_jev_unavailable'
    };

    if (!this.enabled || !JEV_COMBAT_DECISIONS_ENABLED) {
      return { ...fallback, reason: 'combat_jev_disabled' };
    }
    if (!event || !decisionMaker) {
      return { ...fallback, reason: 'missing_combat_context' };
    }

    // A configured OpenRouter key uses real JEV. A missing key falls back to
    // IGNORE rather than silently treating the synthetic mock as a real verdict.
    if (!this.client.apiKey && !this.client.mock) {
      return { ...fallback, reason: 'no_jev_api_key' };
    }

    const now = Date.now();
    const periodKey = this.budget.getPeriodKey(now);
    const canSpend = this.budget.canSpendCall({ isCritical: true, periodKey });
    if (!canSpend.allowed) {
      this.telemetry.recordSkip({
        eventId: event.id || 'combat',
        periodKey,
        triggerType: 'resident_attacked',
        reason: canSpend.reason,
        metadata: { combat: true, decision_maker_id: decisionMaker.id }
      });
      return { ...fallback, reason: canSpend.reason };
    }

    const residentStates = {};
    for (const resident of survivors) {
      residentStates[resident.id] = {
        name: resident.name,
        role: resident.role,
        traits: resident.traits || [],
        energy: Math.round(resident.needs?.energy ?? 100),
        curiosity: Math.round(resident.needs?.curiosity ?? 80),
        social: Math.round(resident.needs?.social ?? 70),
        zone: resident.zone_name || resident.zone_id || 'sanctuary',
        action_state: resident.action_state || 'idle',
        current_goal: resident.current_goal || 'peaceful sanctuary life',
        public_intent: resident.public_intent || 'peaceful presence',
        is_alive: resident.is_alive !== false,
        imprisoned: Boolean(resident.imprisoned)
      };
    }

    const state = {
      event: {
        id: event.id || 'evt_combat',
        type: 'resident_attacked',
        severity: 'CRITICAL',
        category: 'combat',
        description: event.description || 'A sanctuary resident has been attacked.',
        actor: event.actor_name || event.actor_id || null,
        target: event.target_name || event.target_id || null,
        timestamp: event.created_at || now
      },
      combat: {
        attacker_id: event.actor_id || null,
        attacker_name: event.actor_name || event.actor_id || 'Unknown aggressor',
        attacked_resident_id: event.target_id || null,
        attacked_resident_name: event.target_name || event.target_id || 'Resident',
        decision_maker_id: decisionMaker.id,
        decision_maker_name: decisionMaker.name,
        surviving_residents: survivors.map(r => ({ id: r.id, name: r.name, role: r.role }))
      },
      sanctuary: {
        active_visitors_count: this.world?.activeAgents
          ? Array.from(this.world.activeAgents.values()).filter(a => !a.is_resident).length
          : 0
      },
      residents: residentStates
    };

    const targetCriteria = {
      [event.actor_id]: `${event.actor_name || event.actor_id} (aggressor)`,
      NONE: 'No target; do not engage the aggressor.'
    };
    const questions = {
      [`${decisionMaker.id}_action`]: {
        type: 'choice',
        instructions: `You are ${decisionMaker.name}, a surviving resident. An aggressor has attacked ${event.target_name || 'a fellow resident'}. Decide whether to DEFEND the attacked resident or IGNORE the attack. Respond with exactly one bounded action.`,
        criteria: {
          DEFEND: ACTION_CRITERIA.DEFEND,
          IGNORE: ACTION_CRITERIA.IGNORE
        }
      },
      [`${decisionMaker.id}_target`]: {
        type: 'choice',
        instructions: `Which entity is the relevant combat target for ${decisionMaker.name}?`,
        criteria: targetCriteria
      },
      [`${decisionMaker.id}_priority`]: {
        type: 'score',
        instructions: `Rate the urgency of ${decisionMaker.name}'s response to this attack.`,
        criteria: PRIORITY_CRITERIA
      }
    };

    const startTime = Date.now();
    let jevResponse;
    try {
      jevResponse = await this.client.requestDecisions({
        state,
        questions,
        residentIds: [decisionMaker.id]
      });
    } catch (err) {
      this.telemetry.recordDecision({
        eventId: event.id || 'combat',
        periodKey,
        status: 'ERROR',
        triggerType: 'resident_attacked',
        requestStartedAt: startTime,
        requestCompletedAt: Date.now(),
        latencyMs: Date.now() - startTime,
        decisionCount: 0,
        metadata: { combat: true, error: err.message }
      });
      return { ...fallback, reason: 'jev_request_error', error: err.message };
    }

    this.budget.recordCallSpend({
      eventId: event.id || 'combat',
      periodKey,
      timestamp: startTime
    });

    const normalized = this.client.normalizeDecisions(jevResponse.answers, [decisionMaker.id]);
    const decision = normalized[0];
    if (!decision) {
      this.telemetry.recordSkip({
        eventId: event.id || 'combat',
        periodKey,
        triggerType: 'resident_attacked',
        reason: 'JEV_NO_COMBAT_DECISION',
        metadata: { combat: true, decision_maker_id: decisionMaker.id }
      });
      return { ...fallback, reason: 'jev_no_decision' };
    }

    const validation = JevPolicyValidator.validateResidentDecision(
      { ...decision, action: String(decision.action || '').toUpperCase() },
      {
        resident: decisionMaker,
        runtime: this.getRuntimesMap([decisionMaker.id]).get(decisionMaker.id),
        world: this.world,
        isCritical: true,
        now,
        residentCooldownMs: 0
      }
    );
    const validatedAction = validation.valid ? String(decision.action || '').toUpperCase() : 'IGNORE';
    const validated = {
      ...decision,
      action: validatedAction,
      resident_id: decisionMaker.id,
      target_id: event.actor_id || 'NONE',
      validation_status: validation.status,
      validation_reason: validation.reason,
      is_valid: true
    };

    const decisionId = this.telemetry.recordDecision({
      eventId: event.id || 'combat',
      periodKey,
      status: 'SUCCESS',
      triggerType: 'resident_attacked',
      requestStartedAt: startTime,
      requestCompletedAt: Date.now(),
      latencyMs: jevResponse.latencyMs || (Date.now() - startTime),
      model: jevResponse.model,
      provider: jevResponse.provider,
      inputTokens: jevResponse.usage?.input_tokens || 0,
      outputTokens: jevResponse.usage?.output_tokens || 0,
      cost: jevResponse.usage?.cost || 0,
      decisionCount: 1,
      metadata: {
        combat: true,
        decision_maker_id: decisionMaker.id,
        attacked_resident_id: event.target_id,
        attacker_id: event.actor_id,
        isMock: jevResponse.isMock
      }
    });
    this.telemetry.recordResidentActions({
      decisionId,
      actions: [validated],
      defaultExecutionStatus: 'EXECUTED'
    });

    decisionMaker.last_jev_decision_at = now;
    if (this.residentManager?.persistRuntime) {
      this.residentManager.persistRuntime(decisionMaker);
    }

    return {
      action: validatedAction,
      resident_id: decisionMaker.id,
      resident_name: decisionMaker.name,
      target_id: event.actor_id || 'NONE',
      confidence: decision.confidence ?? 0,
      priority: decision.priority ?? 0,
      reason: 'jev_decision',
      decision_id: decisionId,
      is_mock: Boolean(jevResponse.isMock)
    };
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
