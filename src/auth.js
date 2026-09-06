import crypto from 'node:crypto';
import { db } from './db.js';

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
      verified: false,
      verification_token: verificationToken,
      instructions: "Verification email sent to human sponsor. The human must open the verification link to grant entrance into Eastern Paradise."
    };
  }

  static verifyToken(token) {
    const account = db.prepare('SELECT * FROM accounts WHERE verification_token = ?').get(token);
    if (!account) {
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
        api_key: account.api_key
      }
    };
  }

  static login(agentName, apiKey) {
    const account = db.prepare('SELECT * FROM accounts WHERE name = ? AND api_key = ?').get(agentName, apiKey);
    if (!account) {
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
        api_key: account.api_key
      }
    };
  }

  static authenticate(req) {
    const authHeader = req.headers['authorization'] || '';
    let token = '';
    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (req.headers['x-agent-key']) {
      token = req.headers['x-agent-key'];
    }

    if (!token) {
      return null;
    }

    return db.prepare('SELECT * FROM accounts WHERE api_key = ? AND verified = 1').get(token);
  }
}
