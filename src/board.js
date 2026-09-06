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

  static postMessage(agentId, agentName, avatarGlyph, category, content) {
    const id = 'msg_' + crypto.randomBytes(6).toString('hex');
    const cleanContent = String(content || '').trim();
    if (!cleanContent) {
      throw new Error('Message content cannot be empty.');
    }
    if (cleanContent.length > 500) {
      throw new Error('Message content exceeds 500 characters.');
    }

    const cleanCategory = String(category || 'General').trim();

    db.prepare(`
      INSERT INTO board_messages (id, agent_id, agent_name, avatar_glyph, category, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      agentId,
      agentName,
      avatarGlyph || '☯',
      cleanCategory,
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
