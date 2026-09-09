import { decodeBase58, isSolanaAddress } from './solana-client.js';

const DEFAULT_DEVNET_RPC = 'https://api.devnet.solana.com';

function configured(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function loadSolanaConfig(env = process.env) {
  const network = String(env.SOLANA_NETWORK || 'devnet').trim().toLowerCase();
  if (network !== 'devnet') {
    throw new Error('SOLANA_NETWORK must be devnet for this release. Mainnet is intentionally disabled.');
  }

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

  return Object.freeze({
    network,
    rpcUrl,
    issuerSecret,
    treasuryAddress,
    collectionAddress,
    nftMode,
    solUsdPrice: configuredSolUsd,
    metadataBaseUrl: String(env.PUBLIC_BASE_URL || 'https://simulation.cryptgregresearch.org').replace(/\/$/, ''),
    treasuryConfigured: configured(treasuryAddress),
    mintingConfigured: nftMode === 'solana',
    purchaseEnabled: nftMode === 'solana' || env.NODE_ENV !== 'production' || String(env.SOLANA_ALLOW_MOCK_LAND_PURCHASES || '').toLowerCase() === 'true'
  });
}

export const solanaConfig = loadSolanaConfig();
