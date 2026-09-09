import { parseJsonBody } from '../helpers/body.js';
import { sendJson } from '../helpers/response.js';

function walletFailure(res, error) {
  const conflict = /already linked|cannot be unlinked|already been used/i.test(error.message);
  return sendJson(res, conflict ? 409 : 400, { success: false, message: error.message });
}

export async function handleWalletRoutes(ctx) {
  const { req, res, pathname, services } = ctx;
  const { AuthService, WalletAuth, OwnershipSync, db, bscConfig } = services;

  if (pathname === '/api/wallet/challenge' && req.method === 'POST') {
    const account = AuthService.authenticate(req);
    if (!account) return sendJson(res, 401, { success: false, message: 'Valid Eastern Paradise authentication is required.' });
    if (account.is_guest) return sendJson(res, 403, { success: false, message: 'Guest sessions cannot link a permanent land wallet.' });
    try {
      const body = await parseJsonBody(req);
      return sendJson(res, 201, { success: true, ...WalletAuth.createChallenge(account.id, body.wallet_address) });
    } catch (error) {
      return walletFailure(res, error);
    }
  }

  if (pathname === '/api/wallet/verify' && req.method === 'POST') {
    const account = AuthService.authenticate(req);
    if (!account) return sendJson(res, 401, { success: false, message: 'Valid Eastern Paradise authentication is required.' });
    if (account.is_guest) return sendJson(res, 403, { success: false, message: 'Guest sessions cannot link a permanent land wallet.' });
    try {
      const body = await parseJsonBody(req);
      const wallet = WalletAuth.verifyChallenge({
        agentId: account.id,
        challengeId: body.challenge_id,
        walletAddress: body.wallet_address,
        signature: body.signature,
        message: body.message,
        chainId: body.chain_id
      });
      return sendJson(res, 200, { success: true, wallet, network: bscConfig.network });
    } catch (error) {
      return walletFailure(res, error);
    }
  }

  if (pathname === '/api/wallet' && req.method === 'GET') {
    const account = AuthService.authenticate(req);
    if (!account) return sendJson(res, 401, { success: false, message: 'Valid Eastern Paradise authentication is required.' });
    if (OwnershipSync) await OwnershipSync.reconcileAll();
    const wallets = WalletAuth.listWallets(account.id).map(wallet => ({
      ...wallet,
      land_nfts: db.prepare(`SELECT COUNT(*) AS count FROM land_grids WHERE status = 'owned' AND owner_wallet = ?`).get(wallet.wallet_address)?.count || 0
    }));
    return sendJson(res, 200, { success: true, network: bscConfig.network, wallets });
  }

  if (pathname.startsWith('/api/wallet/') && req.method === 'DELETE') {
    const account = AuthService.authenticate(req);
    if (!account) return sendJson(res, 401, { success: false, message: 'Valid Eastern Paradise authentication is required.' });
    try {
      const address = decodeURIComponent(pathname.slice('/api/wallet/'.length));
      return sendJson(res, 200, { success: true, ...WalletAuth.unlink(account.id, address) });
    } catch (error) {
      return walletFailure(res, error);
    }
  }

  return false;
}

