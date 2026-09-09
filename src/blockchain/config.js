import { decodeBase58, isSolanaAddress } from './solana-client.js';
import { DEFAULT_PRICE_URL } from './sol-price-oracle.js';
import { DEVNET_USDC_MINT, MAINNET_USDC_MINT } from './mints.js';

const DEFAULT_DEVNET_RPC = 'https://api.devnet.solana.com';
export const DEFAULT_CHAIN_POLICY_VERSION = 'ep-chain-policy-v1';
export const CHAIN_FAMILY = 'solana';
export const PRODUCTION_TARGET_NETWORK = 'mainnet-beta';
export const CHAIN_RISK_DISCLAIMER = 'Eastern Paradise $MERIT is an in-simulation score. This configuration does not offer redemption, withdrawal, backing, guaranteed value, or profit. Labels describe this process configuration only and are not proof of a live production cluster or a network switch. production_target is plan intent; live_cluster_proven is always false.';

function configured(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function classifyRpcCluster(rpcUrl) {
  try {
    const host = new URL(rpcUrl).hostname.toLowerCase();
    if (host.includes('devnet')) return 'devnet';
    if (host.includes('mainnet-beta') || host.includes('mainnet')) return 'mainnet-beta';
    return 'custom';
  } catch {
    return 'unknown';
  }
}

function labelForNetwork(network) {
  return network === 'devnet' ? 'Solana devnet' : 'Solana mainnet-beta';
}

export function assertChainConfigConsistent(config) {
  const network = config.network;
  if (network !== 'devnet' && network !== 'mainnet-beta') {
    throw new Error('SOLANA_NETWORK must be canonicalized to devnet or mainnet-beta.');
  }
  const chainLabel = config.chainLabel || labelForNetwork(network);
  const label = String(chainLabel).toLowerCase();
  if (network === 'devnet' && label.includes('mainnet')) {
    throw new Error('Chain label contradicts network: devnet config cannot claim mainnet.');
  }
  if (network === 'mainnet-beta' && label.includes('devnet')) {
    throw new Error('Chain label contradicts network: mainnet-beta config cannot claim devnet.');
  }
  const rpcCluster = classifyRpcCluster(config.rpcUrl);
  if (rpcCluster === 'devnet' && network === 'mainnet-beta') {
    throw new Error('RPC cluster contradicts network: mainnet-beta cannot use a devnet RPC.');
  }
  if (rpcCluster === 'mainnet-beta' && network === 'devnet') {
    throw new Error('RPC cluster contradicts network: devnet cannot use a mainnet RPC.');
  }
}

export function assertPublicChainConfigConsistent(pub) {
  if (pub.live_cluster_proven !== false) {
    throw new Error('live_cluster_proven must remain false; this payload is not live cluster proof.');
  }
  if (pub.production_target !== PRODUCTION_TARGET_NETWORK) {
    throw new Error('production_target must be mainnet-beta.');
  }
  if (pub.family !== CHAIN_FAMILY || pub.chain !== CHAIN_FAMILY) {
    throw new Error('Public chain family must remain solana on origin/main.');
  }
  const network = pub.network;
  if (network !== 'devnet' && network !== 'mainnet-beta') {
    throw new Error('Public network must be devnet or mainnet-beta.');
  }
  const label = String(pub.chain_label || '').toLowerCase();
  if (network === 'devnet' && (String(network).includes('mainnet') || label.includes('mainnet'))) {
    throw new Error('Public labels contradict: devnet payload claims mainnet.');
  }
  if (network === 'mainnet-beta' && label.includes('devnet')) {
    throw new Error('Public labels contradict: mainnet-beta payload claims devnet.');
  }
  if (pub.rpc_cluster === 'devnet' && network === 'mainnet-beta') {
    throw new Error('Public rpc_cluster contradicts network.');
  }
  if (pub.rpc_cluster === 'mainnet-beta' && network === 'devnet') {
    throw new Error('Public rpc_cluster contradicts network.');
  }
  if (Boolean(pub.mainnet_opt_in) !== (network === 'mainnet-beta')) {
    throw new Error('mainnet_opt_in contradicts canonical network.');
  }
}

export function loadSolanaConfig(env = process.env) {
  let network = String(env.SOLANA_NETWORK || 'devnet').trim().toLowerCase();
  const allowMainnet = String(env.SOLANA_ALLOW_MAINNET || '').trim().toLowerCase() === 'true';
  const isMainnet = network === 'mainnet' || network === 'mainnet-beta';
  const networkAllowed = network === 'devnet' || (allowMainnet && isMainnet);
  if (!networkAllowed) {
    throw new Error('SOLANA_NETWORK must be devnet for this release. Mainnet is intentionally disabled; enabling it requires SOLANA_ALLOW_MAINNET=true to be set explicitly.');
  }
  if (isMainnet) network = 'mainnet-beta';

  const rpcUrl = String(env.SOLANA_RPC_URL || DEFAULT_DEVNET_RPC).trim();
  let parsedRpc;
  try {
    parsedRpc = new URL(rpcUrl);
  } catch {
    throw new Error('SOLANA_RPC_URL must be a valid http(s) URL.');
  }
  if (!['http:', 'https:'].includes(parsedRpc.protocol)) {
    throw new Error('SOLANA_RPC_URL must use http or https.');
  }
  // Foot-gun guard: never let a mainnet config read a devnet RPC (and vice-versa).
  const rpcHost = parsedRpc.hostname;
  if (isMainnet && /devnet/i.test(rpcHost)) {
    throw new Error('SOLANA_RPC_URL points at a devnet RPC but SOLANA_NETWORK is mainnet-beta. Point SOLANA_RPC_URL at a mainnet RPC (e.g. https://api.mainnet-beta.solana.com).');
  }
  if (!isMainnet && rpcHost.includes('mainnet-beta')) {
    throw new Error('SOLANA_RPC_URL points at a mainnet RPC but SOLANA_NETWORK is devnet. Use a devnet RPC (e.g. https://api.devnet.solana.com).');
  }

  const issuerSecret = String(env.SOLANA_NFT_ISSUER_SECRET || '').trim();
  const treasuryAddress = String(env.SOLANA_TREASURY_ADDRESS || '').trim();
  const collectionAddress = String(env.SOLANA_LAND_COLLECTION_ADDRESS || '').trim();
  const nftMode = String(env.SOLANA_NFT_PROVIDER || 'mock').trim().toLowerCase();
  if (!['mock', 'solana'].includes(nftMode)) {
    throw new Error('SOLANA_NFT_PROVIDER must be either mock or solana.');
  }
  if (nftMode === 'solana' && (!configured(issuerSecret) || !configured(collectionAddress))) {
    throw new Error('SOLANA_NFT_PROVIDER=solana requires SOLANA_NFT_ISSUER_SECRET and SOLANA_LAND_COLLECTION_ADDRESS.');
  }
  if (configured(treasuryAddress) && !isSolanaAddress(treasuryAddress)) throw new Error('SOLANA_TREASURY_ADDRESS must be a valid Solana public key.');
  if (configured(collectionAddress) && !isSolanaAddress(collectionAddress)) throw new Error('SOLANA_LAND_COLLECTION_ADDRESS must be a valid Solana public key.');
  if (configured(issuerSecret)) {
    try {
      const bytes = issuerSecret.startsWith('[') ? Uint8Array.from(JSON.parse(issuerSecret)) : decodeBase58(issuerSecret);
      if (bytes.length !== 64) throw new Error('bad length');
    } catch {
      throw new Error('SOLANA_NFT_ISSUER_SECRET must be a 64-byte JSON or base58 secret key.');
    }
  }

  const configuredSolUsd = Number(env.SOLANA_SOL_USD_PRICE || 0);
  if (!Number.isFinite(configuredSolUsd) || configuredSolUsd < 0) {
    throw new Error('SOLANA_SOL_USD_PRICE must be a non-negative number when provided.');
  }

  const solPriceOracleUrl = String(env.SOLANA_SOL_PRICE_URL || DEFAULT_PRICE_URL).trim();
  let parsedPriceUrl;
  try {
    parsedPriceUrl = new URL(solPriceOracleUrl);
  } catch {
    throw new Error('SOLANA_SOL_PRICE_URL must be a valid http(s) URL.');
  }
  if (!['http:', 'https:'].includes(parsedPriceUrl.protocol)) {
    throw new Error('SOLANA_SOL_PRICE_URL must use http or https.');
  }

  const policyVersion = String(env.CHAIN_POLICY_VERSION || DEFAULT_CHAIN_POLICY_VERSION).trim() || DEFAULT_CHAIN_POLICY_VERSION;
  const chainLabel = labelForNetwork(network);
  const loaded = Object.freeze({
    network,
    chainLabel,
    policyVersion,
    rpcUrl,
    issuerSecret,
    treasuryAddress,
    collectionAddress,
    nftMode,
    solUsdPrice: configuredSolUsd,
    solPriceOracleUrl,
    usdcMint: String(env.SOLANA_USDC_MINT || '').trim(),
    metadataBaseUrl: String(env.PUBLIC_BASE_URL || 'https://simulation.cryptgregresearch.org').replace(/\/$/, ''),
    treasuryConfigured: configured(treasuryAddress),
    mintingConfigured: nftMode === 'solana',
    purchaseEnabled: nftMode === 'solana' || env.NODE_ENV !== 'production' || String(env.SOLANA_ALLOW_MOCK_LAND_PURCHASES || '').toLowerCase() === 'true'
  });
  assertChainConfigConsistent(loaded);
  return loaded;
}

export function getPublicChainConfig(config) {
  assertChainConfigConsistent(config);
  const usdcMint = config.usdcMint || (config.network === 'devnet' ? DEVNET_USDC_MINT : MAINNET_USDC_MINT);
  const network = config.network;
  const isMainnet = network === 'mainnet-beta';
  const rpcCluster = classifyRpcCluster(config.rpcUrl);
  const rpcAligned = rpcCluster === 'custom' || rpcCluster === 'unknown' || rpcCluster === network;
  const pub = Object.freeze({
    family: CHAIN_FAMILY,
    network,
    chain: CHAIN_FAMILY,
    chain_label: config.chainLabel || labelForNetwork(network),
    production_target: PRODUCTION_TARGET_NETWORK,
    treasury_address: config.treasuryConfigured ? (config.treasuryAddress || null) : null,
    public_mint: usdcMint || null,
    usdc_mint: usdcMint || null,
    collection_address: config.collectionAddress || null,
    purchase_enabled: Boolean(config.purchaseEnabled),
    nft_provider: config.nftMode,
    policy_version: config.policyVersion || DEFAULT_CHAIN_POLICY_VERSION,
    rpc_cluster: rpcCluster,
    mainnet_opt_in: isMainnet,
    live_cluster_proven: false,
    consistency: Object.freeze({
      network_rpc_aligned: rpcAligned,
      treasury_configured: Boolean(config.treasuryConfigured),
      collection_configured: Boolean(config.collectionAddress),
      labels_match_network: String(config.chainLabel || labelForNetwork(network)).toLowerCase().includes(network)
    }),
    risk_disclaimer: CHAIN_RISK_DISCLAIMER,
    endpoint: '/api/chain/config'
  });
  assertPublicChainConfigConsistent(pub);
  return pub;
}

export const solanaConfig = loadSolanaConfig();
