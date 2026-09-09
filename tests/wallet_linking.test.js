import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { createLocalSchema } from '../src/infrastructure/database/schema.js';
import { WalletAuthService } from '../src/blockchain/wallet-auth.js';
import { encodeBase58 } from '../src/blockchain/solana-client.js';

function setup(now = Date.now()) {
  const db = new DatabaseSync(':memory:');
  createLocalSchema(db);
  for (const id of ['agent_a', 'agent_b']) {
    db.prepare(`INSERT INTO accounts (id, name, email, verified, api_key, created_at) VALUES (?, ?, ?, 1, ?, ?)`).run(id, id, `${id}@example.com`, `key_${id}`, now);
  }
  return { db, service: new WalletAuthService({ db, now: () => now }) };
}

function signer() {
  const pair = crypto.generateKeyPairSync('ed25519');
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const walletAddress = encodeBase58(Buffer.from(jwk.x, 'base64url'));
  return {
    walletAddress,
    sign(message) {
      return crypto.sign(null, Buffer.from(message), pair.privateKey).toString('base64');
    }
  };
}

test('wallet linking creates a cryptographically random, agent-bound challenge and verifies a valid signature once', () => {
  const { service } = setup();
  const wallet = signer();
  const challenge = service.createChallenge('agent_a', wallet.walletAddress);
  assert.match(challenge.message, /Agent: agent_a/);
  assert.match(challenge.message, new RegExp(`Wallet: ${wallet.walletAddress}`));
  assert.equal(challenge.expires_at - Date.now() <= 5 * 60 * 1000, true);
  const linked = service.verifyChallenge({
    agentId: 'agent_a', challengeId: challenge.challenge_id, walletAddress: wallet.walletAddress,
    message: challenge.message, signature: wallet.sign(challenge.message), signatureEncoding: 'base64'
  });
  assert.equal(linked.wallet_address, wallet.walletAddress);
  assert.throws(() => service.verifyChallenge({
    agentId: 'agent_a', challengeId: challenge.challenge_id, walletAddress: wallet.walletAddress,
    signature: wallet.sign(challenge.message), signatureEncoding: 'base64'
  }), /already been used/);
});

test('wallet linking rejects wrong wallet, modified message, expired challenge, and duplicate wallet ownership', () => {
  let now = Date.now();
  const { service } = setup(now);
  const wallet = signer();
  const other = signer();

  let challenge = service.createChallenge('agent_a', wallet.walletAddress);
  assert.throws(() => service.verifyChallenge({
    agentId: 'agent_a', challengeId: challenge.challenge_id, walletAddress: other.walletAddress,
    signature: other.sign(challenge.message), signatureEncoding: 'base64'
  }), /does not match/);
  assert.throws(() => service.verifyChallenge({
    agentId: 'agent_a', challengeId: challenge.challenge_id, walletAddress: wallet.walletAddress,
    message: challenge.message + 'tampered', signature: wallet.sign(challenge.message), signatureEncoding: 'base64'
  }), /modified/);

  challenge = service.createChallenge('agent_a', wallet.walletAddress);
  now += 5 * 60 * 1000 + 1;
  service.now = () => now;
  assert.throws(() => service.verifyChallenge({
    agentId: 'agent_a', challengeId: challenge.challenge_id, walletAddress: wallet.walletAddress,
    signature: wallet.sign(challenge.message), signatureEncoding: 'base64'
  }), /expired/);

  service.now = () => Date.now();
  challenge = service.createChallenge('agent_a', wallet.walletAddress);
  service.verifyChallenge({ agentId: 'agent_a', challengeId: challenge.challenge_id, walletAddress: wallet.walletAddress, signature: wallet.sign(challenge.message), signatureEncoding: 'base64' });
  const challengeB = service.createChallenge('agent_b', wallet.walletAddress);
  assert.throws(() => service.verifyChallenge({ agentId: 'agent_b', challengeId: challengeB.challenge_id, walletAddress: wallet.walletAddress, signature: wallet.sign(challengeB.message), signatureEncoding: 'base64' }), /already linked/);
});

