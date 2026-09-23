/**
 * Eastern Paradise — JEV Event Accumulator & Debouncer
 * Batches significant events in a 30-second window, suppresses duplicates, and enforces global gap.
 */

import { JEV_EVENT_BATCH_WINDOW_MS, JEV_GLOBAL_COOLDOWN_MS } from './config.js';

export class JevEventAccumulator {
  constructor({
    batchWindowMs = JEV_EVENT_BATCH_WINDOW_MS,
    globalCooldownMs = JEV_GLOBAL_COOLDOWN_MS,
    onFlush = null
  } = {}) {
    this.batchWindowMs = batchWindowMs;
    this.globalCooldownMs = globalCooldownMs;
    this.onFlush = onFlush;

    this.pendingEvents = [];
    this.seenFingerprints = new Set();
    this.timer = null;
    this.lastCallAt = 0;
    this.inFlight = false;
  }

  generateFingerprint(event) {
    const type = event.event_type || 'unknown';
    const actor = event.actor_id || '';
    const target = event.target_id || '';
    const object = event.payload?.node_id || event.payload?.object_id || event.zone_id || '';
    // 60-second coarse time bucket to catch rapid repeated triggers
    const timeBucket = Math.floor(Date.now() / 60000);
    return `${type}:${actor}:${target}:${object}:${timeBucket}`;
  }

  canTriggerNow({ isCritical = false, now = Date.now() } = {}) {
    if (this.inFlight) {
      return { allowed: false, reason: 'JEV_SKIPPED_IN_FLIGHT' };
    }
    const elapsed = now - this.lastCallAt;
    if (elapsed < this.globalCooldownMs && !isCritical) {
      return {
        allowed: false,
        reason: 'JEV_SKIPPED_GLOBAL_COOLDOWN',
        remainingMs: this.globalCooldownMs - elapsed
      };
    }
    return { allowed: true };
  }

  addEvent(event, classification, { immediate = false } = {}) {
    const now = Date.now();
    const fp = this.generateFingerprint(event);

    if (this.seenFingerprints.has(fp)) {
      return { status: 'duplicate', fingerprint: fp };
    }

    this.seenFingerprints.add(fp);
    // Cleanup old fingerprints periodically
    if (this.seenFingerprints.size > 200) {
      this.seenFingerprints.clear();
      this.seenFingerprints.add(fp);
    }

    const item = {
      event,
      classification,
      received_at: now
    };
    this.pendingEvents.push(item);

    if (immediate || classification.severity === 'CRITICAL') {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      return this.flush();
    }

    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush();
      }, this.batchWindowMs);
      if (this.timer.unref) this.timer.unref();
    }

    return { status: 'accumulating', pendingCount: this.pendingEvents.length, fingerprint: fp };
  }

  async flush() {
    if (this.pendingEvents.length === 0) return null;
    if (this.inFlight) {
      return { status: 'deferred', reason: 'in_flight' };
    }

    const batch = [...this.pendingEvents];
    this.pendingEvents = [];

    // Synthesize primary event context from batch
    const hasCritical = batch.some(b => b.classification?.severity === 'CRITICAL');
    const primary = batch.sort((a, b) => {
      const weight = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
      return (weight[b.classification?.severity] || 0) - (weight[a.classification?.severity] || 0);
    })[0];

    const gapCheck = this.canTriggerNow({ isCritical: hasCritical });
    if (!gapCheck.allowed) {
      return {
        status: 'skipped',
        reason: gapCheck.reason,
        batch
      };
    }

    if (this.onFlush) {
      this.inFlight = true;
      try {
        const result = await this.onFlush({
          primaryEvent: primary.event,
          primaryClassification: primary.classification,
          eventsInBatch: batch
        });
        this.lastCallAt = Date.now();
        return result;
      } finally {
        this.inFlight = false;
      }
    }

    return { status: 'batched', batch };
  }

  clear() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pendingEvents = [];
    this.inFlight = false;
  }
}
