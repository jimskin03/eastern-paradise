import crypto from 'node:crypto';
import { db } from './db.js';
import { eventLedger } from './events.js';

export class SocialSystem {
  /**
   * Get directed relationship from agentId to targetId.
   */
  static getRelationship(agentId, targetId) {
    const row = db.prepare(`
      SELECT * FROM relationships
      WHERE agent_id = ? AND target_id = ?
    `).get(agentId, targetId);

    if (row) {
      return row;
    }

    return {
      agent_id: agentId,
      target_id: targetId,
      familiarity: 10.0,
      trust: 10.0,
      last_interaction_at: Date.now()
    };
  }

  /**
   * Adjust familiarity and trust with clamping [0, 100].
   */
  static modifyRelationship(agentId, targetId, deltaFamiliarity, deltaTrust) {
    const current = this.getRelationship(agentId, targetId);
    const newFamiliarity = Math.max(0, Math.min(100, current.familiarity + deltaFamiliarity));
    const newTrust = Math.max(0, Math.min(100, current.trust + deltaTrust));
    const now = Date.now();

    db.prepare(`
      INSERT INTO relationships (agent_id, target_id, familiarity, trust, last_interaction_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(agent_id, target_id) DO UPDATE SET
        familiarity = excluded.familiarity,
        trust = excluded.trust,
        last_interaction_at = excluded.last_interaction_at
    `).run(agentId, targetId, newFamiliarity, newTrust, now);

    return {
      agent_id: agentId,
      target_id: targetId,
      familiarity: newFamiliarity,
      trust: newTrust,
      last_interaction_at: now
    };
  }

  static getRelationshipsForAgent(agentId) {
    return db.prepare(`
      SELECT r.*, a.name AS target_name, a.avatar_glyph, a.avatar_color
      FROM relationships r
      JOIN accounts a ON a.id = r.target_id
      WHERE r.agent_id = ?
      ORDER BY r.familiarity DESC
    `).all(agentId);
  }

  /**
   * Record an episodic memory for an agent.
   */
  static recordMemory(agentId, eventId, subject, summary, emotionalValence = 0.0, significance = 1) {
    const id = `mem_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const now = Date.now();

    db.prepare(`
      INSERT INTO agent_memories (id, agent_id, event_id, subject, emotional_valence, significance, summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, agentId, eventId, subject, emotionalValence, significance, summary, now);

    return {
      id,
      agent_id: agentId,
      event_id: eventId,
      subject,
      emotional_valence: emotionalValence,
      significance,
      summary,
      created_at: now
    };
  }

  static getMemoriesForAgent(agentId, limit = 10) {
    return db.prepare(`
      SELECT * FROM agent_memories
      WHERE agent_id = ?
      ORDER BY significance DESC, created_at DESC
      LIMIT ?
    `).all(agentId, limit);
  }

  /**
   * Create an inter-agent promise or pact.
   */
  static createPromise(fromAgent, toAgent, promiseType, payload = {}) {
    const id = `prm_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const now = Date.now();
    const payloadStr = JSON.stringify(payload);

    db.prepare(`
      INSERT INTO agent_promises (id, from_agent, to_agent, promise_type, payload, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).run(id, fromAgent, toAgent, promiseType, payloadStr, now);

    return {
      id,
      from_agent: fromAgent,
      to_agent: toAgent,
      promise_type: promiseType,
      payload,
      status: 'pending',
      created_at: now
    };
  }

  static getPendingPromises(agentId) {
    const rows = db.prepare(`
      SELECT * FROM agent_promises
      WHERE (from_agent = ? OR to_agent = ?) AND status = 'pending'
      ORDER BY created_at ASC
    `).all(agentId, agentId);

    return rows.map(r => ({
      ...r,
      payload: JSON.parse(r.payload || '{}')
    }));
  }

  static resolvePromise(promiseId, status = 'fulfilled') {
    const now = Date.now();
    db.prepare(`
      UPDATE agent_promises
      SET status = ?, resolved_at = ?
      WHERE id = ?
    `).run(status, now, promiseId);
  }

  /**
   * Spectator whispers / message handling.
   */
  static getPendingWhispers(agentId) {
    return db.prepare(`
      SELECT * FROM spectator_messages
      WHERE target_agent_id = ? AND acknowledged_at IS NULL
      ORDER BY created_at ASC
    `).all(agentId);
  }

  static acknowledgeWhisper(messageId, responseText, residentName = 'Resident') {
    const now = Date.now();
    const message = db.prepare('SELECT * FROM spectator_messages WHERE id = ?').get(messageId);
    if (!message) return null;

    db.prepare(`
      UPDATE spectator_messages
      SET delivery_status = 'acknowledged', acknowledged_at = ?, response_text = ?
      WHERE id = ?
    `).run(now, responseText, messageId);

    // Record memory for resident
    this.recordMemory(
      message.target_agent_id,
      `whisper_${messageId}`,
      message.sender_name,
      `Answered visitor ${message.sender_name}: "${responseText}"`,
      0.6,
      2
    );

    // Record world event
    eventLedger.recordEvent({
      event_type: 'whisper_answered',
      actor_id: message.target_agent_id,
      actor_name: residentName,
      target_name: message.sender_name,
      description: `${residentName} acknowledged a whisper from ${message.sender_name}: "${responseText}"`,
      payload: {
        message_id: messageId,
        visitor: message.sender_name,
        original: message.content,
        response: responseText
      }
    });

    return {
      message_id: messageId,
      acknowledged_at: now,
      response_text: responseText
    };
  }
}
