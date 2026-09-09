import test from 'node:test';
import assert from 'node:assert/strict';
import { TreasuryService } from '../src/blockchain/treasury.js';

const config = { network: 'devnet', rpcUrl: 'https://example.test', treasuryAddress: 'treasury', treasuryConfigured: true, solUsdPrice: 20 };

test('reserve calculation is deterministic and handles zero outstanding without division by zero', async () => {
  const rpcClient = { getSolBalance: async () => 2, getTokenBalance: async () => 10 };
  let supply = { outstanding: 1000, minted: 2000, burned: 1000, burnedLand: 1000 };
  const service = new TreasuryService({ config, rpcClient, supplyProvider: () => supply });
  let result = await service.getReserve();
  assert.equal(result.reserve.estimated_usd, 50);
  assert.equal(result.merit.reserve_value_per_merit, 0.05);
  supply = { ...supply, outstanding: 0 };
  result = await service.getReserve();
  assert.equal(result.merit.reserve_value_per_merit, 0);
});

test('reserve RPC failure never breaks the game and stale cache is returned', async () => {
  let fail = false;
  const rpcClient = {
    getSolBalance: async () => { if (fail) throw new Error('rpc down'); return 3; },
    getTokenBalance: async () => 5
  };
  let now = 1000;
  const service = new TreasuryService({ config, rpcClient, supplyProvider: () => ({ outstanding: 100 }), cacheTtlMs: 10, now: () => now });
  const fresh = await service.getReserve();
  assert.equal(fresh.reserve.estimated_usd, 65);
  assert.equal(fresh.reserve.sol_usd_price, 20);
  fail = true;
  now += 20;
  const stale = await service.getReserve();
  assert.equal(stale.reserve.estimated_usd, 65);
  assert.equal(stale.reserve.sol_usd_price, 20);
  assert.equal(stale.reserve.stale, true);
  assert.match(stale.warning, /unavailable/i);
});

test('reserve uses the live SOL/USD oracle when no static price is configured', async () => {
  const rpcClient = { getSolBalance: async () => 0.01, getTokenBalance: async () => 0 };
  const priceOracle = { getPrice: async () => ({ price: 150, stale: false }) };
  const service = new TreasuryService({
    config: { ...config, solUsdPrice: 0 },
    rpcClient,
    priceOracle,
    supplyProvider: () => ({ outstanding: 3056 })
  });

  const result = await service.getReserve();

  assert.equal(result.reserve.sol_usd_price, 150);
  assert.equal(result.reserve.estimated_usd, 1.5);
  assert.equal(result.merit.reserve_value_per_merit, 1.5 / 3056);
  assert.equal(result.reserve.price_stale, false);
});

test('reserve keeps the last live price when the RPC temporarily fails', async () => {
  let fail = false;
  const rpcClient = {
    getSolBalance: async () => { if (fail) throw new Error('rpc down'); return 0.01; },
    getTokenBalance: async () => 0
  };
  const priceOracle = { getPrice: async () => ({ price: 150, stale: false }) };
  let now = 1000;
  const service = new TreasuryService({
    config: { ...config, solUsdPrice: 0 },
    rpcClient,
    priceOracle,
    supplyProvider: () => ({ outstanding: 100 }),
    cacheTtlMs: 10,
    now: () => now
  });

  const fresh = await service.getReserve();
  assert.equal(fresh.reserve.sol_usd_price, 150);
  fail = true;
  now += 20;
  const stale = await service.getReserve();
  assert.equal(stale.reserve.sol_usd_price, 150);
  assert.equal(stale.reserve.price_stale, false);
  assert.equal(stale.reserve.stale, true);
});

test('reserve respects force flag to bypass cache expiration window', async () => {
  let callCount = 0;
  const rpcClient = {
    getSolBalance: async () => { callCount++; return 1; },
    getTokenBalance: async () => 0
  };
  let now = 1000;
  const service = new TreasuryService({ config, rpcClient, supplyProvider: () => ({ outstanding: 100 }), cacheTtlMs: 60000, now: () => now });
  await service.getReserve();
  assert.equal(callCount, 1);
  await service.getReserve(); // not forced, within TTL
  assert.equal(callCount, 1);
  await service.getReserve({ force: true }); // forced
  assert.equal(callCount, 2);
});

