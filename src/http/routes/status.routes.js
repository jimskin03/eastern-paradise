import { sendJson } from '../helpers/response.js';

export async function handleStatusRoutes(ctx) {
  const { req, res, pathname, services, runtime } = ctx;
  const { CloudStorage, Mailer, world } = services;

  if (pathname === '/api/status' && req.method === 'GET') {
    return sendJson(res, 200, {
      server_name: 'Eastern Paradise',
      lifecycle_state: runtime.getState(),
      cloud_storage_enabled: CloudStorage.isEnabled(),
      mail_mode: Mailer.mode,
      idle_threshold_seconds: runtime.getIdleTimeoutMs() / 1000,
      active_agents_count: world.activeAgents.size,
      connected_spectators_count: runtime.getConnectedSpectatorCount(),
      uptime_seconds: Math.floor(process.uptime()),
      last_activity_ago_seconds: Math.floor((Date.now() - runtime.getLastActivityTime()) / 1000)
    });
  }

  if (pathname === '/api/dev/recent_dispatches' && req.method === 'GET') {
    if (Mailer.mode !== 'console') {
      const expected = process.env.SNAPSHOT_TOKEN;
      const provided = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!expected || provided !== expected) {
        return sendJson(res, 403, { success: false, error: 'Admin token required in real mail mode.' });
      }
    }
    const dispatches = Mailer.getRecentDispatches().map(d =>
      Mailer.mode === 'console'
        ? d
        : { ...d, verifyUrl: d.verifyUrl ? d.verifyUrl.replace(/token=[^&]+/, 'token=[REDACTED]') : d.verifyUrl }
    );
    return sendJson(res, 200, { dispatches });
  }

  return false;
}
