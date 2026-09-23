import test from 'node:test';
import assert from 'node:assert/strict';
import { JevEventFilter, TIER_A_EVENT_TYPES, TIER_B_EVENT_TYPES, TIER_C_EVENT_TYPES } from '../../src/jev/event-filter.js';

test('JEV Event Filter — Tier Classification and Severity', async (t) => {
  await t.test('Classifies Tier A events as eligible with correct severity and category', () => {
    const visitorEvt = { event_type: 'new_visitor', actor_id: 'visitor_1' };
    const visitorRes = JevEventFilter.classify(visitorEvt);
    assert.equal(visitorRes.eligible, true);
    assert.equal(visitorRes.tier, 'A');
    assert.equal(visitorRes.severity, 'MEDIUM');
    assert.equal(visitorRes.category, 'social');

    const projectEvt = { event_type: 'project_completed', payload: { object_id: 'chimes' } };
    const projectRes = JevEventFilter.classify(projectEvt);
    assert.equal(projectRes.eligible, true);
    assert.equal(projectRes.tier, 'A');
    assert.equal(projectRes.severity, 'HIGH');
    assert.equal(projectRes.category, 'project');

    const fallenEvt = { event_type: 'resident_fallen', actor_id: 'resident_daoming' };
    const fallenRes = JevEventFilter.classify(fallenEvt);
    assert.equal(fallenRes.eligible, true);
    assert.equal(fallenRes.tier, 'A');
    assert.equal(fallenRes.severity, 'CRITICAL');
    assert.equal(fallenRes.category, 'combat');
  });

  await t.test('Payload can explicitly elevate severity to CRITICAL', () => {
    const customEvt = {
      event_type: 'puzzle_solved',
      payload: { is_critical: true }
    };
    const res = JevEventFilter.classify(customEvt);
    assert.equal(res.eligible, true);
    assert.equal(res.severity, 'CRITICAL');
  });

  await t.test('Classifies Tier B high-frequency events as ineligible (local deterministic)', () => {
    for (const type of ['agent_stepped', 'path_completed', 'resident_dialogue', 'greeting']) {
      const res = JevEventFilter.classify({ event_type: type });
      assert.equal(res.eligible, false, `${type} should not be eligible for JEV`);
      assert.equal(res.tier, 'B');
    }
  });

  await t.test('Classifies Tier C simulation heartbeat/tick events as ineligible (immediate ignore)', () => {
    for (const type of ['simulation_tick', 'heartbeat', 'ping', 'session_heartbeat']) {
      const res = JevEventFilter.classify({ event_type: type });
      assert.equal(res.eligible, false, `${type} must never trigger JEV`);
      assert.equal(res.tier, 'C');
    }
  });

  await t.test('Handles missing, null, or unknown event structures safely', () => {
    const nullRes = JevEventFilter.classify(null);
    assert.equal(nullRes.eligible, false);

    const emptyRes = JevEventFilter.classify({});
    assert.equal(emptyRes.eligible, false);

    const unknownRes = JevEventFilter.classify({ event_type: 'some_future_ambient_sound' });
    assert.equal(unknownRes.eligible, false);
    assert.equal(unknownRes.tier, 'B');
  });
});
