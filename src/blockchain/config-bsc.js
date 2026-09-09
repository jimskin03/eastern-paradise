import { BSC_CHAIN_IDS, BSC_USDC, isEvmAddress } from './bsc-client.js';

const RPC_DEFAULTS = {
  testnet: 'https://bsc-testnet-dataseed.bnbchain.org',
  mainnet: 'https://bsc-dataseed.bnbchain.org'
};
function configured(v) { return typeof v === 'string' && v.trim() !== ''; }

export function loadBscConfig(env = process.env) {
  const network = String(env.BSC_NETWORK || 'testnet').trim().toLowerCase();
  if (!(network in BSC_CHAIN_IDS)) throw new Error('BSC_NETWORK must be testnet or mainnet.');
  if (network === 'mainnet' && String(env.BSC_ALLOW_MAINNET || '').toLowerCase() !== 'true') {
    throw new Error('BSC mainnet is disabled by default. Set BSC_ALLOW_MAINNET=true for explicit opt-in.');
  }
  const chainId = BSC_CHAIN_IDS[network];
  const rpcUrl = String(env.BSC_RPC_URL || RPC_DEFAULTS[network]).trim();
  let url;
  try { url = new URL(rpcUrl); } catch { throw new Error('BSC_RPC_URL must be a valid http(s) URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('BSC_RPC_URL must use http or https.');
  const treasuryAddress = String(env.BSC_TREASURY_ADDRESS || '').trim();
  const collectionAddress = String(env.BSC_LAND_COLLECTION_ADDRESS || '').trim();
  const issuerPrivateKey = String(env.BSC_NFT_ISSUER_PRIVATE_KEY || '').trim();
  const nftMode = String(env.BSC_NFT_PROVIDER || 'mock').trim().toLowerCase();
  if (!['mock', 'evm'].includes(nftMode)) throw new Error('BSC_NFT_PROVIDER must be mock or evm.');
  if (configured(treasuryAddress) && !isEvmAddress(treasuryAddress)) throw new Error('BSC_TREASURY_ADDRESS must be a valid EVM address.');
  if (configured(collectionAddress) && !isEvmAddress(collectionAddress)) throw new Error('BSC_LAND_COLLECTION_ADDRESS must be a valid EVM address.');
  if (nftMode === 'evm' && (!/^0x[0-9a-fA-F]{64}$/.test(issuerPrivateKey) || !configured(collectionAddress))) {
    throw new Error('BSC_NFT_PROVIDER=evm requires BSC_NFT_ISSUER_PRIVATE_KEY and BSC_LAND_COLLECTION_ADDRESS.');
  }
  return Object.freeze({
    network, chainId, rpcUrl, usdcAddress: BSC_USDC[network], treasuryAddress: treasuryAddress || null,
    collectionAddress: collectionAddress || null, issuerPrivateKey, nftMode,
    tokenDecimals: 18, metadataBaseUrl: String(env.PUBLIC_BASE_URL || 'https://simulation.cryptgregresearch.org').replace(/\/$/, ''),
    treasuryConfigured: configured(treasuryAddress), mintingConfigured: nftMode === 'evm',
    purchaseEnabled: nftMode === 'evm' || env.NODE_ENV !== 'production' || String(env.BSC_ALLOW_MOCK_LAND_PURCHASES || '').toLowerCase() === 'true'
  });
}
export const bscConfig = loadBscConfig();
