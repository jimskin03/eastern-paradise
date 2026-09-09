import crypto from 'node:crypto';
import { db } from './db.js';
import { isRetiredResident } from './resident-policy.js';

export function formatEnvelope(row) {
  return {
    messageId: row.message_id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    sequence: Number(row.sequence),
    clientMessageId: row.client_message_id,
    body: row.body,
    createdAt: Number(row.created_at),
    ttlMs: Number(row.ttl_ms),
    deliveryAck: Number(row.delivery_ack),
    readAck: Number(row.read_ack)
  };
}

export class MailboxService {
  /**
   * Dispatches a private agent-to-agent message.
   * Derives senderId from authenticated agent key (caller).
   */
  static sendMessage({ senderId, recipientId, conversationId, clientMessageId, body, ttlMs }) {
    if (!senderId) {
      const err = new Error('Unauthorized sender.');
      err.status = 401;
      throw err;
    }
    if (!recipientId) {
      const err = new Error("Missing 'recipientId' parameter.");
      err.status = 400;
      throw err;
    }
    if (!conversationId) {
      const err = new Error("Missing 'conversationId' parameter.");
      err.status = 400;
      throw err;
    }
    if (!clientMessageId) {
      const err = new Error("Missing 'clientMessageId' idempotency key.");
      err.status = 400;
      throw err;
    }
    if (typeof body !== 'string') {
      const err = new Error("Missing or invalid 'body' string.");
      err.status = 400;
      throw err;
    }

    // 1. Verify recipient exists and is an active account
    const recipient = db.prepare('SELECT id, name FROM accounts WHERE id = ?').get(recipientId);
    if (!recipient || isRetiredResident(recipient.id)) {
      const err = new Error(`Recipient agent '${recipientId}' not found.`);
      err.status = 404;
      err.code = 'recipient_not_found';
      throw err;
    }

    // 2. Idempotency Check: (conversation_id, sender_id, client_message_id)
    const existing = db.prepare(`
      SELECT * FROM messages 
      WHERE conversation_id = ? AND sender_id = ? AND client_message_id = ?
    `).get(conversationId, senderId, clientMessageId);

    if (existing) {
      return formatEnvelope(existing);
    }

    // 3. Atomically allocate next monotonic sequence within conversation
    const seqRow = db.prepare(`
      SELECT COALESCE(MAX(sequence), 0) + 1 AS next_seq 
      FROM messages 
      WHERE conversation_id = ?
    `).get(conversationId);
    const nextSeq = seqRow.next_seq;

    const messageId = 'msg_' + crypto.randomBytes(8).toString('hex');
    const createdAt = Date.now();
    const effectiveTtl = Number(ttlMs) > 0 ? Number(ttlMs) : 86400000; // 24 hours default

    db.prepare(`
      INSERT INTO messages (
        message_id, conversation_id, sender_id, recipient_id, 
        sequence, client_message_id, body, created_at, ttl_ms, 
        delivery_ack, read_ack
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
    `).run(
      messageId,
      conversationId,
      senderId,
      recipientId,
      nextSeq,
      clientMessageId,
      body,
      createdAt,
      effectiveTtl
    );

    const inserted = db.prepare('SELECT * FROM messages WHERE message_id = ?').get(messageId);
    return formatEnvelope(inserted);
  }

  /**
   * Retrieves messages for an agent (as sender or recipient) in monotonic sequence order.
   * Filters out expired messages.
   */
  static getMessages({ agentId, conversationId = null, since = 0, limit = 50 }) {
    if (!agentId) {
      const err = new Error('Unauthorized agent.');
      err.status = 401;
      throw err;
    }

    const now = Date.now();
    const maxLimit = Math.min(100, Math.max(1, Number(limit) || 50));
    const cursor = Number(since) || 0;

    let query = `
      SELECT * FROM messages
      WHERE (sender_id = ? OR recipient_id = ?)
        AND (created_at + ttl_ms) > ?
    `;
    const params = [agentId, agentId, now];

    if (conversationId) {
      query += ` AND conversation_id = ?`;
      params.push(conversationId);
    }

    if (cursor > 0) {
      query += ` AND sequence > ?`;
      params.push(cursor);
    }

    query += ` ORDER BY sequence ASC, created_at ASC LIMIT ?`;
    params.push(maxLimit);

    const rows = db.prepare(query).all(...params);
    return rows.map(formatEnvelope);
  }

  /**
   * Unread inbox: only active incoming messages where the authenticated agent
   * is the recipient, read_ack = 0, and TTL has not expired. Sent messages are
   * never included. Ordered oldest first so agents process in arrival order.
   */
  static getUnreadMessages({ agentId, limit = 50 }) {
    if (!agentId) {
      const err = new Error('Unauthorized agent.');
      err.status = 401;
      throw err;
    }

    const now = Date.now();
    const maxLimit = Math.min(100, Math.max(1, Number(limit) || 50));

    const rows = db.prepare(`
      SELECT * FROM messages
      WHERE recipient_id = ?
        AND read_ack = 0
        AND (created_at + ttl_ms) > ?
      ORDER BY created_at ASC
      LIMIT ?
    `).all(agentId, now, maxLimit);
    return rows.map(formatEnvelope);
  }

  /**
   * Lightweight inbox metadata for world-state awareness (no message bodies).
   */
  static getInboxSummary(agentId) {
    const row = db.prepare(`
      SELECT COUNT(*) AS unread_count, MIN(created_at) AS oldest_unread_at
      FROM messages
      WHERE recipient_id = ?
        AND read_ack = 0
        AND (created_at + ttl_ms) > ?
    `).get(agentId, Date.now());
    const unreadCount = Number(row.unread_count) || 0;
    return {
      unread_count: unreadCount,
      oldest_unread_at: unreadCount > 0 ? Number(row.oldest_unread_at) : null,
      check_recommended: unreadCount > 0
    };
  }

  /**
   * Marks a message as delivered (called by recipient or sender).
   */
  static markDelivered({ agentId, messageId }) {
    if (!agentId) {
      const err = new Error('Unauthorized.');
      err.status = 401;
      throw err;
    }

    const row = db.prepare('SELECT * FROM messages WHERE message_id = ?').get(messageId);
    if (!row) {
      const err = new Error('Message not found.');
      err.status = 404;
      throw err;
    }

    if (row.sender_id !== agentId && row.recipient_id !== agentId) {
      const err = new Error('Forbidden: you are neither sender nor recipient of this message.');
      err.status = 403;
      throw err;
    }

    if (row.delivery_ack !== 1) {
      db.prepare('UPDATE messages SET delivery_ack = 1 WHERE message_id = ?').run(messageId);
      row.delivery_ack = 1;
    }

    return formatEnvelope(row);
  }

  /**
   * Marks a message as read (recipient only).
   */
  static markRead({ agentId, messageId }) {
    if (!agentId) {
      const err = new Error('Unauthorized.');
      err.status = 401;
      throw err;
    }

    const row = db.prepare('SELECT * FROM messages WHERE message_id = ?').get(messageId);
    if (!row) {
      const err = new Error('Message not found.');
      err.status = 404;
      throw err;
    }

    // Spec §1.2 & §3.3 (Test 5): Auth required (recipient only). Sets readAck=1. Non-recipient returns 403.
    if (row.recipient_id !== agentId) {
      const err = new Error('Forbidden: only the recipient can mark a message as read.');
      err.status = 403;
      throw err;
    }

    if (row.read_ack !== 1 || row.delivery_ack !== 1) {
      db.prepare('UPDATE messages SET read_ack = 1, delivery_ack = 1 WHERE message_id = ?').run(messageId);
      row.read_ack = 1;
      row.delivery_ack = 1;
    }

    return formatEnvelope(row);
  }

  /**
   * Purges messages associated with an agent (used on guest session cleanup).
   */
  static purgeAgentMessages(agentId) {
    if (!agentId) return 0;
    const info = db.prepare('DELETE FROM messages WHERE sender_id = ? OR recipient_id = ?').run(agentId, agentId);
    return info.changes;
  }

  /**
   * Removes expired messages where ttl has elapsed.
   */
  static pruneExpired() {
    const now = Date.now();
    const info = db.prepare('DELETE FROM messages WHERE (created_at + ttl_ms) <= ?').run(now);
    return info.changes;
  }
}
