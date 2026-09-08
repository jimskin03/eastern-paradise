const tileKey = ([x, y]) => `${x},${y}`;

export function buildSpatialSets(landscape) {
  return {
    waterTiles: new Set([
      ...(landscape.river || []), ...(landscape.ponds || [])
    ].map(tileKey)),
    bridgeTiles: new Set((landscape.river_crossings || []).map(tileKey)),
    blockedTiles: new Set([
      ...(landscape.trees || []), ...(landscape.rocks || []),
      ...(landscape.blocked_tiles || []),
      ...(landscape.props || []).filter(prop => prop.blocking).map(prop => prop.pos)
    ].map(tileKey))
  };
}

export function getZoneForPos(world, x, y) {
  for (const zone of world.zones) {
    const bounds = zone.bounds;
    if (x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY) {
      return zone;
    }
  }
  return world.zones[0];
}

export function getZone(world, identifier) {
  if (!identifier) return null;
  const clean = String(identifier).trim().toLowerCase().replace(/[\s_-]+/g, '');
  return world.zones.find(zone => {
    const idClean = zone.id.toLowerCase().replace(/[\s_-]+/g, '');
    const nameClean = zone.name.toLowerCase().replace(/[\s_-]+/g, '');
    return idClean === clean || nameClean === clean;
  }) || null;
}

export function getAllNodes(world) {
  const nodes = [];
  for (const zone of world.zones) {
    for (const node of zone.nodes) {
      nodes.push({
        id: node.id,
        name: node.name,
        type: node.type,
        category: node.category || null,
        quest: node.quest || null,
        pos: node.pos,
        icon: node.icon,
        description: node.description,
        zone_id: zone.id,
        zone_name: zone.name
      });
    }
  }
  return nodes;
}

export function isWalkable(world, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= world.width || y < 0 || y >= world.height) {
    return false;
  }
  const key = `${x},${y}`;
  if (world.blockedTiles.has(key)) return false;
  if (world.waterTiles.has(key) && !world.bridgeTiles.has(key)) return false;
  for (const obstacle of world.obstacles) {
    if (x >= obstacle.x && x < obstacle.x + obstacle.w && y >= obstacle.y && y < obstacle.y + obstacle.h) {
      return false;
    }
  }
  return true;
}

export function getRandomWalkablePos(world, occupiedPositions = new Set()) {
  const maxAttempts = 150;
  for (let i = 0; i < maxAttempts; i++) {
    const rx = Math.floor(Math.random() * world.width);
    const ry = Math.floor(Math.random() * world.height);
    const key = `${rx},${ry}`;
    if (isWalkable(world, rx, ry) && !occupiedPositions.has(key)) {
      return [rx, ry];
    }
  }

  // Fallback: full grid scan if random sampling missed
  const walkable = [];
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const key = `${x},${y}`;
      if (isWalkable(world, x, y)) {
        if (!occupiedPositions.has(key)) {
          walkable.push([x, y]);
        }
      }
    }
  }
  if (walkable.length > 0) {
    return walkable[Math.floor(Math.random() * walkable.length)];
  }

  // Ultimate fallback to zone spawnPoint if completely bounded
  const fallbackZone = world.zones?.[0];
  return fallbackZone?.spawnPoint ? [...fallbackZone.spawnPoint] : [0, 0];
}
