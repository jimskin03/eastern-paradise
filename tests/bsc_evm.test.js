import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { loadBscConfig } from '../src/blockchain/config-bsc.js';
import { WalletAuthService, buildWalletChallengeMessage } from '../src/blockchain/wallet-auth-bsc.js';
import { createLocalSchema } from '../src/infrastructure/database/schema.js';
import { DatabaseSync } from 'node:sqlite';

test('BSC config defaults safely to testnet and gates mainnet opt-in', () => {
  const cfg = loadBscConfig({}); assert.equal(cfg.network, 'testnet'); assert.equal(cfg.chainId, 97); assert.equal(cfg.tokenDecimals, 18);
  assert.throws(() => loadBscConfig({ BSC_NETWORK: 'mainnet' }), /explicit opt-in/);
  assert.equal(loadBscConfig({ BSC_NETWORK: 'mainnet', BSC_ALLOW_MAINNET: 'true' }).chainId, 56);
});

test('EVM personal_sign challenge verifies once and rejects chain mismatch/tampering', async () => {
  const db = new DatabaseSync(':memory:'); createLocalSchema(db); const now = Date.now();
  db.prepare("INSERT INTO accounts (id,name,email,verified,is_guest,api_key,created_at) VALUES ('a','A','a@example.com',1,0,'k',?)").run(now);
  const config = loadBscConfig({}); const service = new WalletAuthService({ db, config, now: () => now }); const wallet = Wallet.createRandom();
  const challenge = service.createChallenge('a', wallet.address);
  assert.equal(challenge.chain_id, 97);
  const signature = await wallet.signMessage(challenge.message);
  const linked = service.verifyChallenge({ agentId:'a', challengeId:challenge.challenge_id, walletAddress:wallet.address, signature, message:challenge.message, chainId:97 });
  assert.equal(linked.chain, 'bsc'); assert.equal(service.listWallets('a')[0].wallet_address, wallet.address);
  assert.throws(() => service.verifyChallenge({ agentId:'a', challengeId:challenge.challenge_id, walletAddress:wallet.address, signature, message:challenge.message, chainId:56 }), /already been used/);
  const other = service.createChallenge('a', wallet.address); assert.throws(() => service.verifyChallenge({ agentId:'a', challengeId:other.challenge_id, walletAddress:wallet.address, signature, message:other.message, chainId:56 }), /Chain ID mismatch/);
});

test('challenge message includes the selected chain and cannot be rebuilt for another chain', () => {
  const message=buildWalletChallengeMessage({agentId:'a',walletAddress:'0x0000000000000000000000000000000000000001',nonce:'n',expiresAt:1,chainId:97}); assert.match(message,/Chain ID: 97/); assert.doesNotMatch(message,/Chain ID: 56/);
});
