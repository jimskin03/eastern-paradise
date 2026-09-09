import test from 'node:test';
import assert from 'node:assert/strict';

import { loadSolanaConfig, getPublicChainConfig, classifyRpcCluster } from '../src/blockchain/config.js';
import { MAINNET_USDC_MINT, DEVNET_USDC_MINT } from '../src/blockchain/treasury.js';
import { buildOpenApiSpec, buildManifest, buildInstructionsMarkdown, ENDPOINT_CATALOG } from '../src/protocol.js';
import { WorldEngine } from '../src/world.js';
import { buildCollectionMetadata } from '../src/land/grid-metadata.js';

const DEVNET_RPC = 'https://api.devnet.solana.com';
const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const VALID_ADDR = '6DNvBTAChA44htMaUd4zZoo1YF2dqY1ECf5ThJ2KnAHa';
const JSON_ISSUER = '[' + Array(64).fill('1').join(',') + ']';
const SECRETISH = 'super-secret-rpc-token-abcdef';

function base(env = {}) {
  return { SOLANA_NFT_PROVIDER: 'mock', ...env };
}

function secretHits(value, needles) {
  const blob = JSON.stringify(value);
  return needles.filter((n) => n && blob.includes(n));
}

test('GET catalog includes sanitized /api/chain/config', () => {
  const entry = ENDPOINT_CATALOG.find((ep) => ep.path === '/api/chain/config');
  assert.ok(entry);
  assert.equal(entry.method, 'get');
  assert.equal(entry.auth, false);
  assert.ok(entry.response_schema.properties.live_cluster_proven);
  assert.ok(entry.response_schema.properties.family);
  assert.equal(
    ENDPOINT_CATALOG.some((ep) => ep.path === '/api/economy/transactions' && ep.summary?.includes('Paginated')),
    false
  );

  const openapi = buildOpenApiSpec('https://simulation.cryptgregresearch.org');
  assert.ok(openapi.paths['/api/chain/config'].get);

  const world = new WorldEngine();
  const publicChain = getPublicChainConfig(loadSolanaConfig(base({ SOLANA_NETWORK: 'devnet' })));
  const manifest = buildManifest(world, [], { chain: publicChain });
  assert.ok(manifest.endpoints.chain_config);
  assert.equal(manifest.chain.network, 'devnet');
  assert.equal(manifest.chain.family, 'solana');
  assert.equal(manifest.chain.chain_label, 'Solana devnet');
  assert.equal(manifest.chain.endpoint, '/api/chain/config');
  assert.equal(manifest.chain.live_cluster_proven, false);
  assert.equal(manifest.chain.production_target, 'mainnet-beta');

  const markdown = buildInstructionsMarkdown('simulation.cryptgregresearch.org');
  assert.match(markdown, /GET \/api\/chain\/config/);
});

test('public chain config is fail-closed devnet by default and never leaks secrets', () => {
  const cfg = loadSolanaConfig(base({
    SOLANA_NETWORK: 'devnet',
    SOLANA_RPC_URL: `https://example.invalid/rpc?api-key=${SECRETISH}`,
    SOLANA_NFT_ISSUER_SECRET: JSON_ISSUER,
    SOLANA_TREASURY_ADDRESS: VALID_ADDR,
    SOLANA_LAND_COLLECTION_ADDRESS: VALID_ADDR
  }));
  const pub = getPublicChainConfig(cfg);
  assert.equal(pub.network, 'devnet');
  assert.equal(pub.family, 'solana');
  assert.equal(pub.chain, 'solana');
  assert.equal(pub.chain_label, 'Solana devnet');
  assert.equal(pub.production_target, 'mainnet-beta');
  assert.equal(pub.live_cluster_proven, false);
  assert.equal(pub.mainnet_opt_in, false);
  assert.equal(pub.treasury_address, VALID_ADDR);
  assert.equal(pub.public_mint, DEVNET_USDC_MINT);
  assert.equal(pub.usdc_mint, DEVNET_USDC_MINT);
  assert.equal(pub.collection_address, VALID_ADDR);
  assert.equal(typeof pub.purchase_enabled, 'boolean');
  assert.equal(typeof pub.policy_version, 'string');
  assert.match(pub.risk_disclaimer, /does not offer redemption/i);
  assert.equal(pub.rpc_cluster, 'custom');
  assert.equal(pub.consistency.network_rpc_aligned, true);
  assert.deepEqual(
    secretHits(pub, [SECRETISH, JSON_ISSUER, cfg.rpcUrl, cfg.issuerSecret, 'SOLANA_NFT_ISSUER_SECRET']),
    []
  );
  assert.equal('rpcUrl' in pub, false);
  assert.equal('issuerSecret' in pub, false);
  assert.equal('solPriceOracleUrl' in pub, false);
});

test('mainnet alias canonicalizes to mainnet-beta and only after explicit opt-in', () => {
  assert.throws(() => loadSolanaConfig(base({ SOLANA_NETWORK: 'mainnet-beta' })), /must be devnet/);
  const cfg = loadSolanaConfig(base({
    SOLANA_NETWORK: 'mainnet',
    SOLANA_ALLOW_MAINNET: 'true',
    SOLANA_RPC_URL: MAINNET_RPC,
    SOLANA_TREASURY_ADDRESS: VALID_ADDR
  }));
  assert.equal(cfg.network, 'mainnet-beta');
  assert.equal(cfg.chainLabel, 'Solana mainnet-beta');
  const pub = getPublicChainConfig(cfg);
  assert.equal(pub.network, 'mainnet-beta');
  assert.equal(pub.chain_label, 'Solana mainnet-beta');
  assert.equal(pub.usdc_mint, MAINNET_USDC_MINT);
  assert.equal(pub.rpc_cluster, 'mainnet-beta');
  assert.equal(pub.mainnet_opt_in, true);
  assert.equal(pub.live_cluster_proven, false);
  assert.notEqual(pub.chain_label.toLowerCase().includes('devnet'), true);
});

test('devnet public labels never claim mainnet-beta', () => {
  const pub = getPublicChainConfig(loadSolanaConfig(base({ SOLANA_NETWORK: 'devnet', SOLANA_RPC_URL: DEVNET_RPC })));
  assert.equal(pub.network, 'devnet');
  assert.equal(pub.chain_label, 'Solana devnet');
  assert.equal(pub.rpc_cluster, 'devnet');
  assert.equal(pub.network.includes('mainnet'), false);
  assert.equal(pub.chain_label.toLowerCase().includes('mainnet'), false);
});

test('RPC cluster classifier never returns the raw URL', () => {
  assert.equal(classifyRpcCluster('https://api.devnet.solana.com'), 'devnet');
  assert.equal(classifyRpcCluster('https://api.mainnet-beta.solana.com'), 'mainnet-beta');
  assert.equal(classifyRpcCluster(`https://rpc.example.com/?key=${SECRETISH}`), 'custom');
  assert.equal(classifyRpcCluster('not a url'), 'unknown');
});

test('collection metadata description follows canonical chain label', () => {
  const dev = buildCollectionMetadata({ chainLabel: 'Solana devnet', metadataBaseUrl: 'https://example.test' });
  assert.match(dev.description, /Solana devnet/);
  assert.equal(dev.description.toLowerCase().includes('mainnet'), false);
  const main = buildCollectionMetadata({ chainLabel: 'Solana mainnet-beta', metadataBaseUrl: 'https://example.test' });
  assert.match(main.description, /Solana mainnet-beta/);
  assert.equal(main.description.toLowerCase().includes('devnet'), false);
});

test('contradictory network labels and RPC clusters fail closed', () => {
  const cfg = loadSolanaConfig(base({ SOLANA_NETWORK: 'devnet', SOLANA_RPC_URL: DEVNET_RPC }));
  assert.throws(
    () => getPublicChainConfig({ ...cfg, chainLabel: 'Solana mainnet-beta' }),
    /contradict/
  );
  assert.throws(
    () => getPublicChainConfig({ ...cfg, network: 'mainnet-beta', chainLabel: 'Solana mainnet-beta' }),
    /contradict/
  );
});
