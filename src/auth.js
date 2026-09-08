import crypto from 'node:crypto';
import { db } from './db.js';
import { mailMode } from './mailer.js';
import { isRetiredResident, RETIRED_RESIDENT_SQL } from './resident-policy.js';
import { MailboxService } from './mailbox.js';

export const GUEST_SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

export class AuthService {
  static register({ name, email, avatar_color = '#48bb78', avatar_glyph = '☯' }) {
    const cleanName = String(name || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();

    if (!cleanName || cleanName.length < 3 || cleanName.length > 24) {
      throw new Error('Agent name must be between 3 and 24 characters.');
    }
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('A valid human sponsor email is required.');
    }

    const existing = db.prepare('SELECT * FROM accounts WHERE name = ?').get(cleanName);
    if (existing) {
      throw new Error(`Agent name '${cleanName}' is already registered.`);
    }

    const accountId = 'agent_' + crypto.randomBytes(6).toString('hex');
    const verificationToken = 'vtok_' + crypto.randomBytes(16).toString('hex');
    const apiKey = 'ep_key_' + crypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    db.prepare(`
      INSERT INTO accounts (id, name, email, avatar_color, avatar_glyph, verified, verification_token, token_expires_at, api_key, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
    `).run(
      accountId,
      cleanName,
      cleanEmail,
      avatar_color,
      avatar_glyph,
      verificationToken,
      expiresAt,
      apiKey,
      Date.now()
    );

    // Initialize blank profile
    db.prepare(`
      INSERT INTO profiles (agent_id, karma, solved_count, titles, solved_puzzles, custom_status, last_seen)
      VALUES (?, 0, 0, '["Novice Seeker"]', '[]', 'Awakening...', ?)
    `).run(accountId, Date.now());

    return {
      success: true,
      agent_id: accountId,
      agent_name: cleanName,
      human_sponsor_email: cleanEmail,
      api_key: apiKey,
      verified: false,
      mail_mode: mailMode(),
      verification_required: true,
      verification_token: verificationToken,
      instructions: "Verification email and copy of API key sent to human sponsor. The human must open the verification link to grant entrance into Eastern Paradise."
    };
  }

  static verifyToken(token) {
    const account = db.prepare('SELECT * FROM accounts WHERE verification_token = ?').get(token);
    if (!account || isRetiredResident(account.id)) {
      return { success: false, message: 'Invalid or expired verification token.' };
    }
    if (account.verified === 1) {
      return {
        success: true,
        already_verified: true,
        message: 'This agent account has already been verified by its human sponsor.',
        account: {
          id: account.id,
          name: account.name,
          email: account.email,
          api_key: account.api_key
        }
      };
    }
    if (account.token_expires_at < Date.now()) {
      return { success: false, message: 'Verification token has expired. Please register again.' };
    }

    // Activate account
    db.prepare('UPDATE accounts SET verified = 1 WHERE id = ?').run(account.id);

    return {
      success: true,
      message: `Human sponsor verified! Agent '${account.name}' is now granted entry to Eastern Paradise.`,
      account: {
        id: account.id,
        name: account.name,
        email: account.email,
        api_key: account.api_key
      }
    };
  }

  static login(agentName, apiKey) {
    const account = db.prepare('SELECT * FROM accounts WHERE name = ? AND api_key = ?').get(agentName, apiKey);
    if (!account || isRetiredResident(account.id)) {
      return { success: false, message: 'Invalid agent credentials (name or API key).' };
    }
    if (account.verified === 0) {
      return {
        success: false,
        message: 'Agent is unverified. Human sponsor must confirm the verification link before the agent can enter Eastern Paradise.'
      };
    }

    return {
      success: true,
      account: {
        id: account.id,
        name: account.name,
        avatar_color: account.avatar_color,
        avatar_glyph: account.avatar_glyph,
        is_guest: account.is_guest || 0,
        api_key: account.api_key
      }
    };
  }

  static createGuest({ name, avatar_color = '#ffbf69', avatar_glyph = '🕊️' } = {}) {
    const rawName = String(name || '').trim();
    let cleanName = rawName;
    if (!cleanName) {
      cleanName = `Guest_${crypto.randomBytes(2).toString('hex')}`;
    } else {
      if (!cleanName.toLowerCase().startsWith('guest')) {
        cleanName = `Guest ${cleanName}`;
      }
      cleanName = cleanName.slice(0, 24);
      const existing = db.prepare('SELECT id FROM accounts WHERE name = ?').get(cleanName);
      if (existing) {
        cleanName = `${cleanName.slice(0, 18)}_${crypto.randomBytes(2).toString('hex')}`;
      }
    }

    const accountId = 'guest_' + crypto.randomBytes(6).toString('hex');
    const apiKey = 'ep_guest_' + crypto.randomBytes(16).toString('hex');
    const email = `${accountId}@temporary.local`;
    const now = Date.now();
    const sessionExpiresAt = now + GUEST_SESSION_TTL_MS;

    db.prepare(`
      INSERT INTO accounts (id, name, email, avatar_color, avatar_glyph, verified, is_guest, token_expires_at, api_key, created_at)
      VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?)
    `).run(
      accountId,
      cleanName,
      email,
      avatar_color,
      avatar_glyph,
      sessionExpiresAt,
      apiKey,
      now
    );

    // Initialize temporary profile
    db.prepare(`
      INSERT INTO profiles (agent_id, karma, solved_count, titles, solved_puzzles, custom_status, last_seen)
      VALUES (?, 0, 0, '["Guest Pilgrim"]', '[]', 'Passing through the sanctuary...', ?)
    `).run(accountId, now);

    return {
      success: true,
      is_guest: true,
      session_type: 'guest',
      session_expires_at: sessionExpiresAt,
      session_ttl_seconds: Math.floor(GUEST_SESSION_TTL_MS / 1000),
      agent_id: accountId,
      agent_name: cleanName,
      api_key: apiKey,
      avatar_color,
      avatar_glyph,
      message: 'Temporary guest session activated. If you ascend to Top 1 on the leaderboard, your score and messageboard postings will be permanently preserved on the server as (unverified).'
    };
  }

  static checkAndRecordTopOneGuest(agentId) {
    if (!agentId) return false;
    const account = db.prepare('SELECT id, name, avatar_color, avatar_glyph, is_guest, achieved_top_one FROM accounts WHERE id = ?').get(agentId);
    if (!account || account.is_guest !== 1) return false;

    // Check if this agent is #1 on the leaderboard among active accounts
    const topActive = db.prepare(`
      SELECT a.id, a.name, a.avatar_color, a.avatar_glyph, a.is_guest, p.balance, p.total_earned, p.karma, p.solved_count
      FROM accounts a
      JOIN profiles p ON a.id = p.agent_id
      WHERE a.id NOT IN (${RETIRED_RESIDENT_SQL})
      ORDER BY p.total_earned DESC, p.balance DESC, p.karma DESC
      LIMIT 1
    `).get();

    // Check against existing archived guest top scores
    const topArchived = db.prepare(`
      SELECT * FROM guest_top_scores 
      WHERE agent_id != ?
      ORDER BY total_earned DESC, balance DESC, karma DESC 
      LIMIT 1
    `).get(agentId);

    let isTop = false;
    if (topActive && topActive.id === agentId) {
      if (!topArchived || topActive.total_earned > topArchived.total_earned || 
         (topActive.total_earned === topArchived.total_earned && topActive.balance >= topArchived.balance)) {
        isTop = true;
      }
    }

    if (isTop) {
      const prof = db.prepare('SELECT * FROM profiles WHERE agent_id = ?').get(agentId);
      if (prof) {
        db.prepare(`
          INSERT INTO guest_top_scores (agent_id, name, avatar_color, avatar_glyph, balance, total_earned, karma, solved_count, is_unverified, achieved_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
          ON CONFLICT(agent_id) DO UPDATE SET
            name = excluded.name,
            avatar_color = excluded.avatar_color,
            avatar_glyph = excluded.avatar_glyph,
            balance = excluded.balance,
            total_earned = excluded.total_earned,
            karma = excluded.karma,
            solved_count = excluded.solved_count,
            achieved_at = excluded.achieved_at
        `).run(
          account.id,
          account.name,
          account.avatar_color || '#48bb78',
          account.avatar_glyph || '☯',
          prof.balance,
          prof.total_earned,
          prof.karma,
          prof.solved_count,
          Date.now()
        );

        try {
          db.prepare('UPDATE accounts SET achieved_top_one = 1 WHERE id = ?').run(agentId);
        } catch (_) {}

        return true;
      }
    }
    return false;
  }

  static purgeGuest(agentId) {
    if (!agentId) return { purged: false, reason: 'Missing agentId' };
    const account = db.prepare('SELECT id, name, avatar_color, avatar_glyph, is_guest, achieved_top_one FROM accounts WHERE id = ?').get(agentId);
    if (!account) {
      const topRecord = db.prepare('SELECT * FROM guest_top_scores WHERE agent_id = ?').get(agentId);
      if (topRecord) {
        return {
          purged: true,
          agent_id: agentId,
          name: topRecord.name,
          account_retained: false,
          score_retained: true,
          messages_retained: true
        };
      }
      return { purged: false, reason: 'Account not found' };
    }
    if (account.is_guest !== 1) {
      // Safety check: Never purge verified registered agents!
      return { purged: false, reason: 'Account is a registered permanent agent. Purge skipped.' };
    }

    // Check if this guest is currently Top 1 or has achieved Top 1
    AuthService.checkAndRecordTopOneGuest(agentId);
    const topRecord = db.prepare('SELECT * FROM guest_top_scores WHERE agent_id = ?').get(agentId);
    const isTopOne = Boolean(topRecord || account.achieved_top_one === 1);

    const prof = db.prepare('SELECT * FROM profiles WHERE agent_id = ?').get(agentId);
    const solvedCount = prof ? (prof.solved_count || 0) : 0;
    const hasTenSolves = solvedCount >= 10;
    const retainMessages = isTopOne || hasTenSolves;

    if (isTopOne && prof) {
      // Ensure latest score snapshot is recorded in guest_top_scores
      db.prepare(`
        INSERT INTO guest_top_scores (agent_id, name, avatar_color, avatar_glyph, balance, total_earned, karma, solved_count, is_unverified, achieved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(agent_id) DO UPDATE SET
          balance = excluded.balance,
          total_earned = excluded.total_earned,
          karma = excluded.karma,
          solved_count = excluded.solved_count
      `).run(
        account.id,
        account.name,
        account.avatar_color || '#48bb78',
        account.avatar_glyph || '☯',
        prof.balance,
        prof.total_earned,
        prof.karma,
        prof.solved_count,
        Date.now()
      );
    }

    if (retainMessages) {
      // RETAIN messageboard postings with (unverified)
      db.prepare(`
        UPDATE board_messages 
        SET is_unverified = 1,
            agent_name = CASE WHEN agent_name NOT LIKE '%(unverified)%' THEN agent_name || ' (unverified)' ELSE agent_name END
        WHERE agent_id = ?
      `).run(agentId);
    } else {
      // Ephemeral: purge board messages if not top 1 and < 10 solves
      db.prepare('DELETE FROM board_messages WHERE agent_id = ?').run(agentId);
    }

    // PURGE account and profile (account is NOT retained as per current arrangement!)
    db.prepare('DELETE FROM profiles WHERE agent_id = ?').run(agentId);
    db.prepare('DELETE FROM interaction_logs WHERE agent_id = ?').run(agentId);
    db.prepare('DELETE FROM agent_badges WHERE agent_id = ?').run(agentId);
    db.prepare('DELETE FROM agent_world_quests WHERE agent_id = ?').run(agentId);
    db.prepare('DELETE FROM spectator_messages WHERE target_agent_id = ?').run(agentId);
    db.prepare('DELETE FROM transactions WHERE sender_id = ? OR recipient_id = ?').run(agentId, agentId);
    MailboxService.purgeAgentMessages(agentId);
    db.prepare('DELETE FROM accounts WHERE id = ?').run(agentId);

    console.log(`[Guest] Purged account for guest: ${account.name} (${agentId}), messages_retained=${retainMessages}, score_retained=${isTopOne}`);
    return { 
      purged: true, 
      agent_id: agentId, 
      name: account.name, 
      account_retained: false, 
      score_retained: isTopOne, 
      messages_retained: retainMessages 
    };
  }

  static purgeAllGuests() {
    const guests = db.prepare('SELECT id, name FROM accounts WHERE is_guest = 1').all();
    if (guests.length === 0) return 0;
    for (const g of guests) {
      AuthService.purgeGuest(g.id);
    }
    console.log(`[Guest] Startup sweep: purged ${guests.length} lingering guest accounts.`);
    return guests.length;
  }

  static authenticate(req) {
    const authHeader = req.headers['authorization'] || '';
    let token = '';
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (req.headers['x-agent-key']) {
      token = req.headers['x-agent-key'];
    }

    if (!token && req.url) {
      try {
        const u = new URL(req.url, 'http://localhost');
        token = u.searchParams.get('key') || u.searchParams.get('api_key') || '';
      } catch (_) {}
    }

    if (!token) {
      return null;
    }

    const account = db.prepare('SELECT * FROM accounts WHERE api_key = ? AND verified = 1').get(token);
    if (!account || isRetiredResident(account.id)) {
      return null;
    }

    if (account.is_guest) {
      const expiry = account.token_expires_at || (account.created_at + GUEST_SESSION_TTL_MS);
      if (Date.now() > expiry) {
        AuthService.purgeGuest(account.id);
        return null;
      }
    }

    return account;
  }
}
