import { BscRpcClient, formatTokenAmount } from './bsc-client.js';
export class TreasuryService {
  constructor({ config, rpcClient, supplyProvider, cacheTtlMs = 60_000, now = () => Date.now() }) { this.config=config; this.rpcClient=rpcClient || new BscRpcClient(config); this.supplyProvider=supplyProvider; this.cacheTtlMs=cacheTtlMs; this.now=now; this.cached=null; }
  async refresh() {
    const supply=this.supplyProvider(); if (!this.config.treasuryConfigured) return this.format({ bnb:0n, usdc:0n, successfulAt:null, stale:false, supply });
    try { await this.rpcClient.assertChain(); const [bnb, usdc] = await Promise.all([this.rpcClient.getNativeBalance(this.config.treasuryAddress), this.rpcClient.getTokenBalance(this.config.treasuryAddress, this.config.usdcAddress)]); this.cached={bnb,usdc,successfulAt:this.now()}; return this.format({...this.cached,stale:false,supply}); }
    catch(error) { if (this.cached) return this.format({...this.cached,stale:true,supply,error:error.message}); return this.format({bnb:0n,usdc:0n,successfulAt:null,stale:true,supply,error:error.message}); }
  }
  async getReserve({force=false}={}) { if (!force && this.cached && this.now()-this.cached.successfulAt < this.cacheTtlMs) return this.format({...this.cached,stale:false,supply:this.supplyProvider()}); return this.refresh(); }
  format({bnb,usdc,successfulAt,stale,supply,error}) { const outstanding=BigInt(Math.max(0, Math.trunc(Number(supply.outstanding||0)))); return { network:this.config.network, chain_id:this.config.chainId, treasury_address:this.config.treasuryAddress, reserve:{ bnb:formatTokenAmount(bnb||0n,18), usdc:formatTokenAmount(usdc||0n,18), usdc_decimals:18, estimated_usd:formatTokenAmount(usdc||0n,18), last_successful_refresh:successfulAt, stale:Boolean(stale) }, merit:{ outstanding:Number(outstanding), minted:Number(supply.minted||0), burned:Number(supply.burned||0), burned_land:Number(supply.burnedLand||0), reserve_value_per_merit: outstanding>0n ? Number(usdc||0n)/1e18/Number(outstanding) : 0 }, land:supply.land||{available:0,owned:0}, ...(error?{warning:'Reserve RPC unavailable; cached or zero values are shown.'}:{}) }; }
}
