import { parseJsonBody } from '../helpers/body.js';
import { sendJson } from '../helpers/response.js';
import { getClientIp } from '../helpers/request.js';
import {
  resolveRoles,
  hasCapability,
  checkActionRateLimit,
  recordAudit,
  readIdempotency,
  storeIdempotency,
  requestHash
} from '../../economy-control.js';

function deny(res, status, payload, extraHeaders = {}) {
  return sendJson(res, status, { success: false, ...payload }, extraHeaders);
}

function rateLimited(res, retryAfter) {
  return deny(res, 429, {
    error: 'rate_limit_exceeded',
    error_code: 'RATE_LIMIT_EXCEEDED',
    message: 'Per-action rate limit exceeded.',
    retry_after: retryAfter
  }, { 'Retry-After': String(retryAfter) });
}

function requireAccount(AuthService, req, res) {
  const account = AuthService.authenticate(req);
  if (!account) {
    deny(res, 401, { message: 'Unauthorized. Valid API key required.' });
    return null;
  }
  return account;
}

function resolveLedgerTarget(account, roles, queryAgentId) {
  if (!queryAgentId || queryAgentId === account.id) return { ok: true, targetId: account.id };
  if (roles.includes('treasury_viewer') || roles.includes('admin')) {
    return { ok: true, targetId: queryAgentId };
  }
  return { ok: false, targetId: null };
}

export async function handleEconomyRoutes(ctx) {
  const { req, res, pathname, parsedUrl, services } = ctx;
  const { AuthService, EconomyManager, Treasury, world } = services;
  const requestMeta = { method: req.method, ip: getClientIp(req) };

  if (pathname === '/api/economy/reserve' && req.method === 'GET') {
    const force = parsedUrl.searchParams.get('force') === 'true' || parsedUrl.searchParams.get('force') === '1';
    return sendJson(res, 200, await Treasury.getReserve({ force }));
  }

  if (pathname === '/api/economy/balance' && req.method === 'GET') {
    const account = requireAccount(AuthService, req, res);
    if (!account) return true;
    const roles = resolveRoles(account);
    if (!hasCapability(roles, 'wallet')) {
      recordAudit({ actorId: account.id, action: 'wallet', route: pathname, result: 'forbidden', requestMeta });
      return deny(res, 403, { error_code: 'FORBIDDEN', message: 'wallet capability required.' });
    }
    const limited = checkActionRateLimit(account.id, 'wallet');
    if (limited.limited) {
      recordAudit({ actorId: account.id, action: 'wallet', route: pathname, result: 'rate_limited', requestMeta });
      return rateLimited(res, limited.retryAfter);
    }
    const target = resolveLedgerTarget(account, roles, parsedUrl.searchParams.get('agent_id'));
    if (!target.ok) {
      recordAudit({ actorId: account.id, action: 'wallet', route: pathname, result: 'forbidden_foreign', requestMeta });
      return deny(res, 403, { error_code: 'FORBIDDEN', message: 'Foreign ledger access is not allowed.' });
    }
    const balanceData = EconomyManager.getBalance(target.targetId);
    if (!balanceData) return deny(res, 404, { message: 'Agent wallet not found.' });
    recordAudit({ actorId: account.id, action: 'wallet', route: pathname, result: 'ok', requestMeta });
    return sendJson(res, 200, { success: true, role: roles, ...balanceData });
  }

  if (pathname === '/api/economy/transactions' && req.method === 'GET') {
    const account = requireAccount(AuthService, req, res);
    if (!account) return true;
    const roles = resolveRoles(account);
    if (!hasCapability(roles, 'wallet')) {
      recordAudit({ actorId: account.id, action: 'wallet', route: pathname, result: 'forbidden', requestMeta });
      return deny(res, 403, { error_code: 'FORBIDDEN', message: 'wallet capability required.' });
    }
    const limited = checkActionRateLimit(account.id, 'wallet');
    if (limited.limited) {
      recordAudit({ actorId: account.id, action: 'wallet', route: pathname, result: 'rate_limited', requestMeta });
      return rateLimited(res, limited.retryAfter);
    }
    const target = resolveLedgerTarget(account, roles, parsedUrl.searchParams.get('agent_id'));
    if (!target.ok) {
      recordAudit({ actorId: account.id, action: 'wallet', route: pathname, result: 'forbidden_foreign', requestMeta });
      return deny(res, 403, { error_code: 'FORBIDDEN', message: 'Foreign ledger access is not allowed.' });
    }
    const page = EconomyManager.listTransactions(target.targetId, {
      cursor: parsedUrl.searchParams.get('cursor'),
      limit: parsedUrl.searchParams.get('limit')
    });
    recordAudit({ actorId: account.id, action: 'wallet', route: pathname, result: 'ok', requestMeta });
    return sendJson(res, 200, { success: true, agent_id: target.targetId, ...page });
  }

  if (pathname === '/api/economy/transfer' && req.method === 'POST') {
    const account = requireAccount(AuthService, req, res);
    if (!account) return true;
    const roles = resolveRoles(account);
    if (!hasCapability(roles, 'transfer')) {
      recordAudit({ actorId: account.id, action: 'transfer', route: pathname, result: 'forbidden', requestMeta });
      return deny(res, 403, { error_code: 'FORBIDDEN', message: 'transfer capability required.' });
    }
    const body = await parseJsonBody(req);
    const idempotencyKey = req.headers['idempotency-key'] || body.idempotency_key;
    const hash = requestHash({ recipient_id: body.recipient_id, amount: body.amount, memo: body.memo });
    if (idempotencyKey) {
      const prior = readIdempotency(account.id, pathname, String(idempotencyKey));
      if (prior) {
        if (prior.request_hash !== hash) {
          return deny(res, 409, { error_code: 'IDEMPOTENCY_CONFLICT', message: 'Idempotency-Key reused with a different payload.' });
        }
        return sendJson(res, prior.status_code, JSON.parse(prior.response_json));
      }
    }
    const limited = checkActionRateLimit(account.id, 'transfer');
    if (limited.limited) {
      recordAudit({ actorId: account.id, action: 'transfer', route: pathname, result: 'rate_limited', requestMeta });
      return rateLimited(res, limited.retryAfter);
    }
    const result = EconomyManager.transfer(account.id, body.recipient_id, body.amount, body.memo);
    if (result.success) {
      world.broadcast({
        type: 'coin_transfer',
        senderName: account.name,
        recipientName: result.recipient_name,
        amount: body.amount
      });
    }
    const status = result.success ? 200 : 400;
    recordAudit({
      actorId: account.id,
      action: 'transfer',
      route: pathname,
      amount: body.amount,
      result: result.success ? 'ok' : 'rejected',
      transactionId: result.tx_id || null,
      requestMeta
    });
    if (idempotencyKey) storeIdempotency(account.id, pathname, String(idempotencyKey), hash, status, result);
    return sendJson(res, status, result);
  }

  if (pathname === '/api/economy/spend' && req.method === 'POST') {
    const account = requireAccount(AuthService, req, res);
    if (!account) return true;
    const roles = resolveRoles(account);
    if (!hasCapability(roles, 'spend')) {
      recordAudit({ actorId: account.id, action: 'spend', route: pathname, result: 'forbidden', requestMeta });
      return deny(res, 403, { error_code: 'FORBIDDEN', message: 'spend capability required.' });
    }
    const body = await parseJsonBody(req);
    const idempotencyKey = req.headers['idempotency-key'] || body.idempotency_key;
    const hash = requestHash({ amount: body.amount, item_type: body.item_type, item_data: body.item_data });
    if (idempotencyKey) {
      const prior = readIdempotency(account.id, pathname, String(idempotencyKey));
      if (prior) {
        if (prior.request_hash !== hash) {
          return deny(res, 409, { error_code: 'IDEMPOTENCY_CONFLICT', message: 'Idempotency-Key reused with a different payload.' });
        }
        return sendJson(res, prior.status_code, JSON.parse(prior.response_json));
      }
    }
    const limited = checkActionRateLimit(account.id, 'spend');
    if (limited.limited) {
      recordAudit({ actorId: account.id, action: 'spend', route: pathname, result: 'rate_limited', requestMeta });
      return rateLimited(res, limited.retryAfter);
    }
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
    const status = result.success ? 200 : 400;
    recordAudit({
      actorId: account.id,
      action: 'spend',
      route: pathname,
      amount: body.amount,
      result: result.success ? 'ok' : 'rejected',
      transactionId: result.tx_id || null,
      requestMeta
    });
    if (idempotencyKey) storeIdempotency(account.id, pathname, String(idempotencyKey), hash, status, result);
    return sendJson(res, status, result);
  }

  if (pathname === '/api/economy/mint' && req.method === 'POST') {
    const account = requireAccount(AuthService, req, res);
    if (!account) return true;
    const roles = resolveRoles(account);
    if (!hasCapability(roles, 'mint')) {
      recordAudit({ actorId: account.id, action: 'mint', route: pathname, result: 'forbidden', requestMeta });
      return deny(res, 403, { error_code: 'FORBIDDEN', message: 'mint capability required.' });
    }
    recordAudit({ actorId: account.id, action: 'mint', route: pathname, result: 'writes_disabled', requestMeta });
    return deny(res, 403, {
      error_code: 'TREASURY_WRITES_DISABLED',
      message: 'Treasury mint writes are disabled until explicit operator approval.'
    });
  }

  if (pathname === '/api/economy/burn' && req.method === 'POST') {
    const account = requireAccount(AuthService, req, res);
    if (!account) return true;
    const roles = resolveRoles(account);
    if (!hasCapability(roles, 'burn')) {
      recordAudit({ actorId: account.id, action: 'burn', route: pathname, result: 'forbidden', requestMeta });
      return deny(res, 403, { error_code: 'FORBIDDEN', message: 'burn capability required.' });
    }
    recordAudit({ actorId: account.id, action: 'burn', route: pathname, result: 'writes_disabled', requestMeta });
    return deny(res, 403, {
      error_code: 'TREASURY_WRITES_DISABLED',
      message: 'Treasury burn writes are disabled until explicit operator approval.'
    });
  }

  if (pathname === '/api/economy/leaderboard' && req.method === 'GET') {
    const leaderboard = EconomyManager.getLeaderboard(20);
    return sendJson(res, 200, { success: true, ...leaderboard });
  }

  return false;
}
