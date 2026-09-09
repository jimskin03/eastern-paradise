const DEFAULT_PRICE_URL = 'https://api.coinbase.com/v2/prices/SOL-USD/spot';

export class SolPriceOracle {
  constructor({
    url = DEFAULT_PRICE_URL,
    fetchImpl = globalThis.fetch,
    timeoutMs = 5000,
    cacheTtlMs = 60_000,
    now = () => Date.now()
  } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
    this.url = url;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.cacheTtlMs = cacheTtlMs;
    this.now = now;
    this.cached = null;
  }

  async getPrice({ force = false } = {}) {
    if (!force && this.cached && this.now() - this.cached.fetchedAt < this.cacheTtlMs) {
      return { price: this.cached.price, stale: false };
    }

    try {
      const endpoint = new URL(this.url);
      if (endpoint.hostname.endsWith('coingecko.com')) {
        endpoint.searchParams.set('ids', 'solana');
        endpoint.searchParams.set('vs_currencies', 'usd');
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let response;
      try {
        response = await this.fetchImpl(endpoint.toString(), { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new Error(`SOL price feed HTTP ${response.status}`);
      const payload = await response.json();
      const price = Number(payload?.data?.amount ?? payload?.solana?.usd ?? payload?.price);
      if (!Number.isFinite(price) || price <= 0) throw new Error('SOL price feed returned an invalid price.');
      this.cached = { price, fetchedAt: this.now() };
      return { price, stale: false };
    } catch {
      return { price: this.cached?.price || 0, stale: true };
    }
  }
}

export { DEFAULT_PRICE_URL };
