import crypto from 'node:crypto';
import { db } from './db.js';

class WorldEventLedger {
  constructor() {
    this._initialized = false;
    this._currentSeq = 0;
    this._broadcastFn = null;
  }

  init(broadcastFn = null) {
    if (this._initialized) return;
    this._broadcastFn = broadcastFn;
    const row = db.prepare('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM world_events').get();
    this._currentSeq = row ? row.max_seq : 0;
    this._initialized = true;
  }

  setBroadcastHandler(fn) {
    this._broadcastFn = fn;
  }

  /**
   * Record a sequenced world event.
   * @param {object} data
   * @param {string} data.event_type
   * @param {string} [data.actor_id]
   * @param {string} [data.actor_name]
   * @param {string} [data.target_id]
   * @param {string} [data.target_name]
   * @param {string} [data.zone_id]
   * @param {string} data.description
   * @param {object} [data.payload={}]
   * @returns {object} The recorded event record
   */
  recordEvent(data) {
    if (!this._initialized) {
      this.init();
    }

    this._currentSeq += 1;
    const eventId = `evt_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const createdAt = Date.now();
    const payloadStr = typeof data.payload === 'object' ? JSON.stringify(data.payload) : String(data.payload || '{}');

    const stmt = db.prepare(`
      INSERT INTO world_events (id, seq, event_type, actor_id, actor_name, target_id, target_name, zone_id, description, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      eventId,
      this._currentSeq,
      data.event_type,
      data.actor_id || null,
      data.actor_name || null,
      data.target_id || null,
      data.target_name || null,
      data.zone_id || null,
      data.description,
      payloadStr,
      createdAt
    );

    const record = {
      id: eventId,
      seq: this._currentSeq,
      event_type: data.event_type,
      actor_id: data.actor_id || null,
      actor_name: data.actor_name || null,
      target_id: data.target_id || null,
      target_name: data.target_name || null,
      zone_id: data.zone_id || null,
      description: data.description,
      payload: data.payload || {},
      created_at: createdAt
    };

    if (this._broadcastFn) {
      try {
        this._broadcastFn({ type: 'world_event', event: record });
      } catch (err) {
        console.error('[WorldEventLedger] Broadcast error:', err);
      }
    }

    return record;
  }

  getRecentEvents(limit = 25) {
    const rows = db.prepare(`
      SELECT * FROM world_events
      ORDER BY seq DESC
      LIMIT ?
    `).all(limit);

    return rows.map(r => ({
      ...r,
      payload: JSON.parse(r.payload || '{}')
    }));
  }

  getEventsSince(sinceSeq = 0, limit = 50) {
    const rows = db.prepare(`
      SELECT * FROM world_events
      WHERE seq > ?
      ORDER BY seq ASC
      LIMIT ?
    `).all(sinceSeq, limit);

    return rows.map(r => ({
      ...r,
      payload: JSON.parse(r.payload || '{}')
    }));
  }

  getRecapSince(timestamp = 0, limit = 10) {
    const rows = db.prepare(`
      SELECT * FROM world_events
      WHERE created_at > ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(timestamp, limit);

    return rows.map(r => ({
      ...r,
      payload: JSON.parse(r.payload || '{}')
    }));
  }

  getEventsPage({ limit = 30, beforeSeq = null, sinceSeq = null } = {}) {
    const lim = Math.max(1, Math.min(100, Number(limit) || 30));
    let sql = 'SELECT * FROM world_events';
    const params = [];

    if (beforeSeq !== null && beforeSeq !== undefined && !isNaN(Number(beforeSeq))) {
      sql += ' WHERE seq < ? ORDER BY seq DESC LIMIT ?';
      params.push(Number(beforeSeq), lim + 1);
    } else if (sinceSeq !== null && sinceSeq !== undefined && !isNaN(Number(sinceSeq))) {
      sql += ' WHERE seq > ? ORDER BY seq ASC LIMIT ?';
      params.push(Number(sinceSeq), lim + 1);
    } else {
      sql += ' ORDER BY seq DESC LIMIT ?';
      params.push(lim + 1);
    }

    const rows = db.prepare(sql).all(...params);
    const hasMore = rows.length > lim;
    const events = hasMore ? rows.slice(0, lim) : rows;
    const mapped = events.map(r => ({
      ...r,
      payload: JSON.parse(r.payload || '{}')
    }));

    const nextCursor = (hasMore && mapped.length > 0) ? mapped[mapped.length - 1].seq : null;

    return {
      limit: lim,
      count: mapped.length,
      has_more: hasMore,
      next_cursor: nextCursor,
      events: mapped
    };
  }
}

export const eventLedger = new WorldEventLedger();
