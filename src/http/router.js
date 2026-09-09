import { handleCorsPreflight } from './middleware/cors.js';
import { sendApiError, sendJson } from './helpers/response.js';
import { serveStaticFile } from './helpers/static-files.js';
import { handleProtocolRoutes } from './routes/protocol.routes.js';
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

const routeHandlers = [
  handleBeaconRoutes,
  handleWalletRoutes,
  handleLandRoutes,
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

export function createRequestHandler({ services, runtime, limits, publicDir }) {
  return async function handleRequest(req, res) {
    runtime.markActivity();

    if (handleCorsPreflight(req, res)) return;

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

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

      if (serveStaticFile({ pathname, res, publicDir })) return;
      sendJson(res, 404, { error: 'Not Found', path: pathname });
    } catch (err) {
      console.error('[Server] Error handling request:', err);
      sendJson(res, 500, { error: err.message || 'Internal Server Error' });
    }
  };
}
