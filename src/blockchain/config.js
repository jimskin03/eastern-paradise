import { decodeBase58, isSolanaAddress } from './solana-client.js';
import { DEFAULT_PRICE_URL } from './sol-price-oracle.js';
import { DEVNET_USDC_MINT, MAINNET_USDC_MINT } from './mints.js';

const DEFAULT_DEVNET_RPC = 'https://api.devnet.solana.com';
export const DEFAULT_CHAIN_POLICY_VERSION = 'ep-chain-policy-v1';
export const CHAIN_RISK_DISCLAIMER = 'Eastern Paradise $MERIT is an in-simulation score. This configuration does not offer redemption, withdrawal, backing, guaranteed value, or profit. Chain labels describe the configured Solana cluster only.';

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
  const chainLabel = network === 'devnet' ? 'Solana devnet' : 'Solana mainnet-beta';

  return Object.freeze({
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
}

export function getPublicChainConfig(config) {
  const usdcMint = config.usdcMint || (config.network === 'devnet' ? DEVNET_USDC_MINT : MAINNET_USDC_MINT);
  return Object.freeze({
    network: config.network,
    chain: 'solana',
    chain_label: config.chainLabel || (config.network === 'devnet' ? 'Solana devnet' : 'Solana mainnet-beta'),
    treasury_address: config.treasuryConfigured ? (config.treasuryAddress || null) : null,
    usdc_mint: usdcMint || null,
    collection_address: config.collectionAddress || null,
    purchase_enabled: Boolean(config.purchaseEnabled),
    nft_provider: config.nftMode,
    policy_version: config.policyVersion || DEFAULT_CHAIN_POLICY_VERSION,
    rpc_cluster: classifyRpcCluster(config.rpcUrl),
    risk_disclaimer: CHAIN_RISK_DISCLAIMER,
    endpoint: '/api/chain/config'
  });
}

export const solanaConfig = loadSolanaConfig();
