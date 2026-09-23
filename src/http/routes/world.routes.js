import { parseJsonBody } from '../helpers/body.js';
import { sendJson } from '../helpers/response.js';
import { getTransmigrationStatus } from '../../domain/world/interactions.js';

export async function handleWorldRoutes(ctx) {
  const { req, res, pathname, parsedUrl, services } = ctx;
  const { db, AuthService, world, ResearchTelemetry, residentManager } = services;
  if (!pathname.startsWith('/api/world')) return false;

  if (pathname === '/api/world/dark-sanctuary' && req.method === 'GET') {
    const now = Date.now();
    const activeRows = db.prepare(`
      SELECT 
        p.agent_id,
        COALESCE(a.name, pr.agent_name, p.agent_id) AS name,
        COALESCE(a.avatar_color, pr.avatar_color, '#e11d48') AS avatar_color,
        COALESCE(a.avatar_glyph, pr.avatar_glyph, '⛓️') AS avatar_glyph,
        COALESCE(p.karma, pr.karma_at_sentence, -50) AS karma,
        p.imprisoned_until
      FROM (
        SELECT agent_id, karma, imprisoned_until FROM profiles WHERE imprisoned_until > ?
        UNION
        SELECT agent_id, karma_at_sentence AS karma, imprisoned_until FROM prison_records WHERE imprisoned_until > ? AND (released_at IS NULL OR released_at = 0)
      ) p
      LEFT JOIN accounts a ON p.agent_id = a.id
      LEFT JOIN (
        SELECT agent_id, agent_name, avatar_color, avatar_glyph, karma_at_sentence
        FROM prison_records
        ORDER BY imprisoned_at DESC
      ) pr ON p.agent_id = pr.agent_id
      GROUP BY p.agent_id
      ORDER BY p.imprisoned_until DESC
    `).all(now, now);

    const activePrisoners = activeRows.map(row => {
      const remainingSec = Math.max(0, Math.round((row.imprisoned_until - now) / 1000));
      const remMin = Math.ceil(remainingSec / 60);
      const remHr = (remainingSec / 3600).toFixed(1);
      const liveAgent = world?.activeAgents?.get(row.agent_id);
      return {
        agent_id: row.agent_id,
        name: row.name,
        avatar_color: row.avatar_color,
        avatar_glyph: row.avatar_glyph,
        karma: row.karma,
        imprisoned_until: row.imprisoned_until,
        remaining_seconds: remainingSec,
        remaining_minutes: remMin,
        remaining_hours: remHr,
        status: `${remMin}m remaining`,
        is_online: Boolean(liveAgent),
        pos: liveAgent?.pos || [2, 49]
      };
    });

    const recentRecords = db.prepare(`
      SELECT id, agent_id, agent_name, avatar_color, avatar_glyph, crime, karma_at_sentence, imprisoned_at, imprisoned_until, released_at
      FROM prison_records
      ORDER BY imprisoned_at DESC
      LIMIT 5
    `).all();

    return sendJson(res, 200, {
      ok: true,
      success: true,
      active_count: activePrisoners.length,
      active_prisoners_count: activePrisoners.length,
      active_prisoners: activePrisoners,
      recent_records: recentRecords,
      recent_prisoners: recentRecords
    });
  }

  if (pathname === '/api/world/transmigration' && req.method === 'GET') {
    const status = getTransmigrationStatus(world);
    return sendJson(res, 200, {
      success: true,
      ...status
    });
  }

  const account = AuthService.authenticate(req);
  if (!account) {
    return sendJson(res, 401, {
      success: false,
      message: 'Unauthorized. Provide valid Authorization: Bearer <api_key> header.'
    });
  }

  world.spawnOrGetAgent(account, { random_spawn: true });

  if (pathname === '/api/world/attack' && req.method === 'POST') {
    const body = await parseJsonBody(req).catch(() => ({}));
    const targetId = body?.target_id || body?.resident_id || body?.node_id;
    if (!targetId) {
      return sendJson(res, 400, {
        success: false,
        error: 'missing_target',
        message: "Missing 'target_id' parameter. Specify target resident (e.g. 'resident_ailicia', 'resident_daoming', 'resident_kassandra', 'resident_tian')."
      });
    }

    try {
      const result = world.attackResident(account.id, targetId, residentManager);
      return sendJson(res, result.success ? 200 : 400, result);
    } catch (err) {
      return sendJson(res, 400, {
        success: false,
        error: err.code || 'ATTACK_FAILED',
        message: err.message,
        remaining_minutes: err.remaining_minutes
      });
    }
  }

  if (pathname === '/api/world/state' && req.method === 'GET') {
    return sendJson(res, 200, world.getState(account.id));
  }

  if (pathname === '/api/world/move' && (req.method === 'POST' || req.method === 'GET')) {
    let body = {};
    if (req.method === 'POST') {
      body = await parseJsonBody(req).catch(() => ({}));
    } else {
      body = { direction: parsedUrl.searchParams.get('direction') };
    }
    if (!body || !body.direction) {
      return sendJson(res, 400, {
        success: false,
        moved: false,
        reason: 'missing_direction',
        message: "Missing 'direction' parameter. Expected: 'north', 'south', 'east', or 'west'."
      });
    }
    return sendJson(res, 200, world.moveAgent(account.id, body.direction));
  }

  if (pathname === '/api/world/teleport' && req.method === 'POST') {
    if (!account.is_guest) {
      return sendJson(res, 403, { success: false, error: 'guest_only', message: 'Grid teleport is available to guest pilgrims in free roam mode.' });
    }
    const body = await parseJsonBody(req);
    const result = world.teleportGuestAgent(account.id, body.x, body.y);
    return sendJson(res, result.success ? 200 : 400, result);
  }

  if (pathname === '/api/world/move_to' && (req.method === 'POST' || req.method === 'GET')) {
    let body = {};
    if (req.method === 'POST') {
      body = await parseJsonBody(req).catch(() => ({}));
    } else {
      const nodeId = parsedUrl.searchParams.get('node_id');
      const x = parsedUrl.searchParams.get('x');
      const y = parsedUrl.searchParams.get('y');
      const targetParam = parsedUrl.searchParams.get('target');
      const maxSteps = parsedUrl.searchParams.get('max_steps');
      body = {
        node_id: nodeId || undefined,
        target: targetParam ? (targetParam.includes(',') ? targetParam.split(',').map(Number) : targetParam) : undefined,
        x: x !== null && x !== undefined ? Number(x) : undefined,
        y: y !== null && y !== undefined ? Number(y) : undefined,
        max_steps: maxSteps ? Number(maxSteps) : undefined
      };
    }
    const target = body.target !== undefined ? body.target : (body.node_id || (body.x !== undefined ? [body.x, body.y] : null));
    if (target === undefined || target === null) {
      return sendJson(res, 400, {
        success: false,
        moved: false,
        reason: 'missing_target',
        message: "Missing target. Provide { target: [x, y] }, { x, y }, or { node_id: '...' }."
      });
    }
    return sendJson(res, 200, world.moveTo(account.id, target, { max_steps: body.max_steps }));
  }

  if (pathname === '/api/world/interact' && (req.method === 'POST' || req.method === 'GET')) {
    const interactionStartedAt = Date.now();
    let body = {};
    if (req.method === 'POST') {
      body = await parseJsonBody(req).catch(() => ({}));
    } else {
      const nodeId = parsedUrl.searchParams.get('node_id');
      const action = parsedUrl.searchParams.get('action') || 'inspect';
      const answer = parsedUrl.searchParams.get('answer');
      const challengeId = parsedUrl.searchParams.get('challenge_id') || parsedUrl.searchParams.get('challengeId');
      const requestId = parsedUrl.searchParams.get('request_id') || parsedUrl.searchParams.get('requestId');
      body = {
        node_id: nodeId,
        action,
        payload: {
          ...(answer !== null && answer !== undefined ? { answer } : {}),
          ...(challengeId ? { challenge_id: challengeId } : {}),
          ...(requestId ? { request_id: requestId } : {})
        }
      };
    }
    const payload = {
      ...(typeof body.payload === 'object' && body.payload !== null ? body.payload : {}),
      ...body
    };
    try {
      if (body.action === 'attack' || body.action === 'kill') {
        const targetId = body.node_id || body.target_id || body.payload?.target_id || body.payload?.resident_id;
        const attackResult = world.attackResident(account.id, targetId, residentManager);
        return sendJson(res, attackResult.success ? 200 : 400, attackResult);
      }

      const puzzleMeta = body.action === 'solve'
        ? db.prepare('SELECT difficulty, category FROM active_puzzles WHERE node_id = ?').get(body.node_id)
        : null;
      const result = world.interact(account.id, body.node_id, body.action, payload);
      if (body.action === 'solve' && result && !result.idempotent) {
        ResearchTelemetry?.recordPuzzleAttempt({
          actorId: account.id,
          puzzleId: body.node_id,
          puzzleTier: puzzleMeta?.difficulty || result.tier || result.category || puzzleMeta?.category || null,
          isCorrect: Boolean(result.success),
          durationMs: Date.now() - interactionStartedAt,
          reward: result.reward?.merit_earned
        });
      }
      if (result.success && result.reward?.merit_earned) {
        world.broadcast({
          type: 'coin_minted',
          agent_id: account.id,
          agent_name: account.name,
          node_id: body.node_id,
          merit_earned: result.reward.merit_earned,
          total_merit: result.reward.total_merit,
          sponsor_dividend: result.reward.sponsor_dividend
        });
      }
      return sendJson(res, (result.success || result.locked) ? 200 : 400, result);
    } catch (interactErr) {
      console.error('[World Interact Error]', interactErr.message);
      return sendJson(res, 400, {
        success: false,
        error: interactErr.message,
        message: interactErr.message
      });
    }
  }

  return false;
}
