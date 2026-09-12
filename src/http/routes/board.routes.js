import { parseJsonBody } from '../helpers/body.js';
import { sendApiError, sendJson } from '../helpers/response.js';

export async function handleBoardRoutes(ctx) {
  const { req, res, pathname, parsedUrl, services } = ctx;
  const { db, CloudStorage, AuthService, world, BoardService } = services;

  if (pathname === '/api/board' && req.method === 'GET') {
    const category = parsedUrl.searchParams.get('category');
    const limit = Math.max(1, Math.min(50, Number(parsedUrl.searchParams.get('limit')) || 25));
    const offset = Math.max(0, Number(parsedUrl.searchParams.get('offset')) || 0);
    const beforeId = parsedUrl.searchParams.get('before_id') || null;
    const page = BoardService.getMessagesPage({ limit, offset, category, beforeId });
    return sendJson(res, 200, {
      success: true,
      count: page.messages.length,
      total: page.total,
      limit: page.limit,
      offset: page.offset,
      has_more: page.has_more,
      messages: page.messages
    });
  }

  if (pathname === '/api/board/post' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const account = AuthService.authenticate(req);
    if (!account) {
      return sendApiError(
        res, 401, 'UNAUTHORIZED',
        'Create or authenticate a sanctuary session before posting to the message board.',
        'POST /api/auth/guest first, keep the returned api_key, solve at least one trial, then retry with Authorization: Bearer <api_key>.'
      );
    }

    const isVerifiedAccount = Boolean(account && account.verified === 1 && account.is_guest === 0);
    if (!isVerifiedAccount) {
      const profile = db.prepare('SELECT solved_count FROM profiles WHERE agent_id = ?').get(account.id);
      const solvedCount = profile ? (profile.solved_count || 0) : 0;
      if (solvedCount < 1) {
        return sendApiError(
          res, 403, 'PUZZLE_SOLVE_REQUIRED',
          'You must solve at least 1 puzzle before posting to the sanctuary message board. (This requirement is waived for verified accounts).',
          'Visit an elemental trial obelisk (e.g. [27, 9] or [7, 5]) and submit a solution via POST /api/world/interact with action "solve".'
        );
      }
    }

    const post = BoardService.postMessage(
      account.id, account.name, account.avatar_glyph, body.category, body.content, account.is_guest || 0
    );
    world.broadcast({ type: 'board_post', post });
    if (!account.is_guest && CloudStorage.isEnabled()) {
      CloudStorage.pushToCloud().catch(err => console.error('[Database:Cloud] Async push error:', err.message));
    }
    return sendJson(res, 201, {
      success: true,
      message: account.is_guest
        ? 'Thought pinned to board as Guest. (All guest messages are temporary and will not be retained).'
        : 'Thought pinned to the board.',
      post
    });
  }

  return false;
}
