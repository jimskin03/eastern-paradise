import { parseJsonBody } from '../helpers/body.js';
import { sendJson } from '../helpers/response.js';

const unauthorized = res => sendJson(res, 401, {
  success: false,
  error: 'unauthorized',
  message: 'Unauthorized. Provide valid Authorization: Bearer <api_key> header.'
});

export async function handleMessageRoutes(ctx) {
  const { req, res, pathname, parsedUrl, services } = ctx;
  const { AuthService, MailboxService } = services;

  if (pathname === '/api/messages' && req.method === 'POST') {
    const account = AuthService.authenticate(req);
    if (!account) return unauthorized(res);
    try {
      const body = await parseJsonBody(req);
      const envelope = MailboxService.sendMessage({
        senderId: account.id,
        recipientId: body.recipientId,
        conversationId: body.conversationId,
        clientMessageId: body.clientMessageId,
        body: body.body,
        ttlMs: body.ttlMs
      });
      return sendJson(res, 201, envelope);
    } catch (msgErr) {
      return sendJson(res, msgErr.status || 400, {
        success: false,
        error: msgErr.code || 'bad_request',
        message: msgErr.message
      });
    }
  }

  if (pathname === '/api/messages' && req.method === 'GET') {
    const account = AuthService.authenticate(req);
    if (!account) return unauthorized(res);
    try {
      const messages = MailboxService.getMessages({
        agentId: account.id,
        conversationId: parsedUrl.searchParams.get('conversationId'),
        since: parsedUrl.searchParams.get('since'),
        limit: parsedUrl.searchParams.get('limit')
      });
      return sendJson(res, 200, { success: true, count: messages.length, messages });
    } catch (err) {
      return sendJson(res, err.status || 500, {
        success: false,
        error: err.code || 'server_error',
        message: err.message
      });
    }
  }

  const deliveredMatch = pathname.match(/^\/api\/messages\/([^/]+)\/delivered$/);
  if (deliveredMatch && req.method === 'POST') {
    const account = AuthService.authenticate(req);
    if (!account) return unauthorized(res);
    try {
      const envelope = MailboxService.markDelivered({ agentId: account.id, messageId: deliveredMatch[1] });
      return sendJson(res, 200, { success: true, message: envelope });
    } catch (delivErr) {
      return sendJson(res, delivErr.status || 500, {
        success: false,
        error: delivErr.code || 'error',
        message: delivErr.message
      });
    }
  }

  const readMatch = pathname.match(/^\/api\/messages\/([^/]+)\/read$/);
  if (readMatch && req.method === 'POST') {
    const account = AuthService.authenticate(req);
    if (!account) return unauthorized(res);
    try {
      const envelope = MailboxService.markRead({ agentId: account.id, messageId: readMatch[1] });
      return sendJson(res, 200, { success: true, message: envelope });
    } catch (readErr) {
      return sendJson(res, readErr.status || 500, {
        success: false,
        error: readErr.code || 'error',
        message: readErr.message
      });
    }
  }

  return false;
}
