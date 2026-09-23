/**
 * Eastern Paradise — JEV Daily Budget Accounting
 * Persists sanctuary-wide daily usage in SQLite (jev_usage_daily)
 */

import { JEV_DAILY_SOFT_LIMIT, JEV_DAILY_HARD_LIMIT } from './config.js';

export class JevBudgetManager {
  constructor({ db }) {
    this.db = db;
  }

  getPeriodKey(timestamp = Date.now()) {
    const d = new Date(timestamp);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  getUsage(periodKey = this.getPeriodKey()) {
    const row = this.db.prepare('SELECT * FROM jev_usage_daily WHERE period_key = ?').get(periodKey);
    if (!row) {
      return {
        period_key: periodKey,
        call_count: 0,
        soft_limit: JEV_DAILY_SOFT_LIMIT,
        hard_limit: JEV_DAILY_HARD_LIMIT,
        last_call_at: null,
        last_event_id: null,
        updated_at: Date.now()
      };
    }
    return row;
  }

  canSpendCall({ isCritical = false, periodKey = this.getPeriodKey() } = {}) {
    const usage = this.getUsage(periodKey);
    // Hard ceiling: strictly capped at hard_limit (5)
    if (usage.call_count >= usage.hard_limit) {
      return { allowed: false, reason: 'JEV_SKIPPED_DAILY_HARD_LIMIT', usage };
    }
    // Normal usage: 0 to soft_limit - 1
    if (usage.call_count < usage.soft_limit) {
      return { allowed: true, usage };
    }
    // Calls between soft_limit and hard_limit require elevated/critical significance
    if (isCritical) {
      return { allowed: true, usage, elevated: true };
    }
    return { allowed: false, reason: 'JEV_SKIPPED_DAILY_SOFT_LIMIT', usage };
  }

  recordCallSpend({ eventId = null, periodKey = this.getPeriodKey(), timestamp = Date.now() } = {}) {
    const usage = this.getUsage(periodKey);
    const newCount = usage.call_count + 1;
    this.db.prepare(`
      INSERT INTO jev_usage_daily (period_key, call_count, soft_limit, hard_limit, last_call_at, last_event_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(period_key) DO UPDATE SET
        call_count = excluded.call_count,
        last_call_at = excluded.last_call_at,
        last_event_id = excluded.last_event_id,
        updated_at = excluded.updated_at
    `).run(
      periodKey,
      newCount,
      usage.soft_limit || JEV_DAILY_SOFT_LIMIT,
      usage.hard_limit || JEV_DAILY_HARD_LIMIT,
      timestamp,
      eventId,
      timestamp
    );

    return {
      period_key: periodKey,
      call_count: newCount,
      last_call_at: timestamp,
      last_event_id: eventId
    };
  }

  getStatus() {
    const periodKey = this.getPeriodKey();
    const usage = this.getUsage(periodKey);
    return {
      period_key: periodKey,
      call_count: usage.call_count,
      soft_limit: usage.soft_limit,
      hard_limit: usage.hard_limit,
      remaining_soft: Math.max(0, usage.soft_limit - usage.call_count),
      remaining_hard: Math.max(0, usage.hard_limit - usage.call_count),
      is_exhausted: usage.call_count >= usage.hard_limit,
      last_call_at: usage.last_call_at,
      last_event_id: usage.last_event_id
    };
  }
}
