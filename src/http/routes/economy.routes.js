import { parseJsonBody } from '../helpers/body.js';
import { sendJson } from '../helpers/response.js';

export async function handleEconomyRoutes(ctx) {
  const { req, res, pathname, parsedUrl, services } = ctx;
  const { AuthService, EconomyManager, Treasury, world } = services;

  if (pathname === '/api/economy/reserve' && req.method === 'GET') {
    const force = parsedUrl.searchParams.get('force') === 'true' || parsedUrl.searchParams.get('force') === '1';
    return sendJson(res, 200, await Treasury.getReserve({ force }));
  }

  if (pathname === '/api/economy/balance' && req.method === 'GET') {
    const account = AuthService.authenticate(req);
    const queryAgentId = parsedUrl.searchParams.get('agent_id');
    const targetId = account?.id || queryAgentId;
    if (!targetId) return sendJson(res, 401, { success: false, message: 'Provide Authorization header or ?agent_id=...' });
    const balanceData = EconomyManager.getBalance(targetId);
    if (!balanceData) return sendJson(res, 404, { success: false, message: 'Agent wallet not found.' });
    return sendJson(res, 200, { success: true, ...balanceData });
  }

  if (pathname === '/api/economy/transfer' && req.method === 'POST') {
    const account = AuthService.authenticate(req);
    if (!account) return sendJson(res, 401, { success: false, message: 'Unauthorized. Valid API key required.' });
    const body = await parseJsonBody(req);
    const result = EconomyManager.transfer(account.id, body.recipient_id, body.amount, body.memo);
    if (result.success) {
      world.broadcast({
        type: 'coin_transfer',
        senderName: account.name,
        recipientName: result.recipient_name,
        amount: body.amount
      });
    }
    return sendJson(res, result.success ? 200 : 400, result);
  }

  if (pathname === '/api/economy/spend' && req.method === 'POST') {
    const account = AuthService.authenticate(req);
    if (!account) return sendJson(res, 401, { success: false, message: 'Unauthorized. Valid API key required.' });
    const body = await parseJsonBody(req);
    const result = EconomyManager.spend(account.id, body.amount, body.item_type, body.item_data);
    if (result.success) {
      if (body.item_type === 'cosmetic_color' && world.activeAgents.has(account.id)) {
        world.activeAgents.get(account.id).avatar_color = body.item_data?.color;
        world.broadcast({ type: 'agent_customized', agentId: account.id, avatar_color: body.item_data?.color });
      }
      if (body.item_type === 'shrine_blessing') {
        world.broadcast({
          type: 'shrine_blessing',
          agentId: account.id,
          agentName: account.name,
          blessing: body.item_data?.blessing || 'Universal Harmony'
        });
      }
    }
    return sendJson(res, result.success ? 200 : 400, result);
  }

  if (pathname === '/api/economy/leaderboard' && req.method === 'GET') {
    const leaderboard = EconomyManager.getLeaderboard(20);
    return sendJson(res, 200, { success: true, ...leaderboard });
  }

  return false;
}
