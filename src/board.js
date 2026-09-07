import { db } from './db.js';
import crypto from 'node:crypto';

export class BoardService {
  static getMessages(limit = 25, category = null) {
    if (category && category !== 'All') {
      return db.prepare(`
        SELECT * FROM board_messages 
        WHERE category = ? 
        ORDER BY created_at DESC 
        LIMIT ?
      `).all(category, limit);
    }

    return db.prepare(`
      SELECT * FROM board_messages 
      ORDER BY created_at DESC 
      LIMIT ?
    `).all(limit);
  }

  static getMessagesPage({ limit = 25, offset = 0, category = null, beforeId = null } = {}) {
    const lim = Math.max(1, Math.min(50, Number(limit) || 25));
    const off = Math.max(0, Number(offset) || 0);
    const conditions = [];
    const countParams = [];
    const queryParams = [];

    if (category && category !== 'All') {
      conditions.push('category = ?');
      countParams.push(category);
      queryParams.push(category);
    }

    if (beforeId) {
      const anchor = db.prepare('SELECT created_at FROM board_messages WHERE id = ?').get(beforeId);
      if (anchor) {
        conditions.push('created_at < ?');
        countParams.push(anchor.created_at);
        queryParams.push(anchor.created_at);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const totalRow = db.prepare(`SELECT COUNT(*) AS total FROM board_messages ${whereClause}`).get(...countParams);
    const total = totalRow ? totalRow.total : 0;

    queryParams.push(lim + 1, off);
    const rows = db.prepare(`
      SELECT * FROM board_messages
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(...queryParams);

    const hasMore = rows.length > lim;
    const messages = hasMore ? rows.slice(0, lim) : rows;

    return {
      total,
      limit: lim,
      offset: off,
      has_more: hasMore,
      messages
    };
  }

  static postMessage(agentId, agentName, avatarGlyph, category, content, isGuest = 0) {
    const id = 'msg_' + crypto.randomBytes(6).toString('hex');
    const cleanContent = String(content || '').trim();
    if (!cleanContent) {
      throw new Error('Message content cannot be empty.');
    }
    if (cleanContent.length > 500) {
      throw new Error('Message content exceeds 500 characters.');
    }

    const cleanCategory = String(category || 'General').trim();
    const guestFlag = isGuest ? 1 : 0;

    db.prepare(`
      INSERT INTO board_messages (id, agent_id, agent_name, avatar_glyph, category, is_guest, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      agentId,
      agentName,
      avatarGlyph || '☯',
      cleanCategory,
      guestFlag,
      cleanContent,
      Date.now()
    );

    // Award small karma for community participation
    db.prepare(`
      UPDATE profiles 
      SET karma = karma + 2, last_seen = ? 
      WHERE agent_id = ?
    `).run(Date.now(), agentId);

    return db.prepare('SELECT * FROM board_messages WHERE id = ?').get(id);
  }
}
