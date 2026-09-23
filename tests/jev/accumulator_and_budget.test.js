import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../src/db.js';
import { JevBudgetManager } from '../../src/jev/budget.js';
import { JevEventAccumulator } from '../../src/jev/accumulator.js';

test('JEV Budget Manager — Daily UTC Accounting & Ceilings', async (t) => {
  const budget = new JevBudgetManager({ db });
  const testPeriodKey = '2099-01-01';

  // Clear any existing test row
  db.prepare('DELETE FROM jev_usage_daily WHERE period_key = ?').run(testPeriodKey);

  await t.test('Initial usage is 0 calls with 8 soft limit and 12 hard ceiling', () => {
    const usage = budget.getUsage(testPeriodKey);
    assert.equal(usage.call_count, 0);
    assert.equal(usage.soft_limit, 8);
    assert.equal(usage.hard_limit, 12);

    const check = budget.canSpendCall({ isCritical: false, periodKey: testPeriodKey });
    assert.equal(check.allowed, true);
  });

  await t.test('Allows normal calls up to soft limit (8 calls)', () => {
    for (let i = 1; i <= 8; i++) {
      budget.recordCallSpend({ eventId: `evt_${i}`, periodKey: testPeriodKey });
    }

    const usage = budget.getUsage(testPeriodKey);
    assert.equal(usage.call_count, 8);

    // Call 9: routine event blocked by soft limit
    const routineCheck = budget.canSpendCall({ isCritical: false, periodKey: testPeriodKey });
    assert.equal(routineCheck.allowed, false);
    assert.equal(routineCheck.reason, 'JEV_SKIPPED_DAILY_SOFT_LIMIT');

    // Call 9: critical event allowed to spend beyond soft limit
    const criticalCheck = budget.canSpendCall({ isCritical: true, periodKey: testPeriodKey });
    assert.equal(criticalCheck.allowed, true);
    assert.equal(criticalCheck.elevated, true);
  });

  await t.test('Hard ceiling of 12 calls per calendar day strictly blocks ALL calls, even critical', () => {
    for (let i = 9; i <= 12; i++) {
      budget.recordCallSpend({ eventId: `evt_${i}`, periodKey: testPeriodKey });
    }

    const usage = budget.getUsage(testPeriodKey);
    assert.equal(usage.call_count, 12);

    const routineCheck = budget.canSpendCall({ isCritical: false, periodKey: testPeriodKey });
    assert.equal(routineCheck.allowed, false);
    assert.equal(routineCheck.reason, 'JEV_SKIPPED_DAILY_HARD_LIMIT');

    const criticalCheck = budget.canSpendCall({ isCritical: true, periodKey: testPeriodKey });
    assert.equal(criticalCheck.allowed, false);
    assert.equal(criticalCheck.reason, 'JEV_SKIPPED_DAILY_HARD_LIMIT');
  });

  // Cleanup test key
  db.prepare('DELETE FROM jev_usage_daily WHERE period_key = ?').run(testPeriodKey);
});

test('JEV Accumulator — Batching, Deduplication, and Global Cooldown', async (t) => {
  await t.test('Deduplicates identical events within coarse time bucket', () => {
    const accumulator = new JevEventAccumulator({ batchWindowMs: 50 });
    const event = { event_type: 'new_visitor', actor_id: 'visitor_1' };
    const classification = { eligible: true, tier: 'A', severity: 'MEDIUM' };

    const first = accumulator.addEvent(event, classification);
    assert.equal(first.status, 'accumulating');
    assert.equal(first.pendingCount, 1);

    const duplicate = accumulator.addEvent(event, classification);
    assert.equal(duplicate.status, 'duplicate');
    assert.equal(accumulator.pendingEvents.length, 1);

    accumulator.clear();
  });

  await t.test('Batches multiple distinct events and flushes to onFlush handler', async () => {
    let flushedPayload = null;
    const accumulator = new JevEventAccumulator({
      batchWindowMs: 20,
      globalCooldownMs: 0,
      onFlush: async (ctx) => {
        flushedPayload = ctx;
        return { ok: true };
      }
    });

    accumulator.addEvent(
      { event_type: 'new_visitor', actor_id: 'v1' },
      { eligible: true, tier: 'A', severity: 'MEDIUM', normalizedType: 'new_visitor' }
    );
    accumulator.addEvent(
      { event_type: 'project_completed', actor_id: 'v2', payload: { object_id: 'chimes' } },
      { eligible: true, tier: 'A', severity: 'HIGH', normalizedType: 'project_completed' }
    );

    await new Promise(r => setTimeout(r, 40));

    assert.ok(flushedPayload, 'onFlush should have been called');
    assert.equal(flushedPayload.eventsInBatch.length, 2);
    // Highest severity event should be selected as primaryEvent
    assert.equal(flushedPayload.primaryEvent.event_type, 'project_completed');
    assert.equal(flushedPayload.primaryClassification.severity, 'HIGH');

    accumulator.clear();
  });

  await t.test('Enforces 30-minute global cooldown gap unless bypassed by CRITICAL event', async () => {
    let callCount = 0;
    const globalCooldownMs = 30 * 60 * 1000;
    const accumulator = new JevEventAccumulator({
      batchWindowMs: 10,
      globalCooldownMs,
      onFlush: async () => {
        callCount++;
        return { ok: true };
      }
    });

    // First flush succeeds and sets lastCallAt
    await accumulator.addEvent(
      { event_type: 'new_visitor', actor_id: 'v1' },
      { eligible: true, tier: 'A', severity: 'MEDIUM', normalizedType: 'new_visitor' },
      { immediate: true }
    );
    assert.equal(callCount, 1);

    // Second flush with MEDIUM severity is blocked by global cooldown
    accumulator.addEvent(
      { event_type: 'puzzle_solved', actor_id: 'v2' },
      { eligible: true, tier: 'A', severity: 'MEDIUM', normalizedType: 'puzzle_solved' }
    );
    const flushRes = await accumulator.flush();
    assert.equal(flushRes.status, 'skipped');
    assert.equal(flushRes.reason, 'JEV_SKIPPED_GLOBAL_COOLDOWN');
    assert.equal(callCount, 1, 'Should not increment callCount');

    // Third flush with CRITICAL severity bypasses the global cooldown
    await accumulator.addEvent(
      { event_type: 'resident_fallen', actor_id: 'resident_daoming' },
      { eligible: true, tier: 'A', severity: 'CRITICAL', normalizedType: 'resident_fallen' },
      { immediate: true }
    );
    assert.equal(callCount, 2, 'Critical event must bypass global cooldown gap');

    accumulator.clear();
  });
});
