import { SolanaRpcClient } from './solana-client.js';
import { SolPriceOracle } from './sol-price-oracle.js';

export const DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
export const MAINNET_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export class TreasuryService {
  constructor({ config, rpcClient, priceOracle, supplyProvider, cacheTtlMs = 60_000, now = () => Date.now() }) {
    this.config = config;
    this.rpcClient = rpcClient || new SolanaRpcClient({ rpcUrl: config.rpcUrl });
    this.priceOracle = priceOracle || new SolPriceOracle({ url: config.solPriceOracleUrl });
    this.supplyProvider = supplyProvider;
    this.cacheTtlMs = cacheTtlMs;
    this.now = now;
    this.cached = null;
  }

  usdcMint() {
    if (this.config.usdcMint) return this.config.usdcMint;
    return this.config.network === 'devnet' ? DEVNET_USDC_MINT : MAINNET_USDC_MINT;
  }

  async refresh() {
    const supply = this.supplyProvider();
    if (!this.config.treasuryConfigured) {
      return this.format({ sol: 0, usdc: 0, successfulAt: null, stale: false, supply });
    }
    try {
      const [sol, usdc, price] = await Promise.all([
        this.rpcClient.getSolBalance(this.config.treasuryAddress),
        this.rpcClient.getTokenBalance(this.config.treasuryAddress, this.usdcMint()),
        this.config.solUsdPrice > 0
          ? { price: this.config.solUsdPrice, stale: false }
          : this.priceOracle.getPrice()
      ]);
      this.cached = { sol, usdc, price: price.price, priceStale: price.stale, successfulAt: this.now() };
      return this.format({ ...this.cached, stale: false, supply });
    } catch (error) {
      if (this.cached) return this.format({ ...this.cached, stale: true, supply, error: error.message });
      return this.format({ sol: 0, usdc: 0, successfulAt: null, solUsdPrice: this.config.solUsdPrice, stale: true, supply, error: error.message });
    }
  }

  async getReserve({ force = false } = {}) {
    if (!force && this.cached && this.now() - this.cached.successfulAt < this.cacheTtlMs) {
      return this.format({ ...this.cached, stale: false, supply: this.supplyProvider() });
    }
    return this.refresh();
  }

  format({ sol, usdc, successfulAt, price, priceStale, solUsdPrice, stale, supply, error }) {
    const effectivePrice = Number(price ?? solUsdPrice ?? this.config.solUsdPrice ?? 0);
    const estimatedUsd = Number((usdc + sol * effectivePrice).toFixed(6));
    const outstanding = Number(supply.outstanding || 0);
    return {
      network: this.config.network,
      treasury_address: this.config.treasuryAddress || null,
      reserve: {
        sol: Number(sol || 0),
        usdc: Number(usdc || 0),
        sol_usd_price: effectivePrice,
        price_stale: Boolean(priceStale),
        estimated_usd: estimatedUsd,
        last_successful_refresh: successfulAt,
        stale: Boolean(stale)
      },
      merit: {
        outstanding,
        minted: Number(supply.minted || 0),
        burned: Number(supply.burned || 0),
        burned_land: Number(supply.burnedLand || 0),
        reserve_value_per_merit: outstanding > 0 ? estimatedUsd / outstanding : 0
      },
      land: supply.land || { available: 0, owned: 0 },
      ...(error ? { warning: 'Reserve RPC unavailable; cached or zero values are shown.' } : {})
    };
  }
}

