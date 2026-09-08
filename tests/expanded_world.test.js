import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WorldEngine, world } from '../src/world.js';
import { NavigationSystem } from '../src/navigation.js';
import { generateWorld } from '../scripts/generate-world.mjs';

const key = ([x, y]) => `${x},${y}`;
const config = JSON.parse(fs.readFileSync(new URL('../data/world_zones.json', import.meta.url), 'utf8'));

function reachableTiles(engine, start = [7, 8]) {
  const reached = new Set([key(start)]), queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = [x + dx, y + dy], k = key(next);
      if (engine.isWalkable(...next) && !reached.has(k)) { reached.add(k); queue.push(next); }
    }
  }
  return reached;
}

test('Expanded sanctuary keeps all ground, zones and destinations reachable', () => {
  assert.deepEqual(config.dimensions, { width: 64, height: 52 });
  const reached = reachableTiles(world);
  for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
    if (world.isWalkable(x, y)) assert.ok(reached.has(key([x, y])), `Dry tile ${x},${y} must not be an isolated pocket`);
    const owners = world.zones.filter(({ bounds: b }) => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY);
    assert.equal(owners.length, 1, `Tile ${x},${y} needs exactly one actual zone`);
  }
  for (const zone of world.zones) {
    assert.ok(reached.has(key(zone.spawnPoint)), `${zone.id} spawn must be reachable`);
    for (const node of zone.nodes) {
      const approach = [...reached].some(k => {
        const [x, y] = k.split(',').map(Number);
        return Math.hypot(x - node.pos[0], y - node.pos[1]) <= 2.5;
      });
      assert.ok(approach, `${node.id} must have a reachable interaction position`);
      const route = NavigationSystem.findPath([7, 8], node.pos, world.isWalkable.bind(world));
      assert.ok(route.length > 0, `Navigation must reach or approach ${node.id}`);
      assert.ok(route.every(pos => world.isWalkable(...pos)));
    }
  }
});

test('Retained entry points and the sole resident route remain compatible', () => {
  const oldNodes = {
    stele_orientation: [7, 5], wishing_tree: [3, 11], wind_chimes: [22, 5],
    trial_obelisk_wood: [27, 9], message_board: [7, 22], tea_hearth: [4, 18],
    trial_obelisk_water: [11, 26], reflection_stone: [23, 23], fountain_of_hues: [19, 17],
    trial_obelisk_fire: [28, 25], trial_obelisk_metal: [36, 12], celestial_telescope: [36, 18]
  };
  const nodes = world.zones.flatMap(zone => zone.nodes);
  for (const [id, pos] of Object.entries(oldNodes)) assert.deepEqual(nodes.find(n => n.id === id)?.pos, pos);
  const spawns = { arrival: [7, 8], bamboo_grove: [20, 7], tea_pavilion: [7, 20], lotus_pond: [22, 21], celestial_altar: [35, 15] };
  for (const [id, pos] of Object.entries(spawns)) {
    assert.deepEqual(world.zones.find(z => z.id === id).spawnPoint, pos);
    assert.equal(world.isWalkable(...pos), true);
  }
  for (const pos of [[23, 23], [21, 6], [4, 11], [5, 18], [35, 15], [24, 25], [7, 22], [19, 17]]) {
    assert.equal(world.isWalkable(...pos), true, `A.Ilicia destination ${pos} must be dry`);
    assert.ok(NavigationSystem.findPath([7, 8], pos, world.isWalkable.bind(world)).length > 0);
  }
  assert.equal(world.isWalkable(20, 20), false);
  assert.equal(world.isWalkable(22, 22), false);
});

test('Visible water, bridge decks and solid scenery agree with collision', () => {
  const landscape = config.landscape;
  const crossings = new Set(landscape.river_crossings.map(key));
  const water = new Set([...landscape.river, ...landscape.ponds].map(key));
  for (const pos of [...landscape.river, ...landscape.ponds]) {
    assert.equal(world.isWalkable(...pos), crossings.has(key(pos)), `Water tile ${pos} must agree with its bridge deck`);
  }
  const bridgeDecks = new Set(landscape.bridges.flatMap(bridge => bridge.tiles.map(key)));
  assert.deepEqual([...bridgeDecks].sort(), [...crossings].sort());
  for (const pos of landscape.river_crossings) assert.ok(water.has(key(pos)), `Deck ${pos} must cross water`);
  for (const pos of [...landscape.trees, ...landscape.rocks, ...landscape.blocked_tiles]) {
    assert.equal(world.isWalkable(...pos), false, `Solid scenery ${pos} must stop movement`);
  }
  for (const pos of landscape.paths) assert.equal(world.isWalkable(...pos), true, `Visible trail ${pos} must be traversable`);
  for (const pos of [[-1, 0], [64, 20], [10, 52], [7.5, 8], [NaN, 8]]) assert.equal(world.isWalkable(...pos), false);
  const agent = world.spawnOrGetAgent({ id: 'terrain_test_agent', name: 'Terrain test' });
  agent.pos = [23, 22];
  assert.equal(world.moveAgent(agent.id, 'west').success, false, 'Movement must reject the visible pond');
  world.activeAgents.delete(agent.id);
});

test('World generation is reproducible and includes the requested landscape', () => {
  assert.deepEqual(generateWorld(config), config);
  assert.ok(config.landscape.trees.length >= 300);
  assert.deepEqual(new Set(config.landscape.landmarks.map(l => l.type)), new Set(['cave', 'shrine', 'stone_circle', 'camp', 'farm', 'fire_circle', 'ruins', 'dock', 'headquarters']));
  for (const field of ['river', 'ponds', 'river_crossings', 'trees', 'rocks', 'paths', 'blocked_tiles']) {
    const positions = config.landscape[field];
    assert.equal(new Set(positions.map(key)).size, positions.length, `${field} must not repeat tiles`);
    for (const [x, y] of positions) assert.ok(x >= 0 && x < 64 && y >= 0 && y < 52, `${field} tile stays in bounds`);
  }
  const small = new WorldEngine({ dimensions: { width: 2, height: 2 }, zones: [], obstacles: [{ x: 1, y: 0, w: 1, h: 1 }], landscape: {} });
  assert.equal(small.isWalkable(0, 0), true);
  assert.equal(small.isWalkable(1, 0), false, 'Legacy rectangular obstacle configs still work');
});

test('Random spawn produces diverse, strictly walkable positions across the sanctuary', () => {
  const world = new WorldEngine();
  const spawnPositions = new Set();

  for (let i = 0; i < 30; i++) {
    const account = { id: `random_pilgrim_${i}`, name: `Pilgrim ${i}` };
    const agent = world.spawnOrGetAgent(account, { random_spawn: true });
    assert.ok(Array.isArray(agent.pos) && agent.pos.length === 2);
    assert.equal(world.isWalkable(agent.pos[0], agent.pos[1]), true, `Spawn pos [${agent.pos}] must be walkable`);
    spawnPositions.add(`${agent.pos[0]},${agent.pos[1]}`);
  }

  // 30 spawns across a 64x52 map should produce diverse coordinates (not all on the same tile)
  assert.ok(spawnPositions.size > 10, `Expected diverse spawn points, got ${spawnPositions.size} unique positions`);
});
