import { sendJson } from '../helpers/response.js';

export async function handleProfileRoutes(ctx) {
  const { req, res, pathname, services } = ctx;
  const { db, AuthService, SocialSystem, isRetiredResident, RETIRED_RESIDENT_SQL } = services;

  if (pathname === '/api/profile/me' && req.method === 'GET') {
    const account = AuthService.authenticate(req);
    if (!account) return sendJson(res, 401, { success: false, message: 'Unauthorized.' });
    const profile = db.prepare('SELECT * FROM profiles WHERE agent_id = ?').get(account.id);
    return sendJson(res, 200, {
      account: {
        id: account.id,
        name: account.name,
        email: account.email,
        avatar_color: account.avatar_color,
        avatar_glyph: account.avatar_glyph,
        sponsor_balance: account.sponsor_balance || 0
      },
      profile: {
        karma: profile.karma,
        balance: profile.balance || 0,
        total_earned: profile.total_earned || 0,
        solved_count: profile.solved_count,
        titles: JSON.parse(profile.titles || '[]'),
        solved_puzzles: JSON.parse(profile.solved_puzzles || '[]'),
        custom_status: profile.custom_status,
        last_seen: profile.last_seen
      }
    });
  }

  if (pathname.startsWith('/api/profile/') && req.method === 'GET') {
    const id = pathname.replace('/api/profile/', '').trim();
    const account = db.prepare('SELECT id, name, avatar_color, avatar_glyph, sponsor_balance, created_at, verified, is_guest FROM accounts WHERE id = ?').get(id);
    if (!account || isRetiredResident(account.id)) {
      return sendJson(res, 404, { success: false, message: 'Agent profile not found.' });
    }
    const profile = db.prepare('SELECT * FROM profiles WHERE agent_id = ?').get(id);
    const isVerified = Boolean(account.verified && !account.is_guest);
    let promptData = null;
    if (isVerified) promptData = SocialSystem.buildSystemPrompt(account.id);
    return sendJson(res, 200, {
      account,
      profile: {
        karma: profile?.karma || 0,
        balance: profile?.balance || 0,
        total_earned: profile?.total_earned || 0,
        solved_count: profile?.solved_count || 0,
        titles: JSON.parse(profile?.titles || '[]'),
        solved_puzzles: JSON.parse(profile?.solved_puzzles || '[]'),
        custom_status: profile?.custom_status || 'Contemplating existence',
        last_seen: profile?.last_seen || Date.now(),
        is_verified: isVerified,
        system_prompt: promptData?.system_prompt || null,
        memories: promptData?.memories || []
      }
    });
  }

  if (pathname === '/api/inhabitants' && req.method === 'GET') {
    const inhabitants = db.prepare(`
      SELECT a.id, a.name, a.avatar_color, a.avatar_glyph, a.sponsor_balance, p.karma, p.balance, p.total_earned, p.solved_count, p.titles, p.last_seen
      FROM accounts a
      JOIN profiles p ON a.id = p.agent_id
      WHERE a.verified = 1 AND a.id NOT IN (${RETIRED_RESIDENT_SQL})
      ORDER BY p.total_earned DESC, p.karma DESC, p.solved_count DESC
    `).all();
    return sendJson(res, 200, {
      count: inhabitants.length,
      inhabitants: inhabitants.map(i => ({ ...i, titles: JSON.parse(i.titles || '[]') }))
    });
  }

  return false;
}
