import crypto from 'node:crypto';
import { decodeBase58, isSolanaAddress } from './solana-client.js';

export const WALLET_CHALLENGE_TTL_MS = 5 * 60 * 1000;

export function buildWalletChallengeMessage({ agentId, walletAddress, nonce, expiresAt }) {
  return [
    'Eastern Paradise Wallet Verification',
    '',
    `Agent: ${agentId}`,
    `Wallet: ${walletAddress}`,
    `Nonce: ${nonce}`,
    'Purpose: Link this Solana wallet to Eastern Paradise.',
    `Expires: ${expiresAt}`
  ].join('\n');
}

function decodeSignature(value, encoding = '') {
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return Uint8Array.from(value);
  const input = String(value || '').trim();
  if (!input) throw new Error('Signature is required.');
  if (encoding === 'base58') return decodeBase58(input);
  if (encoding === 'base64') return Uint8Array.from(Buffer.from(input, 'base64'));
  try {
    const decoded = Buffer.from(input, 'base64');
    if (decoded.length === 64) return Uint8Array.from(decoded);
  } catch {}
  return decodeBase58(input);
}

export function verifySolanaMessage({ walletAddress, message, signature, signatureEncoding }) {
  if (!isSolanaAddress(walletAddress)) return false;
  try {
    const publicKeyBytes = decodeBase58(walletAddress);
    const signatureBytes = decodeSignature(signature, signatureEncoding);
    if (signatureBytes.length !== 64) return false;
    const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const publicKey = crypto.createPublicKey({
      key: Buffer.concat([spkiPrefix, Buffer.from(publicKeyBytes)]),
      format: 'der',
      type: 'spki'
    });
    return crypto.verify(null, Buffer.from(message, 'utf8'), publicKey, Buffer.from(signatureBytes));
  } catch {
    return false;
  }
}

export class WalletAuthService {
  constructor({ db, now = () => Date.now(), randomBytes = crypto.randomBytes } = {}) {
    this.db = db;
    this.now = now;
    this.randomBytes = randomBytes;
  }

  createChallenge(agentId, walletAddress) {
    const address = String(walletAddress || '').trim();
    if (!isSolanaAddress(address)) throw new Error('A valid Solana wallet address is required.');
    const now = this.now();
    const expiresAt = now + WALLET_CHALLENGE_TTL_MS;
    const nonce = this.randomBytes(32).toString('hex');
    const id = `wch_${crypto.randomBytes(12).toString('hex')}`;
    const message = buildWalletChallengeMessage({ agentId, walletAddress: address, nonce, expiresAt });
    this.db.prepare(`
      INSERT INTO wallet_challenges (id, agent_id, wallet_address, nonce, message, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, agentId, address, nonce, message, expiresAt, now);
    return { challenge_id: id, wallet_address: address, message, expires_at: expiresAt };
  }

  verifyChallenge({ agentId, challengeId, walletAddress, signature, signatureEncoding, message }) {
    const challenge = this.db.prepare('SELECT * FROM wallet_challenges WHERE id = ?').get(challengeId);
    if (!challenge || challenge.agent_id !== agentId) throw new Error('Wallet challenge was not found for this agent.');
    if (challenge.consumed_at) throw new Error('Wallet challenge has already been used.');
    if (challenge.expires_at <= this.now()) throw new Error('Wallet challenge has expired.');
    const address = String(walletAddress || '').trim();
    if (address !== challenge.wallet_address) throw new Error('Wallet does not match the challenge.');
    const expected = buildWalletChallengeMessage({
      agentId: challenge.agent_id,
      walletAddress: challenge.wallet_address,
      nonce: challenge.nonce,
      expiresAt: challenge.expires_at
    });
    if (challenge.message !== expected || (message !== undefined && message !== expected)) {
      throw new Error('Wallet challenge message was modified.');
    }
    if (!verifySolanaMessage({ walletAddress: address, message: expected, signature, signatureEncoding })) {
      throw new Error('Wallet signature verification failed.');
    }

    const now = this.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const fresh = this.db.prepare('SELECT consumed_at FROM wallet_challenges WHERE id = ?').get(challengeId);
      if (!fresh || fresh.consumed_at) throw new Error('Wallet challenge has already been used.');
      const existing = this.db.prepare('SELECT agent_id FROM wallet_links WHERE wallet_address = ?').get(address);
      if (existing && existing.agent_id !== agentId) throw new Error('Wallet is already linked to another Eastern Paradise agent.');
      this.db.prepare('UPDATE wallet_links SET is_primary = 0 WHERE agent_id = ?').run(agentId);
      this.db.prepare(`
        INSERT INTO wallet_links (agent_id, chain, wallet_address, verified_at, is_primary)
        VALUES (?, 'solana', ?, ?, 1)
        ON CONFLICT(agent_id, wallet_address) DO UPDATE SET verified_at = excluded.verified_at, is_primary = 1
      `).run(agentId, address, now);
      this.db.prepare('UPDATE wallet_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL').run(now, challengeId);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { wallet_address: address, chain: 'solana', verified_at: now, is_primary: true };
  }

  listWallets(agentId) {
    return this.db.prepare(`
      SELECT chain, wallet_address, verified_at, is_primary
      FROM wallet_links WHERE agent_id = ? ORDER BY is_primary DESC, verified_at DESC
    `).all(agentId);
  }

  unlink(agentId, walletAddress) {
    const owned = this.db.prepare(`
      SELECT grid_id FROM land_grids WHERE owner_wallet = ? AND status = 'owned' LIMIT 1
    `).get(walletAddress);
    if (owned) throw new Error(`Wallet cannot be unlinked while it owns grid ${owned.grid_id}.`);
    const result = this.db.prepare('DELETE FROM wallet_links WHERE agent_id = ? AND wallet_address = ?').run(agentId, walletAddress);
    if (!result.changes) throw new Error('Linked wallet not found.');
    const primary = this.db.prepare('SELECT wallet_address FROM wallet_links WHERE agent_id = ? ORDER BY verified_at DESC LIMIT 1').get(agentId);
    if (primary) this.db.prepare('UPDATE wallet_links SET is_primary = 1 WHERE agent_id = ? AND wallet_address = ?').run(agentId, primary.wallet_address);
    return { unlinked: true, wallet_address: walletAddress };
  }

  pruneExpiredChallenges() {
    return this.db.prepare('DELETE FROM wallet_challenges WHERE expires_at < ? OR consumed_at IS NOT NULL').run(this.now()).changes;
  }
}

