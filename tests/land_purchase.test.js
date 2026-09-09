import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { createLocalSchema } from '../src/infrastructure/database/schema.js';
import { MockLandAssetProvider } from '../src/blockchain/nft-service.js';
import { GridPurchaseService } from '../src/land/grid-purchase.js';
import { encodeBase58 } from '../src/blockchain/solana-client.js';

function address(byte) { return encodeBase58(Uint8Array.from({ length: 32 }, () => byte)); }

function setup({ balance = 2500, gridStatus = 'available', linked = true, guest = false } = {}) {
  const db = new DatabaseSync(':memory:');
  createLocalSchema(db);
  const now = Date.now();
  db.prepare(`INSERT INTO accounts (id, name, email, verified, is_guest, api_key, created_at) VALUES ('agent_a', 'Agent A', 'a@example.com', 1, ?, 'key_a', ?)`).run(guest ? 1 : 0, now);
  db.prepare(`INSERT INTO profiles (agent_id, balance, total_earned, last_seen) VALUES ('agent_a', ?, ?, ?)`).run(balance, balance, now);
  if (linked) db.prepare(`INSERT INTO wallet_links (agent_id, wallet_address, verified_at) VALUES ('agent_a', ?, ?)`).run(address(7), now);
  db.prepare(`INSERT INTO land_grids (grid_id, x, y, zone_id, status) VALUES ('EP-41-37', 41, 37, 'sunfield', ?)`).run(gridStatus);
  const provider = new MockLandAssetProvider();
  const service = new GridPurchaseService({ db, assetProvider: provider, metadataBaseUrl: 'https://example.test', collectionAddress: 'collection' });
  return { db, provider, service, agent: { id: 'agent_a', is_guest: guest ? 1 : 0 }, walletAddress: address(7) };
}

test('land purchase rejects unavailable/public grids, insufficient MERIT, unlinked wallets, and guests', async () => {
  for (const status of ['unavailable', 'public']) {
    const fixture = setup({ gridStatus: status });
    await assert.rejects(() => fixture.service.purchase({ agent: fixture.agent, walletAddress: fixture.walletAddress, gridId: 'EP-41-37', idempotencyKey: `key-${status}` }), /cannot be purchased/);
  }
  let fixture = setup({ balance: 999 });
  await assert.rejects(() => fixture.service.purchase({ agent: fixture.agent, walletAddress: fixture.walletAddress, gridId: 'EP-41-37', idempotencyKey: 'key-low' }), /1000 MERIT/);
  fixture = setup({ linked: false });
  await assert.rejects(() => fixture.service.purchase({ agent: fixture.agent, walletAddress: fixture.walletAddress, gridId: 'EP-41-37', idempotencyKey: 'key-unlinked' }), /linked and cryptographically verified/);
  fixture = setup({ guest: true });
  await assert.rejects(() => fixture.service.purchase({ agent: fixture.agent, walletAddress: fixture.walletAddress, gridId: 'EP-41-37', idempotencyKey: 'key-guest' }), /Guests cannot purchase/);
});

test('successful purchase atomically burns exactly 1000, records NFT, and idempotent retry has no second effect', async () => {
  const { db, provider, service, agent, walletAddress } = setup();
  const input = { agent, walletAddress, gridId: 'EP-41-37', idempotencyKey: 'purchase-once' };
  const result = await service.purchase(input);
  assert.equal(result.status, 'confirmed');
  assert.equal(db.prepare(`SELECT balance FROM profiles WHERE agent_id = 'agent_a'`).get().balance, 1500);
  const grid = db.prepare(`SELECT * FROM land_grids WHERE grid_id = 'EP-41-37'`).get();
  assert.equal(grid.status, 'owned');
  assert.ok(grid.nft_asset_address);
  assert.equal(db.prepare(`SELECT SUM(amount) total FROM transactions WHERE type = 'land_purchase_burn'`).get().total, 1000);
  const replay = await service.purchase(input);
  assert.equal(replay.purchase_id, result.purchase_id);
  assert.equal(provider.mintCalls, 1);
  assert.equal(db.prepare(`SELECT balance FROM profiles WHERE agent_id = 'agent_a'`).get().balance, 1500);
});

test('definitive mint submission failure refunds exactly 1000 and makes grid available again', async () => {
  const { db, provider, service, agent, walletAddress } = setup();
  provider.failNextMint = new Error('mock rejected mint');
  const result = await service.purchase({ agent, walletAddress, gridId: 'EP-41-37', idempotencyKey: 'failed-mint' });
  assert.equal(result.status, 'refunded');
  assert.equal(db.prepare(`SELECT balance FROM profiles WHERE agent_id = 'agent_a'`).get().balance, 2500);
  assert.equal(db.prepare(`SELECT status FROM land_grids WHERE grid_id = 'EP-41-37'`).get().status, 'available');
  assert.equal(db.prepare(`SELECT amount FROM transactions WHERE type = 'land_purchase_refund'`).get().amount, 1000);
});

test('conditional reservation prevents two agents from purchasing one grid', async () => {
  const { db, service, agent, walletAddress } = setup();
  const now = Date.now();
  db.prepare(`INSERT INTO accounts (id, name, email, verified, api_key, created_at) VALUES ('agent_b', 'Agent B', 'b@example.com', 1, 'key_b', ?)`).run(now);
  db.prepare(`INSERT INTO profiles (agent_id, balance, total_earned, last_seen) VALUES ('agent_b', 2500, 2500, ?)`).run(now);
  db.prepare(`INSERT INTO wallet_links (agent_id, wallet_address, verified_at) VALUES ('agent_b', ?, ?)`).run(address(8), now);
  await service.purchase({ agent, walletAddress, gridId: 'EP-41-37', idempotencyKey: 'winner' });
  await assert.rejects(() => service.purchase({ agent: { id: 'agent_b' }, walletAddress: address(8), gridId: 'EP-41-37', idempotencyKey: 'loser' }), /cannot be purchased/);
  assert.equal(db.prepare(`SELECT balance FROM profiles WHERE agent_id = 'agent_b'`).get().balance, 2500);
});

test('unknown RPC outcome remains minting and never refunds on timeout alone', async () => {
  const { db, provider, service, agent, walletAddress } = setup();
  provider.failNextMint = Object.assign(new Error('transport timeout'), { definitive: false });
  // Mock failures are definitive by design; use an adapter that models ambiguity.
  provider.submitLandAsset = async () => { throw new Error('transport timeout'); };
  const result = await service.purchase({ agent, walletAddress, gridId: 'EP-41-37', idempotencyKey: 'unknown-mint' });
  assert.equal(result.status, 'minting');
  assert.equal(db.prepare(`SELECT balance FROM profiles WHERE agent_id = 'agent_a'`).get().balance, 1500);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM transactions WHERE type = 'land_purchase_refund'`).get().count, 0);
});

test('recovery confirms a submitted mint from deterministic asset evidence without a second burn or mint', async () => {
  const { db, provider, service, agent, walletAddress } = setup();
  const normalCheck = provider.checkLandAsset.bind(provider);
  let first = true;
  provider.checkLandAsset = async input => {
    if (first) { first = false; return { state: 'pending' }; }
    return normalCheck(input);
  };
  const pending = await service.purchase({ agent, walletAddress, gridId: 'EP-41-37', idempotencyKey: 'recover-confirmed' });
  assert.equal(pending.status, 'minting');
  assert.ok(pending.solana_signature, 'submission signature must be persisted before confirmation');
  const recovered = await service.reconcilePurchase(pending.purchase_id);
  assert.equal(recovered.status, 'confirmed');
  assert.equal(provider.mintCalls, 1);
  assert.equal(db.prepare(`SELECT balance FROM profiles WHERE agent_id = 'agent_a'`).get().balance, 1500);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM transactions WHERE type = 'land_purchase_burn'`).get().count, 1);
});
