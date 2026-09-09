import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createLocalSchema } from '../src/infrastructure/database/schema.js';
import { MockLandAssetProvider } from '../src/blockchain/nft-service.js';
import { OwnershipSyncService } from '../src/blockchain/ownership-sync.js';
import { encodeBase58 } from '../src/blockchain/solana-client.js';

const address = byte => encodeBase58(Uint8Array.from({ length: 32 }, () => byte));

test('blockchain transfer replaces cached owner and clears agent when receiving wallet is unlinked', async () => {
  const db = new DatabaseSync(':memory:');
  createLocalSchema(db);
  const provider = new MockLandAssetProvider();
  const minted = await provider.submitLandAsset({ purchaseId: 'p1', assetAddress: (await provider.prepareLandAsset({ purchaseId: 'p1' })).assetAddress, recipientWallet: address(1), collectionAddress: 'collection' });
  db.prepare(`INSERT INTO land_grids (grid_id, x, y, status, owner_agent_id, owner_wallet, nft_asset_address) VALUES ('EP-1-1', 1, 1, 'owned', 'agent_a', ?, ?)`).run(address(1), minted.assetAddress);
  provider.transfer(minted.assetAddress, address(2));
  const sync = new OwnershipSyncService({ db, assetProvider: provider, collectionAddress: 'collection' });
  await sync.reconcileAll();
  let grid = db.prepare(`SELECT * FROM land_grids WHERE grid_id = 'EP-1-1'`).get();
  assert.equal(grid.owner_wallet, address(2));
  assert.equal(grid.owner_agent_id, null);
  assert.equal(grid.status, 'owned');

  db.prepare(`INSERT INTO wallet_links (agent_id, wallet_address, verified_at) VALUES ('agent_b', ?, ?)`).run(address(2), Date.now());
  await sync.reconcileAll();
  grid = db.prepare(`SELECT * FROM land_grids WHERE grid_id = 'EP-1-1'`).get();
  assert.equal(grid.owner_agent_id, 'agent_b');
});

