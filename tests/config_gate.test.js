import test from 'node:test';
import assert from 'node:assert/strict';

import { loadSolanaConfig } from '../src/blockchain/config.js';
import { TreasuryService, DEVNET_USDC_MINT, MAINNET_USDC_MINT } from '../src/blockchain/treasury.js';

const DEVNET_RPC = 'https://api.devnet.solana.com';
const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const VALID_ADDR = '6DNvBTAChA44htMaUd4zZoo1YF2dqY1ECf5ThJ2KnAHa';
const JSON_ISSUER = '[' + Array(64).fill('1').join(',') + ']'; // 64-byte JSON array

function base(env = {}) {
  return { SOLANA_NFT_PROVIDER: 'mock', ...env };
}

test('devnet is allowed by default (repo default stays devnet-only)', () => {
  const c = loadSolanaConfig(base({ SOLANA_NETWORK: 'devnet' }));
  assert.equal(c.network, 'devnet');
});

test('mainnet is DENIED without explicit opt-in (default-denied)', () => {
  for (const net of ['mainnet', 'mainnet-beta']) {
    assert.throws(() => loadSolanaConfig(base({ SOLANA_NETWORK: net })), /must be devnet/);
  }
});

test('mainnet-beta allowed ONLY with SOLANA_ALLOW_MAINNET=true AND a mainnet RPC', () => {
  const c = loadSolanaConfig(base({ SOLANA_NETWORK: 'mainnet-beta', SOLANA_ALLOW_MAINNET: 'true', SOLANA_RPC_URL: MAINNET_RPC }));
  assert.equal(c.network, 'mainnet-beta');
  assert.equal(c.chainLabel, 'Solana mainnet-beta');
});

test('mainnet alias is accepted with opt-in and canonicalized to mainnet-beta', () => {
  const c = loadSolanaConfig(base({ SOLANA_NETWORK: 'mainnet', SOLANA_ALLOW_MAINNET: 'true', SOLANA_RPC_URL: MAINNET_RPC }));
  assert.equal(c.network, 'mainnet-beta');
  assert.equal(c.chainLabel, 'Solana mainnet-beta');
});

test('mainnet + opt-in but DEVNET RPC rejected (foot-gun guard)', () => {
  assert.throws(
    () => loadSolanaConfig(base({ SOLANA_NETWORK: 'mainnet-beta', SOLANA_ALLOW_MAINNET: 'true', SOLANA_RPC_URL: DEVNET_RPC })),
    /devnet RPC/
  );
});

test('devnet but MAINNET RPC rejected (foot-gun guard)', () => {
  assert.throws(
    () => loadSolanaConfig(base({ SOLANA_NETWORK: 'devnet', SOLANA_RPC_URL: MAINNET_RPC })),
    /mainnet RPC/
  );
});

test('production + mock provider => purchaseEnabled false (unchanged)', () => {
  const c = loadSolanaConfig(base({ SOLANA_NETWORK: 'devnet', NODE_ENV: 'production' }));
  assert.equal(c.purchaseEnabled, false);
});

test('production + solana provider (issuer+collection) => purchaseEnabled true', () => {
  const c = loadSolanaConfig(base({
    SOLANA_NETWORK: 'devnet', NODE_ENV: 'production', SOLANA_NFT_PROVIDER: 'solana',
    SOLANA_NFT_ISSUER_SECRET: JSON_ISSUER,
    SOLANA_LAND_COLLECTION_ADDRESS: VALID_ADDR
  }));
  assert.equal(c.purchaseEnabled, true);
});

test('Treasury usdcMint is network-aware', () => {
  const mk = (network, extra = {}) => new TreasuryService({ config: { network, ...extra } });
  assert.equal(mk('devnet').usdcMint(), DEVNET_USDC_MINT);
  assert.equal(mk('mainnet-beta').usdcMint(), MAINNET_USDC_MINT);
  assert.equal(mk('mainnet').usdcMint(), MAINNET_USDC_MINT);
  assert.equal(mk('devnet', { usdcMint: 'CUSTOM' }).usdcMint(), 'CUSTOM');
});

test('issuer secret accepts a 64-byte JSON array', () => {
  const c = loadSolanaConfig(base({ SOLANA_NFT_ISSUER_SECRET: JSON_ISSUER }));
  assert.equal(c.issuerSecret, JSON_ISSUER);
});

test('usdcMint env passthrough is surfaced on the config', () => {
  const c = loadSolanaConfig(base({ SOLANA_USDC_MINT: 'OVERRIDE_MINT' }));
  assert.equal(c.usdcMint, 'OVERRIDE_MINT');
});
