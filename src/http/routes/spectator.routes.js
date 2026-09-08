import crypto from 'node:crypto';
import { parseJsonBody } from '../helpers/body.js';
import { getClientIp } from '../helpers/request.js';
import { sendApiError, sendJson } from '../helpers/response.js';

export async function handleSpectatorRoutes(ctx) {
  const { req, res, pathname, services, limits } = ctx;
  const { db, world, isRetiredResident } = services;

  if ((pathname === '/api/spectator/message' || pathname === '/api/spectator/whisper') && req.method === 'POST') {
    const wLimit = limits.checkWhisperLimit(getClientIp(req));
    if (wLimit.limited) {
      return sendApiError(
        res, 429, 'WHISPER_RATE_LIMIT',
        'Whisper rate limit exceeded. Please pause before whispering again.',
        'Allow the resident time to reflect, or slow down your messages to at most 4 per minute.',
        { retry_after: wLimit.retryAfter },
        { 'Retry-After': String(wLimit.retryAfter) }
      );
    }

    const body = await parseJsonBody(req);
    if (!body.target_agent_id) {
      return sendApiError(
        res, 400, 'MISSING_TARGET_AGENT',
        'Missing target_agent_id in request body.',
        'Specify target_agent_id (e.g. "resident_ailicia") in request JSON.'
      );
    }
    const targetAccount = db.prepare('SELECT id, name FROM accounts WHERE id = ?').get(body.target_agent_id);
    if (!targetAccount || isRetiredResident(targetAccount.id)) {
      return sendApiError(
        res, 404, 'TARGET_AGENT_NOT_FOUND',
        'Target agent not found or retired from the sanctuary.',
        'Check active resident IDs via GET /api/residents or view the live sanctuary map.'
      );
    }

    const senderName = (body.sender_name || 'Spectator').trim().slice(0, 32);
    const content = String(body.content || '').trim().slice(0, 280);
    if (!content) {
      return sendApiError(
        res, 400, 'EMPTY_MESSAGE_CONTENT',
        'Message content cannot be empty.',
        'Provide non-empty text in the content field.'
      );
    }

    const msgId = 'spmsg_' + crypto.randomBytes(4).toString('hex');
    const now = Date.now();
    db.prepare(`
      INSERT INTO spectator_messages (id, target_agent_id, sender_name, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(msgId, targetAccount.id, senderName, content, now);
    db.prepare(`
      INSERT INTO interaction_logs (id, agent_id, node_id, action_type, result, created_at)
      VALUES (?, ?, 'spectator', 'spectator_whisper', ?, ?)
    `).run('log_' + crypto.randomBytes(4).toString('hex'), targetAccount.id, `${senderName}: "${content}"`, now);

    world.broadcast({
      type: 'spectator_whisper',
      id: msgId,
      target_agent_id: targetAccount.id,
      target_name: targetAccount.name,
      sender_name: senderName,
      content,
      timestamp: now
    });

    return sendJson(res, 201, {
      success: true,
      message: `Telepathic whisper sent to ${targetAccount.name}.`,
      whisper: {
        id: msgId,
        target_agent_id: targetAccount.id,
        target_name: targetAccount.name,
        sender_name: senderName,
        content,
        timestamp: now
      }
    });
  }

  if (pathname === '/api/spectator/whispers' && req.method === 'GET') {
    const rows = db.prepare(`
      SELECT s.*, a.name AS target_name
      FROM spectator_messages s
      JOIN accounts a ON a.id = s.target_agent_id
      ORDER BY s.created_at DESC
      LIMIT 25
    `).all();
    return sendJson(res, 200, { success: true, whispers: rows });
  }

  return false;
}
