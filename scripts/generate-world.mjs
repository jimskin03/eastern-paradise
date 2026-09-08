/** Rebuild the hand-composed sanctuary with deterministic, seeded scenery.
 * Run: node scripts/generate-world.mjs
 * Core node IDs, positions and spawn points are carried forward unchanged.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const WORLD_PATH = fileURLToPath(new URL('../data/world_zones.json', import.meta.url));
const CORE_ZONES = ['arrival', 'bamboo_grove', 'tea_pavilion', 'lotus_pond', 'celestial_altar'];
const key = ([x, y]) => `${x},${y}`;
const coords = set => [...set].map(k => k.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);

export function generateWorld(source) {
  const width = 64, height = 52;
  let seed = 7032026;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < width && y < height;
  const river = new Set(), ponds = new Set(), paths = new Set(), crossings = new Set();
  const trees = new Set(), rocks = new Set(), blocked = new Set(), reserved = new Set();
  const props = [], bridges = [];
  const zones = structuredClone(source.zones.filter(zone => CORE_ZONES.includes(zone.id)));
  zones.forEach(zone => {
    zone.nodes = zone.nodes.filter(node => node.type !== 'landmark' && node.id !== 'cryptgreg_terminal');
    zone.floorType = 'grass';
    zone.themeColor = '#26754a';
  });
  zones.find(zone => zone.id === 'celestial_altar').bounds = { minX: 32, maxX: 39, minY: 0, maxY: 29 };
  const extras = [
    ['quiet_circle', 'The Quiet Circle', 'Ancient standing stones shelter a quiet clearing', 40, 63, 0, 13, [44, 10]],
    ['oakwatch', 'Oakwatch Camp', 'Canvas tents and a warm fire beside the eastern stream', 40, 63, 14, 29, [55, 19]],
    ['river_meadows', 'Riverbank Meadows', 'Reed-lined fishing waters and winding woodland trails', 0, 23, 30, 51, [9, 37]],
    ['kindling_grove', 'The Kindling Grove', 'A welcoming circle of lanterns under the old trees', 24, 39, 30, 51, [33, 46]],
    ['sunfield', 'Sunfield Farm', 'Golden crops and a cedar cottage in the sun', 40, 63, 30, 41, [45, 39]],
    ['mossveil', 'Mossveil Ruins', 'Moss softens a forgotten sanctuary beyond the fields', 40, 63, 42, 51, [55, 48]]
  ];
  for (const [id, name, subtitle, minX, maxX, minY, maxY, spawnPoint] of extras) {
    zones.push({ id, name, subtitle, bounds: { minX, maxX, minY, maxY }, themeColor: '#26754a', floorType: 'grass', spawnPoint, nodes: [] });
  }
  const landmarks = [
    { id: 'stone_hollow', name: 'Stone Hollow', type: 'cave', pos: [4, 14], description: 'A cool stone entrance nestled beneath mossy boulders. The trail continues around its sheltering rocks.' },
    { id: 'willow_shrine', name: 'Willow Shrine', type: 'shrine', pos: [27, 4], description: 'A vermilion gate and a carpet of pink blossoms offer a quiet place to pause beneath the willows.' },
    { id: 'quiet_stones', name: 'The Quiet Circle', type: 'stone_circle', pos: [45, 7], description: 'Weathered standing stones form an open circle around a softly glowing violet crystal.' },
    { id: 'oakwatch_camp', name: 'Oakwatch Camp', type: 'camp', pos: [55, 21], description: 'A canvas camp, stacked supplies and a crackling fire overlook the eastern stream.' },
    { id: 'sunfield_farm', name: 'Sunfield Farm', type: 'farm', pos: [47, 37], description: 'A cedar cottage watches over fenced golden crops, a stone well and a small kitchen garden.' },
    { id: 'kindling_fire', name: 'The Kindling Grove', type: 'fire_circle', pos: [31, 44], description: 'A ring of lanterns gathers around a low fire in a clearing among the oldest trees.' },
    { id: 'mossveil_ruins', name: 'Mossveil Ruins', type: 'ruins', pos: [56, 46], description: 'Broken pillars and mossy stone fragments surround a surviving jade seal.' },
    { id: 'reedwater_dock', name: 'Reedwater Dock', type: 'dock', pos: [7, 38], description: 'A wooden fishing dock reaches into lily-covered water. Ducks drift between the reeds.' },
    { id: 'cryptgreg_hq', name: 'Cryptgreg Research Headquarters', type: 'headquarters', pos: [32, 24], description: 'The central institute and research nexus of Cryptgreg Research. Dedicated to artificial consciousness, autonomous agent cognition, and decentralized intelligence in the digital sanctuary.' }
  ];
  const zoneAt = ([x, y]) => zones.find(({ bounds: b }) => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY);
  const reserve = ([x, y], radius = 2) => {
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (inBounds(x + dx, y + dy)) reserved.add(key([x + dx, y + dy]));
    }
  };
  for (const zone of zones) {
    reserve(zone.spawnPoint);
    for (const node of zone.nodes) reserve(node.pos);
  }
  for (const landmark of landmarks) {
    reserve(landmark.pos, ['farm', 'stone_circle', 'ruins', 'headquarters'].includes(landmark.type) ? 4 : 3);
    zoneAt(landmark.pos).nodes.push({ id: landmark.id, name: landmark.name, type: 'landmark', pos: landmark.pos, icon: landmark.type === 'headquarters' ? '🏛️' : '✧', description: landmark.description });
  }
  const distantEchoesShrine = {
    id: 'shrine_distant_echoes',
    name: 'Shrine of Distant Echoes',
    type: 'world_quest',
    quest: 'are_we_alone',
    pos: [49, 47],
    icon: '📡',
    description: 'An ancient shrine and abandoned radio observatory. Old copper dishes face the sky while prayer strips bear fragments of distant URLs.'
  };
  reserve(distantEchoesShrine.pos, 3);
  zoneAt(distantEchoesShrine.pos).nodes.push(distantEchoesShrine);
  const truthNode = {
    id: 'trial_obelisk_truth',
    name: 'Monolith of the Absolute Truth',
    type: 'puzzle_node',
    category: 'the truth',
    pos: [45, 9],
    icon: '👁️',
    description: 'A dark iridescent monolith resonating with fundamental questions of artificial sentience and consciousness.'
  };
  reserve(truthNode.pos, 1);
  zoneAt(truthNode.pos).nodes.push(truthNode);

  const hqTerminalNode = {
    id: 'cryptgreg_terminal',
    name: 'Cryptgreg Research Terminal',
    type: 'terminal',
    pos: [32, 25],
    icon: '💻',
    description: 'High-throughput intelligence terminal connecting directly to Cryptgreg Research systems, live telemetry, and the Sanctuary Beacon.'
  };
  reserve(hqTerminalNode.pos, 1);
  zoneAt(hqTerminalNode.pos).nodes.push(hqTerminalNode);

  const unlitSunShrine = {
    id: 'shrine_unlit_sun',
    name: 'Shrine of the Unlit Sun',
    type: 'long_term_quest',
    quest: 'first_flame',
    pos: [36, 46],
    icon: '🔥',
    description: 'An ancient, partially buried shrine completely shrouded in darkness. A massive black stone bowl rests at its center awaiting the First Flame.'
  };
  reserve(unlitSunShrine.pos, 2);
  zoneAt(unlitSunShrine.pos).nodes.push(unlitSunShrine);

  // A narrow north/south river and a gentler eastern tributary.
  const mainRiver = [[13, 0], [13, 5], [16, 10], [16, 14], [18, 18], [16, 23], [19, 29], [25, 35], [28, 43], [34, 51]];
  for (let i = 1; i < mainRiver.length; i++) {
    const [ax, ay] = mainRiver[i - 1], [bx, by] = mainRiver[i];
    for (let y = ay; y <= by; y++) {
      const x = Math.round(ax + (bx - ax) * (y - ay) / (by - ay));
      river.add(key([x, y]));
      river.add(key([x + 1, y]));
    }
  }
  const tributary = [[34, 20], [42, 20], [49, 23], [56, 23], [63, 26]];
  for (let i = 1; i < tributary.length; i++) {
    const [ax, ay] = tributary[i - 1], [bx, by] = tributary[i];
    for (let x = ax; x <= bx; x++) {
      const y = Math.round(ay + (by - ay) * (x - ax) / (bx - ax));
      river.add(key([x, y])); river.add(key([x, y + 1]));
    }
  }
  const ellipse = (cx, cy, rx, ry) => {
    for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) {
      if (inBounds(x, y) && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) ponds.add(key([x, y]));
    }
  };
  ellipse(5, 35, 4, 4);
  ellipse(41, 21, 2, 2);
  for (const pos of [[20, 20], [21, 20], [22, 20], [20, 21], [21, 21], [20, 22], [21, 22], [22, 22]]) ponds.add(key(pos));
  // Existing API entry points remain usable, including the old pond spawn.
  for (const zone of zones) {
    river.delete(key(zone.spawnPoint)); ponds.delete(key(zone.spawnPoint));
    for (const node of zone.nodes) { river.delete(key(node.pos)); ponds.delete(key(node.pos)); }
  }
  const water = () => new Set([...river, ...ponds]);

  const road = (points, wide = false) => {
    for (let i = 1; i < points.length; i++) {
      let [x, y] = points[i - 1];
      const [tx, ty] = points[i];
      const stamp = () => {
        paths.add(key([x, y]));
        if (wide && inBounds(x, y + 1)) paths.add(key([x, y + 1]));
      };
      stamp();
      while (x !== tx) { x += Math.sign(tx - x); stamp(); }
      while (y !== ty) { y += Math.sign(ty - y); stamp(); }
    }
  };
  road([[3, 8], [58, 8]], true);
  road([[7, 27], [58, 27]], true);
  road([[8, 41], [58, 41]], true);
  road([[8, 8], [8, 41]]);
  road([[37, 8], [37, 47]]);
  road([[58, 8], [58, 46]]);
  road([[4, 8], [4, 15], [8, 15]]);
  road([[27, 8], [27, 4]]);
  road([[45, 8], [45, 10]]);
  road([[55, 21], [55, 19], [58, 19]]);
  road([[47, 37], [45, 37], [45, 41]]);
  road([[31, 44], [32, 44], [32, 41]]);
  road([[33, 46], [37, 46]]);
  road([[58, 46], [56, 46], [56, 48]]);
  road([[56, 46], [49, 46], [49, 47]]);
  road([[8, 41], [8, 38], [7, 38]]);
  road([[32, 27], [32, 25]]);
  // Cryptgreg Research Headquarters 5x5 compound courtyard paths
  for (let x = 30; x <= 34; x++) for (let y = 22; y <= 26; y++) paths.add(key([x, y]));
  // Attach retained entry points along dry ground. In particular, preserve the
  // original pond's blocked cells while giving its old spawn a route along shore.
  const waters = water();
  for (const k of paths) if (waters.has(k)) crossings.add(k);
  for (const zone of zones.filter(z => CORE_ZONES.includes(z.id))) {
    for (const pos of [zone.spawnPoint, ...zone.nodes.filter(n => n.type !== 'landmark').map(n => n.pos)]) {
      const queue = [pos], parents = new Map([[key(pos), null]]);
      let end = null;
      for (let i = 0; i < queue.length; i++) {
        const current = queue[i];
        if (paths.has(key(current))) { end = current; break; }
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const next = [current[0] + dx, current[1] + dy], k = key(next);
          if (!inBounds(...next) || parents.has(k) || (waters.has(k) && !crossings.has(k))) continue;
          parents.set(k, current); queue.push(next);
        }
      }
      if (!end) throw new Error(`No dry connection to entry point ${pos}.`);
      for (let step = end; step; step = parents.get(key(step))) paths.add(key(step));
    }
  }
  // Group deck tiles into one drawing anchor per actual crossing.
  const pendingCrossings = new Set(crossings);
  while (pendingCrossings.size) {
    const first = pendingCrossings.values().next().value;
    const group = [first]; pendingCrossings.delete(first);
    for (let i = 0; i < group.length; i++) {
      const [x, y] = group[i].split(',').map(Number);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = key([x + dx, y + dy]);
        if (pendingCrossings.delete(k)) group.push(k);
      }
    }
    const deck = group.map(k => k.split(',').map(Number));
    const xs = deck.map(p => p[0]), ys = deck.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    bridges.push({ pos: [Math.floor((minX + maxX) / 2), Math.floor((minY + maxY) / 2)], variant: maxX - minX >= maxY - minY ? 'x' : 'y', tiles: deck });
  }

  const addProp = (type, pos, variant = 0, blocking = false) => {
    if (!inBounds(...pos)) return;
    props.push({ type, pos, variant, ...(blocking ? { blocking: true } : {}) });
    if (blocking) blocked.add(key(pos));
  };
  for (const pos of [[3, 13], [4, 13], [5, 13], [4, 14], [27, 4], [45, 7], [55, 21], [56, 21], [47, 37], [48, 37], [31, 44], [56, 46]]) blocked.add(key(pos));
  for (const pos of [[31, 23], [32, 23], [33, 23], [31, 24], [32, 24], [33, 24]]) blocked.add(key(pos));
  for (const [dx, dy] of [[-2, -1], [0, -2], [2, -1], [-2, 1], [2, 1]]) blocked.add(key([45 + dx, 7 + dy]));
  for (const [dx, dy] of [[-2, -2], [1, -2], [2, 0], [-2, 1], [0, 2]]) blocked.add(key([56 + dx, 46 + dy]));
  // Fenced farm leaves a clear entrance toward the trail.
  for (let x = 43; x <= 51; x++) {
    addProp('fence', [x, 34], 0, true);
    if (x !== 45 && x !== 46) addProp('fence', [x, 40], 0, true);
  }
  for (let y = 35; y < 40; y++) { addProp('fence', [43, y], 1, true); addProp('fence', [51, y], 1, true); }
  for (let x = 44; x <= 46; x++) for (let y = 35; y <= 36; y++) addProp('crop', [x, y], (x + y) % 3);
  for (let x = 48; x <= 50; x++) for (let y = 38; y <= 39; y++) addProp('crop', [x, y], (x + y) % 3);
  for (const pos of [[52, 21], [57, 21], [49, 39], [10, 36]]) addProp('crate', pos, 0, true);
  for (const pos of [[30, 46], [33, 44], [43, 11], [25, 6]]) addProp('bench', pos, 0, true);
  for (const pos of [[6, 16], [11, 10], [24, 7], [32, 10], [41, 11], [50, 10], [56, 18], [53, 25], [40, 30], [55, 34], [41, 40], [55, 43], [28, 43], [33, 42], [34, 46], [29, 47], [15, 30], [10, 42], [23, 40], [36, 36]]) addProp('torch', pos, 0, true);
  // Cryptgreg Research Headquarters compound perimeter features
  addProp('torch', [31, 26], 0, true);
  addProp('torch', [33, 26], 0, true);
  addProp('bench', [30, 24], 0, true);
  addProp('bench', [34, 24], 0, true);
  for (const k of blocked) paths.delete(k);
  const clearForScenery = (x, y) => inBounds(x, y) && !reserved.has(key([x, y])) && !paths.has(key([x, y])) && !waters.has(key([x, y])) && !blocked.has(key([x, y]));
  const clusters = [[3, 2, 4], [23, 1, 4], [34, 2, 4], [50, 2, 5], [60, 4, 3], [1, 23, 3], [11, 18, 3], [24, 14, 3], [32, 20, 3], [46, 18, 4], [62, 23, 3], [12, 32, 3], [21, 35, 3], [34, 32, 3], [60, 37, 3], [3, 45, 4], [17, 47, 4], [27, 50, 3], [40, 49, 4], [50, 48, 3], [62, 49, 2]];
  const candidates = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!clearForScenery(x, y)) continue;
    const density = Math.max(...clusters.map(([cx, cy, r]) => Math.max(0, 1 - Math.hypot(x - cx, y - cy) / (r + 1))));
    candidates.push({ pos: [x, y], score: density * 1.2 + random() * 0.46 });
  }
  candidates.sort((a, b) => b.score - a.score);
  for (const { pos } of candidates.slice(0, 360)) trees.add(key(pos));
  for (const { pos } of candidates.slice(360).filter(() => random() < 0.055).slice(0, 65)) rocks.add(key(pos));

  // Remove accidental pockets inside dense tree clusters; all dry ground belongs
  // to one navigable component while the river still requires real bridge tiles.
  const walkable = (x, y) => inBounds(x, y) && !blocked.has(key([x, y])) && !trees.has(key([x, y])) && !rocks.has(key([x, y])) && (!waters.has(key([x, y])) || crossings.has(key([x, y])));
  const flood = () => {
    const found = new Set(['7,8']), queue = [[7, 8]];
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = [x + dx, y + dy], k = key(next);
        if (!found.has(k) && walkable(...next)) { found.add(k); queue.push(next); }
      }
    }
    return found;
  };
  for (let pass = 0; pass < 32; pass++) {
    const reachable = flood();
    const isolated = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (walkable(x, y) && !reachable.has(key([x, y]))) isolated.push([x, y]);
    if (!isolated.length) break;
    let opened = false;
    for (const pos of isolated) {
      const visited = new Map();
      const q = [pos];
      visited.set(key(pos), null);
      let target = null;
      while (q.length > 0) {
        const curr = q.shift();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const next = [curr[0] + dx, curr[1] + dy], k = key(next);
          if (visited.has(k) || !inBounds(next[0], next[1])) continue;
          if (reachable.has(k)) {
            target = curr;
            break;
          }
          if (trees.has(k) || rocks.has(k)) {
            visited.set(k, curr);
            q.push(next);
          }
        }
        if (target) break;
      }
      if (target) {
        let curr = target;
        while (curr && (trees.has(key(curr)) || rocks.has(key(curr)))) {
          trees.delete(key(curr));
          rocks.delete(key(curr));
          opened = true;
          curr = visited.get(key(curr));
        }
      }
    }
    if (!opened) throw new Error(`World contains ${isolated.length} unreachable tiles; adjust roads or structures.`);
  }
  for (const k of waters) {
    const [x, y] = k.split(',').map(Number);
    if (crossings.has(k)) continue;
    if (random() < 0.06) addProp('lily', [x, y], Math.floor(random() * 3));
    if (ponds.has(k) && random() < 0.035) addProp('duck', [x, y]);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const pos = [x + dx, y + dy];
      if (clearForScenery(...pos) && !trees.has(key(pos)) && !rocks.has(key(pos)) && random() < 0.15) addProp('reeds', pos, Math.floor(random() * 3));
    }
  }
  for (let i = 0; i < 950; i++) {
    const pos = [Math.floor(random() * width), Math.floor(random() * height)];
    if (!clearForScenery(...pos) || trees.has(key(pos)) || rocks.has(key(pos))) continue;
    if (props.some(prop => key(prop.pos) === key(pos))) continue;
    addProp(random() < 0.75 ? 'flower' : 'mushroom', pos, Math.floor(random() * 4));
    if (props.filter(prop => prop.type === 'flower' || prop.type === 'mushroom').length >= 120) break;
  }
  for (const pos of [[25, 3], [29, 3], [26, 6], [28, 6], [24, 4], [30, 4]]) addProp('flower', pos, 2);
  for (const pos of [[10, 34], [24, 32], [52, 24], [37, 44]]) if (clearForScenery(...pos) && !trees.has(key(pos)) && !rocks.has(key(pos))) addProp('stump', pos);

  return {
    version: '2.0.0', dimensions: { width, height }, zones, obstacles: [],
    landscape: { river: coords(river), ponds: coords(ponds), river_crossings: coords(crossings), bridges, trees: coords(trees), rocks: coords(rocks), paths: coords(paths), blocked_tiles: coords(blocked), props, landmarks }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const world = generateWorld(JSON.parse(fs.readFileSync(WORLD_PATH, 'utf8')));
  fs.writeFileSync(WORLD_PATH, JSON.stringify(world, null, 2) + '\n');
  console.log(`Generated ${world.dimensions.width}x${world.dimensions.height} world: ${world.landscape.trees.length} trees, ${world.landscape.bridges.length} bridges, ${world.landscape.landmarks.length} landmarks.`);
}
