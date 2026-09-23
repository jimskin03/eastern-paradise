import test from 'node:test';
import assert from 'node:assert/strict';
import { JevPolicyValidator } from '../../src/jev/policy.js';

test('JEV Policy Validator — Safety Checks & Cooldown Enforcement', async (t) => {
  const resident = {
    id: 'resident_tian',
    name: 'Elder Tian',
    is_alive: true,
    imprisoned: false
  };

  const runtime = {
    agent_id: 'resident_tian',
    is_alive: 1,
    last_jev_decision_at: 0
  };

  await t.test('Approves valid decision within bounded actions and outside cooldown', () => {
    const decision = {
      resident_id: 'resident_tian',
      action: 'WELCOME_VISITOR',
      target_id: 'NONE',
      priority: 0.8
    };

    const res = JevPolicyValidator.validateResidentDecision(decision, {
      resident,
      runtime,
      now: Date.now()
    });

    assert.equal(res.valid, true);
    assert.equal(res.status, 'VALID');
  });

  await t.test('Rejects arbitrary action outside bounded vocabulary', () => {
    const decision = {
      resident_id: 'resident_tian',
      action: 'CAST_FIREBALL',
      target_id: 'NONE',
      priority: 0.9
    };

    const res = JevPolicyValidator.validateResidentDecision(decision, {
      resident,
      runtime,
      now: Date.now()
    });

    assert.equal(res.valid, false);
    assert.equal(res.status, 'INVALID_ACTION');
  });

  await t.test('Enforces per-resident 4-hour cooldown unless CRITICAL', () => {
    const now = Date.now();
    const runtimeInCooldown = {
      ...runtime,
      last_jev_decision_at: now - (60 * 60 * 1000) // 1 hour ago
    };

    const decision = {
      resident_id: 'resident_tian',
      action: 'REST',
      target_id: 'NONE',
      priority: 0.5
    };

    // Standard routine event blocked by cooldown
    const standardRes = JevPolicyValidator.validateResidentDecision(decision, {
      resident,
      runtime: runtimeInCooldown,
      isCritical: false,
      now
    });
    assert.equal(standardRes.valid, false);
    assert.equal(standardRes.status, 'COOLDOWN_ACTIVE');

    // Critical event bypasses per-resident cooldown
    const criticalRes = JevPolicyValidator.validateResidentDecision(decision, {
      resident,
      runtime: runtimeInCooldown,
      isCritical: true,
      now
    });
    assert.equal(criticalRes.valid, true);
    assert.equal(criticalRes.status, 'VALID');
  });

  await t.test('Rejects unavailable resident (fallen or imprisoned)', () => {
    const deadResident = { ...resident, is_alive: false };
    const decision = {
      resident_id: 'resident_tian',
      action: 'REST',
      target_id: 'NONE'
    };

    const deadRes = JevPolicyValidator.validateResidentDecision(decision, {
      resident: deadResident,
      runtime,
      now: Date.now()
    });
    assert.equal(deadRes.valid, false);
    assert.equal(deadRes.status, 'RESIDENT_UNAVAILABLE');

    const imprisonedResident = { ...resident, imprisoned: true };
    const imprRes = JevPolicyValidator.validateResidentDecision(decision, {
      resident: imprisonedResident,
      runtime,
      now: Date.now()
    });
    assert.equal(imprRes.valid, false);
    assert.equal(imprRes.status, 'RESIDENT_UNAVAILABLE');
  });

  await t.test('Safely normalizes invalid target entity to NONE without crashing or invalidating action', () => {
    const mockWorld = {
      activeAgents: new Map(),
      objects: new Map(),
      map: { zones: {}, nodes: {} }
    };

    const decision = {
      resident_id: 'resident_tian',
      action: 'OBSERVE',
      target_id: 'ghost_entity_999'
    };

    const res = JevPolicyValidator.validateResidentDecision(decision, {
      resident,
      runtime,
      world: mockWorld,
      now: Date.now()
    });

    assert.equal(res.valid, true);
    assert.equal(res.targetAdjusted, true);
    assert.equal(res.target_id, 'NONE');
  });
});
