/**
 * Eastern Paradise — JEV Policy Validator
 * Validates candidate resident decisions against safety constraints, bounded vocabulary, and cooldowns.
 */

import {
  BOUNDED_ACTIONS,
  JEV_RESIDENT_COOLDOWN_MS
} from './config.js';

export class JevPolicyValidator {
  /**
   * Validate a single resident decision.
   */
  static validateResidentDecision(decision, {
    resident,
    runtime,
    world = null,
    isCritical = false,
    now = Date.now(),
    residentCooldownMs = JEV_RESIDENT_COOLDOWN_MS
  } = {}) {
    if (!decision || !decision.resident_id) {
      return {
        valid: false,
        status: 'INVALID_PAYLOAD',
        reason: 'Missing decision or resident_id'
      };
    }

    // 1. Resident availability check
    if (!resident) {
      return {
        valid: false,
        status: 'RESIDENT_UNAVAILABLE',
        reason: 'Resident entity not found in active world'
      };
    }

    if (resident.is_alive === false || (runtime && runtime.is_alive === 0)) {
      return {
        valid: false,
        status: 'RESIDENT_UNAVAILABLE',
        reason: 'Resident is currently dead or awaiting respawn'
      };
    }

    if (resident.imprisoned) {
      return {
        valid: false,
        status: 'RESIDENT_UNAVAILABLE',
        reason: 'Resident is currently imprisoned'
      };
    }

    // 2. Action vocabulary check
    if (!BOUNDED_ACTIONS.includes(decision.action)) {
      return {
        valid: false,
        status: 'INVALID_ACTION',
        reason: `Action '${decision.action}' is not in bounded vocabulary`
      };
    }

    // 3. Per-resident cooldown check (4 hours by default; bypassable on CRITICAL events)
    const lastDecisionAt = runtime?.last_jev_decision_at || resident.last_jev_decision_at || 0;
    const elapsed = now - lastDecisionAt;
    if (elapsed < residentCooldownMs && !isCritical) {
      return {
        valid: false,
        status: 'COOLDOWN_ACTIVE',
        reason: `Resident in cooldown for another ${Math.ceil((residentCooldownMs - elapsed) / 60000)}m`,
        remainingMs: residentCooldownMs - elapsed
      };
    }

    // 4. Target validity check
    const targetId = decision.target_id;
    if (targetId && targetId !== 'NONE' && world) {
      const targetAgent = world.activeAgents?.get?.(targetId) || world.agents?.get?.(targetId);
      const targetObject = world.objects?.get?.(targetId);
      const isKnownZoneOrNode = world.map?.zones?.[targetId] || world.map?.nodes?.[targetId];

      if (!targetAgent && !targetObject && !isKnownZoneOrNode) {
        // Soft fallback: target is not active in the world, convert target to NONE rather than discarding action
        return {
          valid: true,
          status: 'VALID',
          targetAdjusted: true,
          originalTarget: targetId,
          target_id: 'NONE',
          reason: `Target entity '${targetId}' not present in world; normalized to NONE`
        };
      }
    }

    return {
      valid: true,
      status: 'VALID',
      reason: 'Passed policy validation'
    };
  }

  /**
   * Validate a collection of resident decisions.
   */
  static validateDecisions(decisions, {
    residentsMap = new Map(),
    runtimesMap = new Map(),
    world = null,
    isCritical = false,
    now = Date.now(),
    residentCooldownMs = JEV_RESIDENT_COOLDOWN_MS
  } = {}) {
    const validated = [];

    for (const dec of decisions) {
      const resId = dec.resident_id;
      const resident = residentsMap.get(resId);
      const runtime = runtimesMap.get(resId);

      const check = this.validateResidentDecision(dec, {
        resident,
        runtime,
        world,
        isCritical,
        now,
        residentCooldownMs
      });

      validated.push({
        ...dec,
        target_id: check.targetAdjusted ? check.target_id : dec.target_id,
        validation_status: check.status,
        validation_reason: check.reason,
        is_valid: check.valid
      });
    }

    return validated;
  }
}
