import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { createLocalSchema } from '../src/infrastructure/database/schema.js';
import { WalletAuthService } from '../src/blockchain/wallet-auth.js';
import { encodeBase58 } from '../src/blockchain/solana-client.js';
import { loadSolanaConfig } from '../src/blockchain/config.js';
import { bytesToBase64, formatWalletError } from '../src/frontend/wallet/metamask-solana.js';

function setup(now = Date.now()) {
  const db = new DatabaseSync(':memory:');
  createLocalSchema(db);
  db.prepare(`INSERT INTO accounts (id, name, email, verified, api_key, created_at) VALUES ('agent_test', 'Tester', 'test@example.com', 1, 'key_test', ?)`).run(now);
  return { db, service: new WalletAuthService({ db, now: () => now }) };
}

function testKeypair() {
  const pair = crypto.generateKeyPairSync('ed25519');
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const walletAddress = encodeBase58(Buffer.from(jwk.x, 'base64url'));
  return {
    walletAddress,
    signBytes(bytes) {
      return crypto.sign(null, Buffer.from(bytes), pair.privateKey);
    }
  };
}

test('exact challenge bytes are signed and verified with base64 serialization', () => {
  const { db, service } = setup();
  const kp = testKeypair();

  const challenge = service.createChallenge('agent_test', kp.walletAddress);

  // Exact UTF-8 bytes encoding
  const exactBytes = new TextEncoder().encode(challenge.message);
  const rawSignature = kp.signBytes(exactBytes);

  // Verify signature is 64 bytes Ed25519
  assert.equal(rawSignature.length, 64, 'Ed25519 signature must be exactly 64 bytes');

  // Serialized as base64
  const base64Sig = bytesToBase64(rawSignature);
  assert.equal(Buffer.from(base64Sig, 'base64').length, 64);

  // Verification succeeds with base64 signature and exact message
  const result = service.verifyChallenge({
    agentId: 'agent_test',
    challengeId: challenge.challenge_id,
    walletAddress: kp.walletAddress,
    message: challenge.message,
    signature: base64Sig,
    signatureEncoding: 'base64'
  });

  assert.equal(result.wallet_address, kp.walletAddress);
  const link = db.prepare('SELECT agent_id FROM wallet_links WHERE wallet_address = ?').get(kp.walletAddress);
  assert.equal(link.agent_id, 'agent_test');
});

test('modified challenge text is rejected even if signed by the wallet', () => {
  const { service } = setup();
  const kp = testKeypair();

  const challenge = service.createChallenge('agent_test', kp.walletAddress);

  // Sign modified challenge (e.g. prefixing or altering text)
  const modified = challenge.message + '\nAttacker-Prefix';
  const rawSignature = kp.signBytes(new TextEncoder().encode(modified));
  const base64Sig = bytesToBase64(rawSignature);

  assert.throws(() => {
    service.verifyChallenge({
      agentId: 'agent_test',
      challengeId: challenge.challenge_id,
      walletAddress: kp.walletAddress,
      message: modified,
      signature: base64Sig,
      signatureEncoding: 'base64'
    });
  }, /modified/);
});

test('rejected wallet connection (4001) is formatted and creates no link', () => {
  const { db, service } = setup();
  const kp = testKeypair();

  const challenge = service.createChallenge('agent_test', kp.walletAddress);

  // Simulate user rejection error (MetaMask 4001)
  const userRejectedError = new Error('MetaMask: User rejected the request.');
  userRejectedError.code = 4001;

  const formatted = formatWalletError(userRejectedError);
  assert.equal(formatted.code, 4001);
  assert.match(formatted.message, /rejected in MetaMask/);

  // Verify no link was created in the database
  const links = db.prepare('SELECT * FROM wallet_links WHERE agent_id = ?').all('agent_test');
  assert.equal(links.length, 0, 'No wallet link should exist on rejection');

  // Challenge remains unconsumed
  const ch = db.prepare('SELECT consumed_at FROM wallet_challenges WHERE id = ?').get(challenge.challenge_id);
  assert.equal(ch.consumed_at, null);
});

test('pending connect request (-32002) is formatted and blocks duplicate in-flight requests', () => {
  const pendingError = new Error('Request of type "connect" already pending for origin.');
  pendingError.code = -32002;

  const formatted = formatWalletError(pendingError);
  assert.equal(formatted.code, -32002);
  assert.match(formatted.message, /already pending/);
});

test('configuration: NODE_ENV=production + mock disables purchases', () => {
  const prodMockEnv = {
    NODE_ENV: 'production',
    SOLANA_NETWORK: 'devnet',
    SOLANA_NFT_PROVIDER: 'mock'
  };

  const config = loadSolanaConfig(prodMockEnv);
  assert.equal(config.nftMode, 'mock');
  assert.equal(config.purchaseEnabled, false, 'Production with mock provider must disable purchases');
});

test('configuration: NODE_ENV=production + solana + required config enables purchases', () => {
  const dummyIssuerKey = JSON.stringify(Array.from(crypto.randomBytes(64)));
  const dummyCollection = encodeBase58(crypto.randomBytes(32));

  const prodSolanaEnv = {
    NODE_ENV: 'production',
    SOLANA_NETWORK: 'devnet',
    SOLANA_NFT_PROVIDER: 'solana',
    SOLANA_NFT_ISSUER_SECRET: dummyIssuerKey,
    SOLANA_LAND_COLLECTION_ADDRESS: dummyCollection
  };

  const config = loadSolanaConfig(prodSolanaEnv);
  assert.equal(config.nftMode, 'solana');
  assert.equal(config.mintingConfigured, true);
  assert.equal(config.purchaseEnabled, true, 'Production with configured solana provider must enable purchases');
});
