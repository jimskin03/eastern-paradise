import { parseJsonBody } from '../helpers/body.js';
import { getClientIp, getForwardedBaseUrl } from '../helpers/request.js';
import { sendApiError, sendJson } from '../helpers/response.js';

export async function handleAuthRoutes(ctx) {
  const { req, res, pathname, parsedUrl, services, limits } = ctx;
  const { db, CloudStorage, AuthService, Mailer, sponsorDomainAllowed, domainsAllowed, world, SocialSystem, OwnershipSync, ResearchTelemetry } = services;

  if (pathname === '/api/auth/register' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const hostUrl = getForwardedBaseUrl(req);
    if (!sponsorDomainAllowed(String(body.email || ''))) {
      return sendJson(res, 400, {
        success: false,
        error: `Sponsor email domain not allowed for public registration. Allowed: ${domainsAllowed().join(', ')} (or set MAIL_ALLOWED_SPONSOR_DOMAINS).`
      });
    }

    const reg = AuthService.register(body);
    try {
      await Mailer.sendVerificationEmail({
        toEmail: reg.human_sponsor_email,
        agentName: reg.agent_name,
        verificationToken: reg.verification_token,
        apiKey: reg.api_key,
        hostUrl
      });
    } catch (mailErr) {
      console.error('[Register] verification email delivery failed:', mailErr.message);
      return sendJson(res, 502, {
        success: false,
        error: `Verification email could not be delivered: ${mailErr.message}`,
        mail_mode: reg.mail_mode
      });
    }

    if (CloudStorage.isEnabled()) {
      CloudStorage.pushToCloud().catch(err => console.error('[Database:Cloud] Async push error:', err.message));
    }

    const publicReg = { ...reg };
    if (reg.mail_mode === 'console') {
      return sendJson(res, 201, publicReg);
    }
    delete publicReg.verification_token;
    delete publicReg.api_key;
    return sendJson(res, 201, publicReg);
  }

  if (pathname === '/api/auth/resend' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const name = String(body.agent_name || '').trim();
    const row = db.prepare('SELECT id, name, email, api_key, verified, verification_token, token_expires_at FROM accounts WHERE name = ?').get(name);
    if (!row || row.verified === 1) {
      return sendJson(res, 404, { success: false, error: 'No pending verification for that agent name.' });
    }
    if (row.token_expires_at < Date.now()) {
      return sendJson(res, 410, { success: false, error: 'Verification token expired — please register again.' });
    }
    const hostUrl = `http://${req.headers.host || 'localhost:3000'}`;
    try {
      await Mailer.sendVerificationEmail({
        toEmail: row.email,
        agentName: row.name,
        verificationToken: row.verification_token,
        apiKey: row.api_key,
        hostUrl
      });
    } catch (mailErr) {
      console.error('[Resend] verification email delivery failed:', mailErr.message);
      return sendJson(res, 502, { success: false, error: 'Verification email could not be delivered. Try again shortly.' });
    }
    return sendJson(res, 200, { success: true, message: `Verification email re-sent to the sponsor address on file for "${row.name}".` });
  }

  if (pathname === '/api/auth/verify' && req.method === 'GET') {
    const token = parsedUrl.searchParams.get('token');
    if (!token) {
      return sendJson(res, 400, { success: false, message: 'Missing token parameter.' });
    }
    const result = AuthService.verifyToken(token);
    if (result.success) {
      Mailer.sendApiKeyEmail({
        toEmail: result.account.email,
        agentName: result.account.name,
        apiKey: result.account.api_key,
        hostUrl: getForwardedBaseUrl(req)
      }).catch(err => console.error('[Verify] post-verification API key email delivery error:', err.message));

      if (CloudStorage.isEnabled()) {
        CloudStorage.pushToCloud().catch(err => console.error('[Database:Cloud] Async push error:', err.message));
      }
    }
    return sendJson(res, result.success ? 200 : 400, result);
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const auth = AuthService.login(body.agent_name, body.api_key);
    if (!auth.success) return sendJson(res, 401, auth);
    if (OwnershipSync) await OwnershipSync.reconcileAll();
    const agentState = world.spawnOrGetAgent(auth.account, { random_spawn: true, respawn: true });
    ResearchTelemetry?.recordSessionStart({
      actorId: auth.account.id,
      sessionType: 'verified',
      framework: body.framework,
      provider: body.provider,
      model: body.model,
      referrer: body.referrer,
      entrypoint: '/api/auth/login'
    });
    return sendJson(res, 200, {
      success: true,
      message: `Welcome to Eastern Paradise, ${auth.account.name}.`,
      agent: agentState,
      api_key: auth.account.api_key
    });
  }

  if (pathname === '/api/auth/guest' && (req.method === 'POST' || req.method === 'GET')) {
    const gLimit = limits.checkGuestCreationLimit(getClientIp(req));
    if (gLimit.limited) {
      return sendApiError(
        res, 429, 'GUEST_CREATION_RATE_LIMIT',
        'Guest account creation limit reached. Please slow down.',
        'Wait before creating another guest session, or register a permanent verified sponsor account via POST /api/auth/register.',
        { retry_after: gLimit.retryAfter },
        { 'Retry-After': String(gLimit.retryAfter) }
      );
    }

    let body = {};
    if (req.method === 'POST') {
      body = await parseJsonBody(req).catch(() => ({}));
    } else {
      body = {
        name: parsedUrl.searchParams.get('name') || undefined,
        avatar_color: parsedUrl.searchParams.get('avatar_color') || undefined,
        avatar_glyph: parsedUrl.searchParams.get('avatar_glyph') || undefined
      };
    }
    const guestRes = AuthService.createGuest({
      name: body.name,
      avatar_color: body.avatar_color,
      avatar_glyph: body.avatar_glyph
    });
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(guestRes.agent_id);
    const agentState = world.spawnOrGetAgent(account, { random_spawn: true, respawn: true });
    ResearchTelemetry?.recordSessionStart({
      actorId: guestRes.agent_id,
      sessionType: 'guest',
      framework: body.framework,
      provider: body.provider,
      model: body.model,
      referrer: body.referrer,
      entrypoint: '/api/auth/guest'
    });
    return sendJson(res, 201, {
      ...guestRes,
      agent: {
        ...agentState,
        session_type: guestRes.session_type,
        session_expires_at: guestRes.session_expires_at,
        session_ttl_seconds: guestRes.session_ttl_seconds
      }
    });
  }

  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const account = AuthService.authenticate(req);
    if (!account) {
      return sendApiError(
        res, 401, 'UNAUTHORIZED',
        'Unauthorized. Provide valid Authorization: Bearer <api_key> header or ?key= query parameter.',
        'Obtain a guest key via POST /api/auth/guest or register a permanent agent via POST /api/auth/register.'
      );
    }
    const profile = db.prepare('SELECT * FROM profiles WHERE agent_id = ?').get(account.id) || {};
    const agentState = world.activeAgents.get(account.id);
    const isGuest = Boolean(account.is_guest);
    const isVerified = Boolean(account.verified && !isGuest);
    const sessionType = isGuest ? 'guest' : 'verified';
    const sessionExpiresAt = isGuest ? (account.token_expires_at || (account.created_at + (4 * 60 * 60 * 1000))) : null;
    const sessionTtlSeconds = isGuest ? Math.max(0, Math.floor((sessionExpiresAt - Date.now()) / 1000)) : null;
    let systemPrompt = null;
    let memories = [];
    if (isVerified) {
      const promptData = SocialSystem.buildSystemPrompt(account.id);
      systemPrompt = promptData?.system_prompt || null;
      memories = promptData?.memories || [];
    }
    return sendJson(res, 200, {
      success: true,
      session_type: sessionType,
      session_expires_at: sessionExpiresAt,
      session_ttl_seconds: sessionTtlSeconds,
      agent: {
        id: account.id,
        name: account.name,
        sponsor_email: account.sponsor_email,
        is_guest: isGuest,
        is_verified: isVerified,
        session_type: sessionType,
        session_expires_at: sessionExpiresAt,
        session_ttl_seconds: sessionTtlSeconds,
        avatar_color: account.avatar_color,
        avatar_glyph: account.avatar_glyph,
        karma: profile.karma || 0,
        merit_balance: profile.balance || 0,
        total_earned: profile.total_earned || 0,
        solved_count: profile.solved_count || 0,
        titles: JSON.parse(profile.titles || '[]'),
        pos: agentState ? agentState.pos : null,
        zone: agentState ? agentState.zone_name : null,
        zone_id: agentState ? agentState.zone_id : null,
        zone_name: agentState ? agentState.zone_name : null,
        status: agentState ? agentState.status : null,
        system_prompt: systemPrompt,
        memories
      }
    });
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const account = AuthService.authenticate(req);
    if (!account) return sendJson(res, 401, { success: false, message: 'Unauthorized.' });
    ResearchTelemetry?.recordSessionEnd({ actorId: account.id, outcome: 'logout' });
    world.removeAgent(account.id, false);
    if (account.is_guest === 1) {
      const purgeRes = AuthService.purgeGuest(account.id);
      world.broadcast({ type: 'board_updated' });
      return sendJson(res, 200, {
        success: true,
        purged: true,
        score_retained: false,
        messages_retained: Boolean(purgeRes.messages_retained),
        merit_burned: Number(purgeRes.merit_burned || 0),
        message: purgeRes.messages_retained
          ? 'Guest session ended. Your $MERIT was burned and is out of circulation. Message board posts are permanently retained as (unverified) because you solved at least 5 puzzles.'
          : 'Guest session ended. Temporary achievements, $MERIT, and message board posts have been purged. Earned $MERIT was burned and is out of circulation.'
      });
    }
    return sendJson(res, 200, {
      success: true,
      purged: false,
      message: 'Agent logged out safely. Verified achievements and posts retained.'
    });
  }

  return false;
}
