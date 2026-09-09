export class OwnershipSyncService {
  constructor({ db, assetProvider, collectionAddress }) {
    this.db = db;
    this.assetProvider = assetProvider;
    this.collectionAddress = collectionAddress;
  }

  async syncGrid(gridId) {
    const grid = this.db.prepare(`SELECT * FROM land_grids WHERE grid_id = ? AND nft_asset_address IS NOT NULL`).get(gridId);
    if (!grid) return null;
    const chain = await this.assetProvider.getAssetOwner(grid.nft_asset_address);
    if (this.collectionAddress && chain.collectionAddress && chain.collectionAddress !== this.collectionAddress) {
      throw new Error(`Asset ${grid.nft_asset_address} is not in the Eastern Paradise Land collection.`);
    }
    const linked = this.db.prepare('SELECT agent_id FROM wallet_links WHERE wallet_address = ?').get(chain.owner);
    this.db.prepare(`
      UPDATE land_grids SET status = 'owned', owner_wallet = ?, owner_agent_id = ? WHERE grid_id = ?
    `).run(chain.owner, linked?.agent_id || null, grid.grid_id);
    return { grid_id: grid.grid_id, owner_wallet: chain.owner, owner_agent_id: linked?.agent_id || null };
  }

  async reconcileAll() {
    const grids = this.db.prepare(`SELECT grid_id FROM land_grids WHERE nft_asset_address IS NOT NULL`).all();
    const results = [];
    for (const grid of grids) {
      try {
        results.push(await this.syncGrid(grid.grid_id));
      } catch (error) {
        results.push({ grid_id: grid.grid_id, error: error.message });
      }
    }
    return results;
  }
}

