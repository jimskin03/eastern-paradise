import crypto from 'node:crypto';
import { parseJsonBody } from '../helpers/body.js';
import { sendJson } from '../helpers/response.js';
import { buildGridMetadata, buildGridSvg } from '../../land/grid-metadata.js';

function matchesAdminToken(req) {
  const expected = String(process.env.SNAPSHOT_TOKEN || '');
  const provided = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expected || provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export async function handleLandRoutes(ctx) {
  const { req, res, pathname, services } = ctx;
  const { AuthService, GridRegistry, GridPurchase, WalletAuth, OwnershipSync, solanaConfig } = services;

  if (pathname === '/api/land' && req.method === 'GET') {
    return sendJson(res, 200, { success: true, price_merit: 1000, grids: GridRegistry.list() });
  }

  if (pathname === '/api/land/collection/metadata' && req.method === 'GET') {
    return sendJson(res, 200, {
      name: 'Eastern Paradise Land',
      symbol: 'EPLAND',
      description: 'The official Devnet collection for grid ownership within Eastern Paradise.',
      external_url: 'https://simulation.cryptgregresearch.org/',
      image: `${solanaConfig.metadataBaseUrl}/api/land/collection/image`
    });
  }

  if (pathname === '/api/land/collection/image' && req.method === 'GET') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><rect width="1200" height="1200" fill="#102d25"/><circle cx="600" cy="600" r="390" fill="#397154" stroke="#f4cf87" stroke-width="28"/><text x="600" y="555" fill="#fff6db" font-family="serif" font-size="84" text-anchor="middle">Eastern Paradise</text><text x="600" y="675" fill="#f4cf87" font-family="monospace" font-size="96" font-weight="bold" text-anchor="middle">LAND</text></svg>`;
    res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
    res.end(svg);
    return true;
  }

  if (pathname === '/api/land/my-grids' && req.method === 'GET') {
    const account = AuthService.authenticate(req);
    if (!account) return sendJson(res, 401, { success: false, message: 'Valid Eastern Paradise authentication is required.' });
    await OwnershipSync.reconcileAll();
    return sendJson(res, 200, { success: true, grids: GridRegistry.myGrids(account.id, WalletAuth.listWallets(account.id)) });
  }

  if (pathname === '/api/admin/land/reconcile' && req.method === 'POST') {
    if (!matchesAdminToken(req)) return sendJson(res, 401, { success: false, message: 'Invalid admin token.' });
    const purchases = await GridPurchase.recoverStuck({ olderThanMs: 0 });
    const ownership = await OwnershipSync.reconcileAll();
    return sendJson(res, 200, { success: true, purchases, ownership });
  }

  const match = pathname.match(/^\/api\/land\/([^/]+)(?:\/(purchase|metadata|image))?$/);
  if (!match) return false;
  const gridId = decodeURIComponent(match[1]);
  const action = match[2] || null;
  const grid = GridRegistry.getRaw(gridId);
  if (!grid) return sendJson(res, 404, { success: false, message: 'Grid not found.' });

  if (action === 'metadata' && req.method === 'GET') {
    const metadata = buildGridMetadata(grid, { externalUrl: 'https://simulation.cryptgregresearch.org/' });
    metadata.image = `${solanaConfig.metadataBaseUrl}/api/land/${encodeURIComponent(grid.grid_id)}/image`;
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return sendJson(res, 200, metadata);
  }

  if (action === 'image' && req.method === 'GET') {
    const svg = buildGridSvg(grid);
    res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
    res.end(svg);
    return true;
  }

  if (action === 'purchase' && req.method === 'POST') {
    const account = AuthService.authenticate(req);
    if (!account) return sendJson(res, 401, { success: false, message: 'Valid Eastern Paradise authentication is required.' });
    if (!solanaConfig.purchaseEnabled) return sendJson(res, 503, { success: false, message: 'Land purchasing is disabled until the Devnet NFT provider is configured.' });
    const body = await parseJsonBody(req);
    const wallet = body.wallet_address || WalletAuth.listWallets(account.id).find(item => item.is_primary)?.wallet_address;
    const idempotencyKey = req.headers['idempotency-key'] || body.idempotency_key;
    const replay = idempotencyKey ? GridPurchase.getByIdempotencyKey(String(idempotencyKey)) : null;
    try {
      const result = await GridPurchase.purchase({ agent: account, walletAddress: wallet, gridId, idempotencyKey });
      const status = replay ? 200 : (result.status === 'confirmed' ? 201 : 202);
      return sendJson(res, status, result);
    } catch (error) {
      return sendJson(res, error.httpStatus || 400, { success: false, code: error.code || 'LAND_PURCHASE_FAILED', message: error.message });
    }
  }

  if (!action && req.method === 'PATCH') {
    const account = AuthService.authenticate(req);
    if (!account) return sendJson(res, 401, { success: false, message: 'Valid Eastern Paradise authentication is required.' });
    try {
      const body = await parseJsonBody(req);
      return sendJson(res, 200, { success: true, grid: GridRegistry.updatePlot(account.id, gridId, body) });
    } catch (error) {
      return sendJson(res, 403, { success: false, message: error.message });
    }
  }

  if (!action && req.method === 'GET') {
    return sendJson(res, 200, { success: true, grid: GridRegistry.get(gridId) });
  }

  return false;
}
