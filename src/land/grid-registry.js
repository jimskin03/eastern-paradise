export const GRID_PRICE_MERIT = 1000;

// Deliberately small Devnet pilot. Adding sellable land requires an explicit code
// review instead of deriving availability from every walkable world tile.
export const INITIAL_PURCHASABLE_GRID_ALLOWLIST = Object.freeze([
  [41, 35], [42, 35], [43, 35], [44, 35],
  [41, 36], [42, 36], [43, 36], [44, 36],
  [41, 37], [42, 37], [43, 37], [44, 37]
]);

export function gridIdFor(x, y) {
  return `EP-${Number(x)}-${Number(y)}`;
}

export class GridRegistry {
  constructor({ db, world }) {
    this.db = db;
    this.world = world;
  }

  isProtected(x, y) {
    if (!this.world.isWalkable(x, y)) return true;
    const key = `${x},${y}`;
    const landscape = this.world.landscape || {};
    const protectedCoordinates = [
      ...(landscape.river || []),
      ...(landscape.ponds || []),
      ...(landscape.paths || []),
      ...(landscape.river_crossings || []),
      ...(landscape.trees || []),
      ...(landscape.rocks || []),
      ...(landscape.blocked_tiles || []),
      ...(landscape.props || []).map(item => item.pos),
      ...(landscape.bridges || []).map(item => item.pos)
    ];
    if (protectedCoordinates.some(pos => Array.isArray(pos) && `${pos[0]},${pos[1]}` === key)) return true;
    if (this.world.getAllNodes().some(node => node.pos?.[0] === x && node.pos?.[1] === y)) return true;
    if (this.world.zones.some(zone => zone.spawnPoint?.[0] === x && zone.spawnPoint?.[1] === y)) return true;
    return false;
  }

  seedInitialRegion() {
    let seeded = 0;
    for (const [x, y] of INITIAL_PURCHASABLE_GRID_ALLOWLIST) {
      if (this.isProtected(x, y)) continue;
      const zone = this.world.getZoneForPos(x, y);
      const result = this.db.prepare(`
        INSERT OR IGNORE INTO land_grids (grid_id, x, y, zone_id, status)
        VALUES (?, ?, ?, ?, 'available')
      `).run(gridIdFor(x, y), x, y, zone?.id || null);
      seeded += result.changes;
    }
    return seeded;
  }

  list({ status } = {}) {
    const rows = status
      ? this.db.prepare('SELECT * FROM land_grids WHERE status = ? ORDER BY y, x').all(status)
      : this.db.prepare('SELECT * FROM land_grids ORDER BY y, x').all();
    return rows.map(row => this.toPublic(row));
  }

  get(gridId) {
    const row = this.db.prepare('SELECT * FROM land_grids WHERE grid_id = ?').get(gridId);
    return row ? this.toPublic(row) : null;
  }

  getRaw(gridId) {
    return this.db.prepare('SELECT * FROM land_grids WHERE grid_id = ?').get(gridId) || null;
  }

  myGrids(agentId, wallets = []) {
    const addresses = wallets.map(item => typeof item === 'string' ? item : item.wallet_address).filter(Boolean);
    const conditions = ['owner_agent_id = ?'];
    const args = [agentId];
    if (addresses.length) {
      conditions.push(`owner_wallet IN (${addresses.map(() => '?').join(', ')})`);
      args.push(...addresses);
    }
    return this.db.prepare(`SELECT * FROM land_grids WHERE status = 'owned' AND (${conditions.join(' OR ')}) ORDER BY purchased_at DESC`).all(...args).map(row => this.toPublic(row));
  }

  updatePlot(agentId, gridId, { name, description }) {
    const row = this.getRaw(gridId);
    if (!row || row.status !== 'owned') throw new Error('Owned grid not found.');
    if (row.owner_agent_id !== agentId) throw new Error('Only the current linked owner may edit this plot.');
    const cleanName = String(name ?? row.plot_name ?? '').trim().slice(0, 48);
    const cleanDescription = String(description ?? row.plot_description ?? '').trim().slice(0, 240);
    this.db.prepare('UPDATE land_grids SET plot_name = ?, plot_description = ? WHERE grid_id = ?').run(cleanName || null, cleanDescription || null, gridId);
    return this.get(gridId);
  }

  toPublic(row) {
    const ownerAccount = row.status === 'owned' && row.owner_agent_id
      ? this.db.prepare('SELECT name FROM accounts WHERE id = ?').get(row.owner_agent_id)
      : null;
    return {
      grid_id: row.grid_id,
      x: row.x,
      y: row.y,
      zone: row.zone_id,
      status: row.status,
      price_merit: GRID_PRICE_MERIT,
      owner_agent_id: row.status === 'owned' ? row.owner_agent_id : null,
      owner_agent_name: ownerAccount?.name || null,
      owner_wallet: row.status === 'owned' ? row.owner_wallet : null,
      nft_asset_address: row.status === 'owned' ? row.nft_asset_address : null,
      plot_name: row.plot_name || null,
      plot_description: row.plot_description || null,
      purchased_at: row.purchased_at || null
    };
  }
}
