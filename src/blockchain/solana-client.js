const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_MAP = new Map([...ALPHABET].map((char, index) => [char, index]));

export function decodeBase58(value) {
  const input = String(value || '').trim();
  if (!input) throw new Error('Base58 value is required.');
  let number = 0n;
  for (const char of input) {
    const digit = BASE58_MAP.get(char);
    if (digit === undefined) throw new Error('Invalid base58 value.');
    number = number * 58n + BigInt(digit);
  }
  const bytes = [];
  while (number > 0n) {
    bytes.push(Number(number & 255n));
    number >>= 8n;
  }
  for (let i = 0; i < input.length && input[i] === '1'; i++) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

export function encodeBase58(value) {
  const bytes = Uint8Array.from(value || []);
  let number = 0n;
  for (const byte of bytes) number = (number << 8n) + BigInt(byte);
  let encoded = '';
  while (number > 0n) {
    encoded = ALPHABET[Number(number % 58n)] + encoded;
    number /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = '1' + encoded;
  }
  return encoded || '1';
}

export function isSolanaAddress(value) {
  try {
    return decodeBase58(value).length === 32;
  } catch {
    return false;
  }
}

export class SolanaRpcClient {
  constructor({ rpcUrl, fetchImpl = globalThis.fetch }) {
    this.rpcUrl = rpcUrl;
    this.fetchImpl = fetchImpl;
    this.requestId = 0;
  }

  async request(method, params = []) {
    const response = await this.fetchImpl(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.requestId, method, params })
    });
    if (!response.ok) throw new Error(`Solana RPC HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new Error(`Solana RPC ${payload.error.code}: ${payload.error.message}`);
    return payload.result;
  }

  async getSolBalance(address) {
    const result = await this.request('getBalance', [address, { commitment: 'confirmed' }]);
    return Number(result?.value || 0) / 1_000_000_000;
  }

  async getTokenBalance(address, mintAddress) {
    const result = await this.request('getTokenAccountsByOwner', [
      address,
      { mint: mintAddress },
      { encoding: 'jsonParsed', commitment: 'confirmed' }
    ]);
    return (result?.value || []).reduce((sum, account) => {
      const amount = account?.account?.data?.parsed?.info?.tokenAmount?.uiAmountString || '0';
      return sum + Number(amount);
    }, 0);
  }

  async getSignatureStatus(signature) {
    const result = await this.request('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);
    const status = result?.value?.[0] || null;
    if (!status) return { state: 'unknown', error: null };
    if (status.err) return { state: 'failed', error: JSON.stringify(status.err) };
    if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
      return { state: 'confirmed', error: null };
    }
    return { state: 'pending', error: null };
  }
}
