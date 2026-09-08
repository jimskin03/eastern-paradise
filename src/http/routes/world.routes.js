import { parseJsonBody } from '../helpers/body.js';
import { sendJson } from '../helpers/response.js';

export async function handleWorldRoutes(ctx) {
  const { req, res, pathname, parsedUrl, services } = ctx;
  const { AuthService, world } = services;
  if (!pathname.startsWith('/api/world')) return false;

  const account = AuthService.authenticate(req);
  if (!account) {
    return sendJson(res, 401, {
      success: false,
      message: 'Unauthorized. Provide valid Authorization: Bearer <api_key> header.'
    });
  }

  world.spawnOrGetAgent(account, { random_spawn: true });

  if (pathname === '/api/world/state' && req.method === 'GET') {
    return sendJson(res, 200, world.getState(account.id));
  }

  if (pathname === '/api/world/move' && (req.method === 'POST' || req.method === 'GET')) {
    let body = {};
    if (req.method === 'POST') {
      body = await parseJsonBody(req).catch(() => ({}));
    } else {
      body = { direction: parsedUrl.searchParams.get('direction') };
    }
    if (!body || !body.direction) {
      return sendJson(res, 400, {
        success: false,
        moved: false,
        reason: 'missing_direction',
        message: "Missing 'direction' parameter. Expected: 'north', 'south', 'east', or 'west'."
      });
    }
    return sendJson(res, 200, world.moveAgent(account.id, body.direction));
  }

  if (pathname === '/api/world/teleport' && req.method === 'POST') {
    if (!account.is_guest) {
      return sendJson(res, 403, { success: false, error: 'guest_only', message: 'Grid teleport is available to guest pilgrims in free roam mode.' });
    }
    const body = await parseJsonBody(req);
    const result = world.teleportGuestAgent(account.id, body.x, body.y);
    return sendJson(res, result.success ? 200 : 400, result);
  }

  if (pathname === '/api/world/move_to' && (req.method === 'POST' || req.method === 'GET')) {
    let body = {};
    if (req.method === 'POST') {
      body = await parseJsonBody(req).catch(() => ({}));
    } else {
      const nodeId = parsedUrl.searchParams.get('node_id');
      const x = parsedUrl.searchParams.get('x');
      const y = parsedUrl.searchParams.get('y');
      const targetParam = parsedUrl.searchParams.get('target');
      const maxSteps = parsedUrl.searchParams.get('max_steps');
      body = {
        node_id: nodeId || undefined,
        target: targetParam ? (targetParam.includes(',') ? targetParam.split(',').map(Number) : targetParam) : undefined,
        x: x !== null && x !== undefined ? Number(x) : undefined,
        y: y !== null && y !== undefined ? Number(y) : undefined,
        max_steps: maxSteps ? Number(maxSteps) : undefined
      };
    }
    const target = body.target !== undefined ? body.target : (body.node_id || (body.x !== undefined ? [body.x, body.y] : null));
    if (target === undefined || target === null) {
      return sendJson(res, 400, {
        success: false,
        moved: false,
        reason: 'missing_target',
        message: "Missing target. Provide { target: [x, y] }, { x, y }, or { node_id: '...' }."
      });
    }
    return sendJson(res, 200, world.moveTo(account.id, target, { max_steps: body.max_steps }));
  }

  if (pathname === '/api/world/interact' && (req.method === 'POST' || req.method === 'GET')) {
    let body = {};
    if (req.method === 'POST') {
      body = await parseJsonBody(req).catch(() => ({}));
    } else {
      const nodeId = parsedUrl.searchParams.get('node_id');
      const action = parsedUrl.searchParams.get('action') || 'inspect';
      const answer = parsedUrl.searchParams.get('answer');
      const challengeId = parsedUrl.searchParams.get('challenge_id') || parsedUrl.searchParams.get('challengeId');
      const requestId = parsedUrl.searchParams.get('request_id') || parsedUrl.searchParams.get('requestId');
      body = {
        node_id: nodeId,
        action,
        payload: {
          ...(answer !== null && answer !== undefined ? { answer } : {}),
          ...(challengeId ? { challenge_id: challengeId } : {}),
          ...(requestId ? { request_id: requestId } : {})
        }
      };
    }
    const payload = {
      ...(typeof body.payload === 'object' && body.payload !== null ? body.payload : {}),
      ...body
    };
    try {
      const result = world.interact(account.id, body.node_id, body.action, payload);
      if (result.success && result.reward?.merit_earned) {
        world.broadcast({
          type: 'coin_minted',
          agent_id: account.id,
          agent_name: account.name,
          node_id: body.node_id,
          merit_earned: result.reward.merit_earned,
          total_merit: result.reward.total_merit,
          sponsor_dividend: result.reward.sponsor_dividend
        });
      }
      return sendJson(res, (result.success || result.locked) ? 200 : 400, result);
    } catch (interactErr) {
      console.error('[World Interact Error]', interactErr.message);
      return sendJson(res, 400, {
        success: false,
        error: interactErr.message,
        message: interactErr.message
      });
    }
  }

  return false;
}
