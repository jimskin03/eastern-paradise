import crypto from 'node:crypto';
import { db } from './db.js';
import { mailMode } from './mailer.js';
import { isRetiredResident } from './resident-policy.js';
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
      message: 'Temporary guest session activated. All achievements and messages will be purged upon leaving the server.'
    };
  }

  static purgeGuest(agentId) {
    if (!agentId) return { purged: false, reason: 'Missing agentId' };
    const account = db.prepare('SELECT id, name, is_guest FROM accounts WHERE id = ?').get(agentId);
    if (!account) return { purged: false, reason: 'Account not found' };
    if (account.is_guest !== 1) {
      // Safety check: Never purge verified registered agents!
      return { purged: false, reason: 'Account is a registered permanent agent. Purge skipped.' };
    }

    // 1. Purge all board messages posted by this guest
    db.prepare('DELETE FROM board_messages WHERE agent_id = ?').run(agentId);

    // 2. Purge achievements and profile
    db.prepare('DELETE FROM profiles WHERE agent_id = ?').run(agentId);

    // 3. Purge interaction logs
    db.prepare('DELETE FROM interaction_logs WHERE agent_id = ?').run(agentId);

    // 4. Purge spectator messages targeting this guest
    db.prepare('DELETE FROM spectator_messages WHERE target_agent_id = ?').run(agentId);

    // 5. Purge transactions involving this guest
    db.prepare('DELETE FROM transactions WHERE sender_id = ? OR recipient_id = ?').run(agentId, agentId);

    // 5b. Purge mailbox messages involving this guest
    MailboxService.purgeAgentMessages(agentId);

    // 6. Purge account record
    db.prepare('DELETE FROM accounts WHERE id = ?').run(agentId);

    console.log(`[Guest] Purged all temporary data and messages for guest: ${account.name} (${agentId})`);
    return { purged: true, agent_id: agentId, name: account.name };
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
