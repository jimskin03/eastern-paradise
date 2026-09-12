import { handleCorsPreflight } from './middleware/cors.js';
import { sendApiError, sendJson } from './helpers/response.js';
import { serveStaticFile } from './helpers/static-files.js';
import { handleProtocolRoutes } from './routes/protocol.routes.js';
import { handleChainRoutes } from './routes/chain.routes.js';
import { handleAuthRoutes } from './routes/auth.routes.js';
import { handleAgentRoutes } from './routes/agent.routes.js';
import { handleWorldRoutes } from './routes/world.routes.js';
import { handleQuestRoutes } from './routes/quests.routes.js';
import { handleBoardRoutes } from './routes/board.routes.js';
import { handleSpectatorRoutes } from './routes/spectator.routes.js';
import { handleMessageRoutes } from './routes/messages.routes.js';
import { handleResidentRoutes } from './routes/residents.routes.js';
import { handleJournalRoutes } from './routes/journal.routes.js';
import { handleProjectRoutes } from './routes/projects.routes.js';
import { handleProfileRoutes } from './routes/profiles.routes.js';
import { handleEconomyRoutes } from './routes/economy.routes.js';
import { handleStatusRoutes } from './routes/status.routes.js';
import { handleAdminRoutes } from './routes/admin.routes.js';
import { handlePuzzleRoutes } from './routes/puzzles.routes.js';
import { handleBeaconRoutes } from './routes/beacon.routes.js';
import { handleWalletRoutes } from './routes/wallet.routes.js';
import { handleLandRoutes } from './routes/land.routes.js';
import { handleEpistemicRoutes } from './routes/epistemics.routes.js';
import { handleHypothesisRoutes } from './routes/hypotheses.routes.js';
import { handleResearchRoutes } from './routes/research.routes.js';

const routeHandlers = [
  handleBeaconRoutes,
  handleWalletRoutes,
  handleLandRoutes,
  handleEpistemicRoutes,
  handleHypothesisRoutes,
  handleResearchRoutes,
  handleChainRoutes,
  handleProtocolRoutes,
  handleAuthRoutes,
  handleAgentRoutes,
  handleWorldRoutes,
  handleQuestRoutes,
  handleBoardRoutes,
  handleSpectatorRoutes,
  handleMessageRoutes,
  handleResidentRoutes,
  handleJournalRoutes,
  handleProjectRoutes,
  handleProfileRoutes,
  handleEconomyRoutes,
  handleStatusRoutes,
  handlePuzzleRoutes,
  handleAdminRoutes
];

const PASSIVE_PATHS = new Set(['/api/status', '/api/metrics', '/api/health', '/health', '/healthz']);

// Static assets and load-balancer health checks must not keep a sleeping
// simulation alive. Normal API requests remain a meaningful visitor signal.
export function shouldRecordActivity(pathname) {
  return pathname.startsWith('/api/') && !PASSIVE_PATHS.has(pathname);
}

export function createRequestHandler({ services, runtime, limits, publicDir }) {
  return async function handleRequest(req, res) {
    if (handleCorsPreflight(req, res)) return;

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    if (shouldRecordActivity(pathname)) runtime.markActivity();

    if (pathname.startsWith('/api/') && !pathname.startsWith('/api/status')) {
      const rl = limits.checkRateLimit(req);
      if (rl.limited) {
        return sendApiError(
          res,
          429,
          'RATE_LIMIT_EXCEEDED',
          'Rate limit exceeded. Please slow down.',
          'Wait for the specified retry_after interval before repeating this request.',
          {
            retry_after: rl.retryAfterHeader || Math.ceil(rl.retryAfter),
            backoff_seconds: rl.retryAfter
          },
          { 'Retry-After': String(rl.retryAfterHeader || Math.ceil(rl.retryAfter)) }
        );
      }
    }

    const ctx = { req, res, pathname, parsedUrl, services, runtime, limits };
    try {
      for (const handler of routeHandlers) {
        const handled = await handler(ctx);
        if (handled === true || res.writableEnded || res.headersSent) return;
      }

      if (serveStaticFile({ pathname, req, res, publicDir })) return;
      sendJson(res, 404, { error: 'Not Found', path: pathname });
    } catch (err) {
      console.error('[Server] Error handling request:', err);
      sendJson(res, 500, { error: err.message || 'Internal Server Error' });
    }
  };
}
