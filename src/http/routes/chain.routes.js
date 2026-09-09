import { sendJson } from '../helpers/response.js';

export async function handleChainRoutes(ctx) {
  const { req, res, pathname, services } = ctx;
  if (pathname === '/api/chain/config' && req.method === 'GET') {
    const { getPublicChainConfig, solanaConfig } = services;
    return sendJson(res, 200, getPublicChainConfig(solanaConfig));
  }
  return false;
}
