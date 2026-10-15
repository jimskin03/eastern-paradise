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
import { handleShrineRoutes } from './routes/shrine.routes.js';
import { handleParkRoutes } from './routes/park.routes.js';

const routeHandlers = [
  handleParkRoutes,
  handleBeaconRoutes,
  handleWalletRoutes,
  handleLandRoutes,
  handleEpistemicRoutes,
  handleHypothesisRoutes,
  handleResearchRoutes,
  handleShrineRoutes,
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

// Public reads are used by crawlers, monitors and background dashboards too.
// Only participation or a verified agent read should renew the activity lease;
// human spectators are accounted for by their live WebSocket connection.
export function shouldRecordActivity(pathname, req, authService) {
  if (!pathname.startsWith('/api/') || PASSIVE_PATHS.has(pathname)
    || pathname.startsWith('/api/admin/') || pathname.startsWith('/api/dev/')) return false;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return true;
  // Legacy browse-only agents create sessions via GET; verification also
  // changes account state. These are actions despite their HTTP method.
  if (req.method === 'GET' && ['/api/auth/guest', '/api/auth/verify'].includes(pathname)) return true;
  return req.method === 'GET' && Boolean(authService?.authenticate(req));
}

export function createRequestHandler({ services, runtime, limits, publicDir }) {
  return async function handleRequest(req, res) {
    if (handleCorsPreflight(req, res)) return;

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    if (pathname === '/privacy' || pathname === '/privacy/') {
      res.writeHead(302, { Location: 'https://cryptgregresearch.org/privacy/' });
      res.end();
      return;
    }

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
        if (handled === true || res.writableEnded || res.headersSent) {
          // Failed authentication, unknown paths, and rate-limited probes are
          // not visitors and must not wake an otherwise empty sanctuary.
          if (res.statusCode < 400 && shouldRecordActivity(pathname, req, services.AuthService)) {
            // Never include query strings: legacy clients can put API keys there.
            runtime.markActivity(`${req.method} ${pathname}`);
          }
          return;
        }
      }

      if (serveStaticFile({ pathname, req, res, publicDir })) return;
      sendJson(res, 404, { error: 'Not Found', path: pathname });
    } catch (err) {
      console.error('[Server] Error handling request:', err);
      sendJson(res, 500, { error: err.message || 'Internal Server Error' });
    }
  };
}
