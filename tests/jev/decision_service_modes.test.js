import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../src/db.js';
import { residentManager } from '../../src/residents.js';
import { WorldEngine } from '../../src/world.js';
import { JevDecisionService } from '../../src/jev/decision-service.js';

test('JEV Decision Service — Modes (Off, Shadow, Active) and Engine Integration', async (t) => {
  const world = new WorldEngine();
  residentManager.init(world);

  // Setup test service with mock client to run offline deterministically
  const jevService = new JevDecisionService({
    db,
    world,
    residentManager,
    options: {
      mock: true,
      batchWindowMs: 10,
      globalCooldownMs: 0
    }
  });

  const todayKey = jevService.budget.getPeriodKey();
  db.prepare('DELETE FROM jev_usage_daily WHERE period_key = ?').run(todayKey);
  db.prepare('UPDATE agent_runtime SET last_jev_decision_at = 0').run();
  for (const res of residentManager.getAllResidents()) {
    res.last_jev_decision_at = 0;
    res.pending_jev_action = null;
  }

  const shadowEvent = {
    id: `evt_shadow_${Date.now()}`,
    event_type: 'new_visitor',
    actor_id: 'visitor_pilgrim_beta',
    actor_name: 'Pilgrim Beta',
    target_id: null,
    zone_id: 'arrival',
    description: 'A new seeker has entered the sanctuary.'
  };

  await t.test('Off mode completely ignores events and does not call JEV', async () => {
    jevService.setMode('off');
    const res = jevService.handleEvent(shadowEvent);
    assert.equal(res.status, 'disabled');
  });

  await t.test('Shadow mode evaluates decisions, writes telemetry with probabilities, but DOES NOT execute', async () => {
    jevService.setMode('shadow');

    // Add event and flush immediately
    jevService.handleEvent(shadowEvent);
    const flushRes = await jevService.flush();

    assert.equal(flushRes.status, 'success');
    assert.equal(flushRes.mode, 'shadow');
    assert.ok(flushRes.decisionId);
    assert.ok(flushRes.actions.length > 0);

    // Verify database telemetry in jev_decisions
    const decisionRow = db.prepare('SELECT * FROM jev_decisions WHERE id = ?').get(flushRes.decisionId);
    assert.ok(decisionRow, 'Decision record must exist in SQLite');
    assert.equal(decisionRow.status, 'SUCCESS');

    // Verify database telemetry in jev_resident_actions
    const actionRows = db.prepare('SELECT * FROM jev_resident_actions WHERE jev_decision_id = ?').all(flushRes.decisionId);
    assert.ok(actionRows.length > 0);
    for (const row of actionRows) {
      assert.equal(row.execution_status, 'SHADOW_LOGGED');
      assert.ok(row.confidence > 0);
      assert.ok(JSON.parse(row.probabilities));
    }

    // Crucial check: in shadow mode, residents must NOT have pending_jev_action set!
    for (const res of residentManager.getAllResidents()) {
      assert.equal(res.pending_jev_action, null, 'Shadow mode must not set pending_jev_action on resident');
    }
  });

  await t.test('Active mode enqueues pending_jev_action and resident executes goal', async () => {
    jevService.setMode('active');
    db.prepare('UPDATE agent_runtime SET last_jev_decision_at = 0').run();
    for (const res of residentManager.getAllResidents()) {
      res.last_jev_decision_at = 0;
      res.pending_jev_action = null;
    }

    const activeEvent = {
      id: `evt_active_${Date.now()}`,
      event_type: 'visitor_arrival',
      actor_id: 'visitor_pilgrim_gamma',
      actor_name: 'Pilgrim Gamma',
      target_id: null,
      zone_id: 'arrival',
      description: 'Another pilgrim arrived at the gate.'
    };

    // Add event and flush immediately
    jevService.handleEvent(activeEvent);
    const flushRes = await jevService.flush();

    assert.equal(flushRes.status, 'success');
    assert.equal(flushRes.mode, 'active');

    // In active mode, valid residents should have pending_jev_action set
    const tian = residentManager.getResident('resident_tian');
    assert.ok(tian.pending_jev_action, 'Active mode must enqueue pending_jev_action on resident_tian');
    assert.equal(tian.pending_jev_action.action, 'WELCOME_VISITOR');

    // Verify execution status in jev_resident_actions table is ENQUEUED
    const actionRow = db.prepare('SELECT * FROM jev_resident_actions WHERE jev_decision_id = ? AND resident_id = ?')
      .get(flushRes.decisionId, 'resident_tian');
    assert.ok(actionRow);
    assert.equal(actionRow.execution_status, 'ENQUEUED');

    // Now simulate resident AI goal selection
    residentManager.selectNextGoal(tian);

    // After selectNextGoal, pending_jev_action should be cleared and last_jev_decision_at updated
    assert.equal(tian.pending_jev_action, null, 'Pending action should be consumed');
    assert.ok(tian.last_jev_decision_at > 0, 'last_jev_decision_at should be recorded');
    assert.ok(tian.current_goal.includes('Welcome visitor') || tian.current_goal.includes('Arrival Gate'));

    // Persist runtime and check DB record
    residentManager.persistRuntime(tian);
    const runtimeRow = db.prepare('SELECT * FROM agent_runtime WHERE agent_id = ?').get('resident_tian');
    assert.equal(runtimeRow.last_jev_decision_at, tian.last_jev_decision_at, 'agent_runtime must persist last_jev_decision_at');
  });
});
