import { JsonRpcProvider, getAddress, formatUnits } from 'ethers';

export const BSC_CHAIN_IDS = Object.freeze({ testnet: 97, mainnet: 56 });
export const BSC_USDC = Object.freeze({
  testnet: '0x64544969ed7EBf5F083679233325356EbE738930',
  mainnet: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'
});
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'];

export function isEvmAddress(value) { return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value); }
export function checksumAddress(value) {
  if (!isEvmAddress(value)) throw new Error('A valid EVM wallet address is required.');
  const checksummed = getAddress(value);
  if (checksummed === '0x0000000000000000000000000000000000000000') throw new Error('Zero address is not allowed.');
  return checksummed;
}
export function rpcChainIdToNumber(value) { return Number(BigInt(value)); }

export class BscRpcClient {
  constructor({ rpcUrl, chainId, fetchImpl = globalThis.fetch } = {}) {
    this.rpcUrl = rpcUrl; this.chainId = Number(chainId); this.fetchImpl = fetchImpl; this.requestId = 0;
  }
  async request(method, params = []) {
    const response = await this.fetchImpl(this.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++this.requestId, method, params }) });
    if (!response.ok) throw new Error(`BSC RPC HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new Error(`BSC RPC ${payload.error.code}: ${payload.error.message}`);
    return payload.result;
  }
  async assertChain() {
    const actual = rpcChainIdToNumber(await this.request('eth_chainId'));
    if (actual !== this.chainId) throw new Error(`BSC RPC chainId mismatch: expected ${this.chainId}, received ${actual}.`);
    return actual;
  }
  async getNativeBalance(address) { return BigInt(await this.request('eth_getBalance', [address, 'latest'])); }
  async getTokenBalance(address, tokenAddress) {
    const data = `0x70a08231${address.slice(2).padStart(64, '0')}`;
    return BigInt(await this.request('eth_call', [{ to: tokenAddress, data }, 'latest']));
  }
  async getTokenDecimals(tokenAddress) {
    return Number(BigInt(await this.request('eth_call', [{ to: tokenAddress, data: '0x313ce567' }, 'latest'])));
  }
}

export function createProvider(config) { return new JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true }); }
export function formatTokenAmount(value, decimals = 18) { return formatUnits(value, decimals); }
