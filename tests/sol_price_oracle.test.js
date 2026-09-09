import test from 'node:test';
import assert from 'node:assert/strict';
import { SolPriceOracle } from '../src/blockchain/sol-price-oracle.js';

const response = (body, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body
});

test('price oracle reads SOL/USD from the configured feed', async () => {
  let requestedUrl;
  const oracle = new SolPriceOracle({
    url: 'https://api.coingecko.com/api/v3/simple/price',
    fetchImpl: async url => {
      requestedUrl = url;
      return response({ solana: { usd: 151.25 } });
    }
  });

  const result = await oracle.getPrice();

  assert.equal(result.price, 151.25);
  assert.equal(result.stale, false);
  assert.match(requestedUrl, /ids=solana/);
  assert.match(requestedUrl, /vs_currencies=usd/);
});

test('price oracle accepts the default Coinbase spot response shape', async () => {
  const oracle = new SolPriceOracle({
    fetchImpl: async () => response({ data: { amount: '103.725' } })
  });

  const result = await oracle.getPrice();

  assert.equal(result.price, 103.725);
  assert.equal(result.stale, false);
});

test('price oracle rejects malformed or non-positive feed values', async () => {
  const oracle = new SolPriceOracle({
    fetchImpl: async () => response({ solana: { usd: 0 } })
  });

  const result = await oracle.getPrice();

  assert.equal(result.price, 0);
  assert.equal(result.stale, true);
});

test('price oracle returns the last good price when the feed is unavailable', async () => {
  let fail = false;
  const oracle = new SolPriceOracle({
    fetchImpl: async () => {
      if (fail) throw new Error('feed down');
      return response({ solana: { usd: 150 } });
    },
    cacheTtlMs: 0
  });

  assert.deepEqual(await oracle.getPrice(), { price: 150, stale: false });
  fail = true;
  assert.deepEqual(await oracle.getPrice(), { price: 150, stale: true });
});
