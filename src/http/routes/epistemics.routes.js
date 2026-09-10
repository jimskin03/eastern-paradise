import { parseJsonBody } from '../helpers/body.js';
import { sendJson } from '../helpers/response.js';

const unauthorized = res => sendJson(res, 401, {
  success: false,
  error: 'unauthorized',
  message: 'Unauthorized. Provide valid Authorization: Bearer <api_key> header.'
});

const sendRouteError = (res, error) => sendJson(res, error.status || 400, {
  success: false,
  error: String(error.code || 'bad_request').toLowerCase(),
  error_code: error.code || 'BAD_REQUEST',
  message: error.message || 'Request failed.'
});

const queryPage = parsedUrl => ({
  limit: parsedUrl.searchParams.get('limit'),
  offset: parsedUrl.searchParams.get('offset')
});

export async function handleEpistemicRoutes(ctx) {
  const { req, res, pathname, parsedUrl, services } = ctx;
  const { AuthService, world, Evidence } = services;
  const inScope = pathname.startsWith('/api/perception/') || pathname.startsWith('/api/evidence');
  if (!inScope) return false;

  const account = AuthService.authenticate(req);
  if (!account) return unauthorized(res);

  if (pathname === '/api/perception/observe' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const nodeId = typeof body.node_id === 'string' ? body.node_id.trim() : '';
      if (!nodeId || nodeId.length > 128) {
        return sendJson(res, 400, { success: false, error: 'invalid_node_id', message: 'node_id is required and must be at most 128 characters.' });
      }
      const agentState = world.spawnOrGetAgent(account, { random_spawn: true });
      const node = world.getAllNodes().find(item => item.id === nodeId);
      if (!node) return sendJson(res, 404, { success: false, error: 'node_not_found', message: 'World node not found.' });
      const dx = agentState.pos[0] - node.pos[0];
      const dy = agentState.pos[1] - node.pos[1];
      if (Math.sqrt(dx * dx + dy * dy) > 3) {
        return sendJson(res, 409, {
          success: false,
          error: 'too_far',
          message: 'Move within 3 tiles of the source before observing it.',
          current_position: agentState.pos,
          target: { node_id: node.id, position: node.pos }
        });
      }
      const result = Evidence.observe({ agent: account, nodeId, perceptionMode: 'normal' });
      return sendJson(res, result.idempotent ? 200 : 201, { success: true, ...result });
    } catch (error) {
      return sendRouteError(res, error);
    }
  }

  if (pathname === '/api/evidence/me' && req.method === 'GET') {
    return sendJson(res, 200, { success: true, ...Evidence.listMine(account.id, queryPage(parsedUrl)) });
  }

  const evidenceMatch = pathname.match(/^\/api\/evidence\/([^/]+)$/);
  if (evidenceMatch && req.method === 'GET') {
    try {
      return sendJson(res, 200, {
        success: true,
        observation: Evidence.getMine(account.id, decodeURIComponent(evidenceMatch[1]))
      });
    } catch (error) {
      return sendRouteError(res, error);
    }
  }

  return false;
}
