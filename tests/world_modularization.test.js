import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AuthService } from '../src/auth.js';
import { db } from '../src/db.js';
import { PuzzleManager } from '../src/puzzles.js';
import { ProjectManager } from '../src/projects.js';
import { RETIRED_RESIDENT_IDS } from '../src/resident-policy.js';
import * as worldModule from '../src/world.js';

const { WorldEngine } = worldModule;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PUBLIC_METHODS = [
  'broadcast',
  'getAllEntitiesForSpectator',
  'getAllNodes',
  'getState',
  'getZone',
  'getZoneForPos',
  'interact',
  'isWalkable',
  'moveAgent',
  'moveTo',
  'onEvent',
  'removeAgent',
  'spawnOrGetAgent',
  'teleportGuestAgent',
  'tickAmbientWandering'
];

const PUBLIC_PROPERTIES = [
  'activeAgents',
  'blockedTiles',
  'bridgeTiles',
  'config',
  'height',
  'landscape',
  'listeners',
  'obstacles',
  'waterTiles',
  'width',
  'zones'
];

function createConfig() {
  return {
    dimensions: { width: 6, height: 5 },
    zones: [
      {
        id: 'arrival_zone',
        name: 'Gate of Arrival',
        subtitle: 'First steps',
        bounds: { minX: 0, maxX: 2, minY: 0, maxY: 4 },
        spawnPoint: [2, 3],
        nodes: [{
          id: 'test_node',
          name: 'Test Node',
          type: 'lore',
          pos: [2, 3],
          icon: '◇',
          description: 'A test node.'
        }]
      },
      {
        id: 'tea-pavilion',
        name: 'Grand Tea Pavilion',
        subtitle: 'A second zone',
        bounds: { minX: 3, maxX: 5, minY: 0, maxY: 4 },
        spawnPoint: [3, 3],
        nodes: [{
          id: 'target_node',
          name: 'Target Node',
          type: 'scenic',
          pos: [5, 4],
          icon: '◈',
          description: 'A target node.'
        }]
      }
    ],
    obstacles: [{ x: 4, y: 0, w: 1, h: 2 }],
    landscape: {
      river: [[1, 1]],
      ponds: [[2, 1]],
      river_crossings: [[2, 1]],
      trees: [[1, 0]],
      rocks: [[0, 1]],
      blocked_tiles: [[1, 2]],
      props: [{ pos: [2, 2], blocking: true }]
    }
  };
}

function createOpenConfig() {
  const config = createConfig();
  config.obstacles = [];
  config.landscape = {};
  return config;
}

test('WorldEngine facade preserves public API, public state, and per-instance ownership', () => {
  const first = new WorldEngine(createConfig());
  const second = new WorldEngine(createConfig());

  assert.deepEqual(Object.keys(worldModule).sort(), ['WorldEngine', 'world']);
  assert.deepEqual(
    Object.getOwnPropertyNames(WorldEngine.prototype).filter(name => name !== 'constructor').sort(),
    PUBLIC_METHODS
  );
  assert.deepEqual(Object.keys(first).sort(), PUBLIC_PROPERTIES);
  assert.ok(first.activeAgents instanceof Map);
  assert.ok(first.listeners instanceof Set);
  assert.ok(first.waterTiles instanceof Set);
  assert.notEqual(first.activeAgents, second.activeAgents);
  assert.notEqual(first.listeners, second.listeners);
  assert.notEqual(first.waterTiles, second.waterTiles);
  assert.notEqual(first.bridgeTiles, second.bridgeTiles);
  assert.notEqual(first.blockedTiles, second.blockedTiles);
});

test('world dependency graph has no circular imports', () => {
  const sourceRoot = path.join(repositoryRoot, 'src');
  const sourceFiles = fs.readdirSync(sourceRoot, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
    .map(entry => path.join(entry.parentPath, entry.name));
  const sourceSet = new Set(sourceFiles.map(file => path.normalize(file)));
  const graph = new Map();
  const importPattern = /^import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"];?/gm;

  for (const file of sourceFiles) {
    const imports = [];
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(importPattern)) {
      if (!match[1].startsWith('.')) continue;
      const resolved = path.normalize(path.resolve(path.dirname(file), match[1]));
      if (sourceSet.has(resolved)) imports.push(resolved);
    }
    graph.set(path.normalize(file), imports);
  }

  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  const visit = file => {
    if (visiting.has(file)) {
      const cycleStart = stack.indexOf(file);
      const cycle = [...stack.slice(cycleStart), file]
        .map(item => path.relative(repositoryRoot, item).replaceAll('\\', '/'));
      assert.fail(`Circular import detected: ${cycle.join(' -> ')}`);
    }
    if (visited.has(file)) return;
    visiting.add(file);
    stack.push(file);
    for (const dependency of graph.get(file) || []) visit(dependency);
    stack.pop();
    visiting.delete(file);
    visited.add(file);
  };

  const auditRoots = [
    'src/world.js',
    'src/puzzles.js',
    'src/projects.js',
    'src/board.js',
    'src/auth.js',
    'src/navigation.js',
    'src/residents.js',
    'src/server.js',
    'src/realtime/world-websocket.js'
  ];
  for (const root of auditRoots) visit(path.normalize(path.join(repositoryRoot, root)));

  for (const file of sourceFiles.filter(file => file.includes(`${path.sep}domain${path.sep}world${path.sep}`))) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /from\s+['"][^'"]*world\.js['"]/, path.relative(repositoryRoot, file));
  }
});

test('geometry preserves zones, normalized lookup, node projection, and collision rules', () => {
  const world = new WorldEngine(createConfig());

  assert.equal(world.width, 6);
  assert.equal(world.height, 5);
  assert.equal(world.getZoneForPos(4, 4).id, 'tea-pavilion');
  assert.equal(world.getZoneForPos(99, 99).id, 'arrival_zone');
  assert.equal(world.getZone('  GRAND_tea-pavilion ').id, 'tea-pavilion');
  assert.equal(world.getZone('missing'), null);
  assert.deepEqual(world.getAllNodes().map(node => node.id), ['test_node', 'target_node']);

  for (const coordinates of [[-1, 0], [6, 0], [0, 5], [1.5, 1], [Number.NaN, 0]]) {
    assert.equal(world.isWalkable(...coordinates), false);
  }
  assert.equal(world.isWalkable(1, 0), false, 'tree');
  assert.equal(world.isWalkable(0, 1), false, 'rock');
  assert.equal(world.isWalkable(1, 1), false, 'water');
  assert.equal(world.isWalkable(2, 1), true, 'bridge over water');
  assert.equal(world.isWalkable(1, 2), false, 'blocked tile');
  assert.equal(world.isWalkable(2, 2), false, 'blocking prop');
  assert.equal(world.isWalkable(4, 0), false, 'obstacle rectangle');
  assert.equal(world.isWalkable(5, 4), true);
});

test('events and agent lifecycle preserve subscription, spawn, removal, and ambient semantics', () => {
  const world = new WorldEngine(createOpenConfig());
  const events = [];
  const unsubscribe = world.onEvent(event => events.push(event));

  const account = { id: 'world_module_agent', name: 'Module Agent' };
  const spawned = world.spawnOrGetAgent(account);
  const firstLastActive = spawned.last_active;
  assert.deepEqual(spawned.pos, [2, 3]);
  assert.equal(world.spawnOrGetAgent(account), spawned);
  assert.ok(spawned.last_active >= firstLastActive);
  assert.equal(events[0].type, 'agent_spawned');
  assert.throws(
    () => world.spawnOrGetAgent({ id: RETIRED_RESIDENT_IDS[0], name: 'Retired' }),
    /former resident/
  );

  const originalPurgeGuest = AuthService.purgeGuest;
  const purged = [];
  AuthService.purgeGuest = agentId => purged.push(agentId);
  try {
    world.spawnOrGetAgent({ id: 'guest_world_module', name: 'Guest', is_guest: true });
    world.removeAgent('guest_world_module', false);
    assert.deepEqual(purged, []);
    world.spawnOrGetAgent({ id: 'guest_world_module_purge', name: 'Guest Purge', is_guest: true });
    world.removeAgent('guest_world_module_purge');
    assert.deepEqual(purged, ['guest_world_module_purge']);
    assert.ok(events.some(event => event.type === 'agent_left'));
    assert.ok(events.some(event => event.type === 'board_updated'));
  } finally {
    AuthService.purgeGuest = originalPurgeGuest;
  }

  const errors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => errors.push(args);
  const healthyEvents = [];
  const stopFailing = world.onEvent(() => { throw new Error('listener failed'); });
  const stopHealthy = world.onEvent(event => healthyEvents.push(event));
  try {
    world.broadcast({ type: 'listener_test' });
    assert.equal(healthyEvents.length, 1);
    assert.equal(errors.length, 1);
    assert.equal(stopHealthy(), true);
    world.broadcast({ type: 'after_unsubscribe' });
    assert.equal(healthyEvents.length, 1);
  } finally {
    stopFailing();
    console.error = originalConsoleError;
  }

  const dummy = {
    id: 'dummy_agent', name: 'Dummy', pos: [3, 3], zone_id: 'tea-pavilion',
    zone_name: 'Grand Tea Pavilion', is_dummy: true, last_active: 0
  };
  const realVisitor = {
    id: 'real_agent', name: 'Real', pos: [3, 3], zone_id: 'tea-pavilion',
    zone_name: 'Grand Tea Pavilion', last_active: 0
  };
  const resident = {
    id: 'resident_agent', name: 'Resident', pos: [3, 3], zone_id: 'tea-pavilion',
    zone_name: 'Grand Tea Pavilion', is_dummy: true, is_resident: true, last_active: 0
  };
  world.activeAgents.set(dummy.id, dummy);
  world.activeAgents.set(realVisitor.id, realVisitor);
  world.activeAgents.set(resident.id, resident);

  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    world.tickAmbientWandering();
  } finally {
    Math.random = originalRandom;
  }
  assert.deepEqual(dummy.pos, [3, 2]);
  assert.deepEqual(realVisitor.pos, [3, 3]);
  assert.deepEqual(resident.pos, [3, 3]);
  assert.equal(dummy.status, 'Wandering gently in the meadow');
  assert.ok(events.some(event => event.type === 'agent_moved' && event.ambient === true));
  assert.equal(unsubscribe(), true);
});

test('movement preserves aliases, result shapes, pathing, max steps, and guest teleport', () => {
  const world = new WorldEngine(createOpenConfig());
  const agent = world.spawnOrGetAgent({ id: 'movement_agent', name: 'Mover' });

  const aliases = new Map([
    ['north', [2, 1]], ['up', [2, 1]],
    ['south', [2, 3]], ['down', [2, 3]],
    ['east', [3, 2]], ['right', [3, 2]],
    ['west', [1, 2]], ['left', [1, 2]]
  ]);
  for (const [direction, expected] of aliases) {
    agent.pos = [2, 2];
    agent.zone_id = 'arrival_zone';
    agent.zone_name = 'Gate of Arrival';
    const result = world.moveAgent(agent.id, direction);
    assert.equal(result.success, true, direction);
    assert.deepEqual(result.from, [2, 2], direction);
    assert.deepEqual(result.to, expected, direction);
  }

  agent.pos = [2, 2];
  const invalid = world.moveAgent(agent.id, 'diagonal');
  assert.deepEqual(
    { success: invalid.success, moved: invalid.moved, reason: invalid.reason },
    { success: false, moved: false, reason: 'invalid_direction' }
  );

  world.obstacles.push({ x: 2, y: 1, w: 1, h: 1 });
  const obstructed = world.moveAgent(agent.id, 'north');
  assert.equal(obstructed.reason, 'path_obstructed');
  world.obstacles.length = 0;

  agent.pos = [2, 2];
  agent.zone_id = 'arrival_zone';
  const zoneTransition = world.moveAgent(agent.id, 'east');
  assert.equal(zoneTransition.zone_changed, true);
  assert.equal(zoneTransition.zone_id, 'tea-pavilion');

  agent.pos = [2, 3];
  agent.zone_id = 'arrival_zone';
  const partial = world.moveTo(agent.id, 'target_node', { max_steps: 1 });
  assert.equal(partial.success, true);
  assert.equal(partial.steps_taken, 1);
  assert.ok(partial.remaining_steps > 0);
  assert.equal(partial.path.length, 1);

  const coordinateMove = world.moveTo(agent.id, [4, 4]);
  assert.equal(coordinateMove.success, true);
  const indexedObjectMove = world.moveTo(agent.id, { 0: 5, 1: 4 });
  assert.equal(indexedObjectMove.success, true);
  const alreadyThere = world.moveTo(agent.id, [...agent.pos]);
  assert.equal(alreadyThere.reason, 'already_at_destination');
  assert.deepEqual(alreadyThere.path, []);
  assert.equal(world.moveTo(agent.id, {}).reason, 'invalid_coordinates');
  assert.equal(world.moveTo(agent.id, 'missing_node').reason, 'node_not_found');

  const trappedConfig = createOpenConfig();
  trappedConfig.obstacles = [
    { x: 1, y: 0, w: 1, h: 1 },
    { x: 0, y: 1, w: 1, h: 1 }
  ];
  trappedConfig.zones[0].spawnPoint = [0, 0];
  const trappedWorld = new WorldEngine(trappedConfig);
  const trapped = trappedWorld.spawnOrGetAgent({ id: 'trapped', name: 'Trapped' });
  assert.equal(trappedWorld.moveTo(trapped.id, [5, 4]).reason, 'no_path_found');

  const nonGuestTeleport = world.teleportGuestAgent(agent.id, 5, 4);
  assert.equal(nonGuestTeleport.error, 'guest_only');
  const guest = world.spawnOrGetAgent({ id: 'teleport_guest', name: 'Guest', is_guest: true });
  assert.equal(world.teleportGuestAgent(guest.id, 1.5, 2).error, 'invalid_coordinate');
  world.obstacles.push({ x: 0, y: 0, w: 1, h: 1 });
  assert.equal(world.teleportGuestAgent(guest.id, 0, 0).error, 'blocked_destination');
  const movementEvents = [];
  world.onEvent(event => movementEvents.push(event));
  const teleported = world.teleportGuestAgent(guest.id, 5, 4);
  assert.equal(teleported.success, true);
  assert.equal(teleported.zone_changed, true);
  assert.equal(guest.status, 'Free-roaming through the sanctuary');
  assert.ok(movementEvents.some(event => event.teleported === true && Array.isArray(event.previous_pos)));
});

test('state, interactions, and spectator projection preserve external contracts', () => {
  ProjectManager.init();
  const world = new WorldEngine();
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const agentId = `world_contract_${suffix}`;
  const account = {
    id: agentId,
    name: `World Contract ${suffix}`,
    email: `${suffix}@example.com`,
    avatar_color: '#123456',
    avatar_glyph: '◉',
    verified: 1,
    created_at: Date.now()
  };
  db.prepare(`
    INSERT INTO accounts (id, name, email, avatar_color, avatar_glyph, verified, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(account.id, account.name, account.email, account.avatar_color, account.avatar_glyph, account.verified, account.created_at);
  db.prepare(`
    INSERT INTO profiles (agent_id, karma, balance, total_earned, solved_count, titles, solved_puzzles, last_seen)
    VALUES (?, 0, 100, 0, 0, '["Novice"]', '[]', ?)
  `).run(agentId, Date.now());

  const events = [];
  world.onEvent(event => events.push(event));
  const agent = world.spawnOrGetAgent(account);

  try {
    const nearby = {
      id: 'nearby_contract_agent', name: 'Nearby', pos: [8, 8], zone_id: 'arrival',
      zone_name: 'Gate of Arrival', avatar_color: '#abcdef', avatar_glyph: '◇', status: 'Nearby'
    };
    world.activeAgents.set(nearby.id, nearby);
    const state = world.getState(agentId);
    assert.deepEqual(Object.keys(state).sort(), ['agent', 'current_zone', 'inbox', 'surroundings']);
    assert.deepEqual(Object.keys(state.inbox).sort(), ['check_recommended', 'oldest_unread_at', 'unread_count']);
    assert.ok(state.surroundings.visible_agents.some(other => other.id === nearby.id && other.distance === 1));
    assert.ok(state.surroundings.interactive_nodes.length > 0);
    assert.ok(Array.isArray(state.surroundings.available_directions));

    const nodes = world.getAllNodes();
    const byType = type => nodes.find(node => node.type === type);

    const lore = world.interact(agentId, byType('lore').id);
    assert.equal(lore.success, true);
    assert.equal(lore.lore.length, 4);

    const shrine = byType('shrine');
    assert.match(world.interact(agentId, shrine.id).action_hint, /wish/);
    agent.pos = [...shrine.pos];
    assert.match(world.interact(agentId, shrine.id, 'wish', { text: '  Peace  ' }).message, /"Peace"/);

    const melody = byType('melody');
    const melodyResult = world.interact(agentId, melody.id);
    assert.equal(melodyResult.success, true);
    assert.ok(events.some(event => event.type === 'sound_event'));

    const board = world.interact(agentId, byType('message_board').id);
    assert.equal(board.success, true);
    assert.ok(Array.isArray(board.board.recent_messages));

    const mirror = world.interact(agentId, byType('mirror').id);
    assert.equal(mirror.reflection.agent_name, account.name);
    assert.deepEqual(mirror.reflection.titles, ['Novice']);

    const customizer = byType('customizer');
    agent.pos = [0, 0];
    assert.equal(world.interact(agentId, customizer.id, 'customize', { color: '#ffffff' }).error_code, 'TOO_FAR_FROM_NODE');
    agent.pos = [...customizer.pos];
    assert.equal(world.interact(agentId, customizer.id, 'customize', { color: '#fedcba', glyph: '☆' }).success, true);
    const customized = db.prepare('SELECT avatar_color, avatar_glyph FROM accounts WHERE id = ?').get(agentId);
    assert.deepEqual({ ...customized }, { avatar_color: '#fedcba', avatar_glyph: '☆' });
    assert.ok(events.some(event => event.type === 'agent_customized'));

    const puzzleNode = nodes.find(node => node.id === 'trial_obelisk_wood');
    agent.pos = [...puzzleNode.pos];
    const challenge = world.interact(agentId, puzzleNode.id, 'inspect');
    assert.ok(challenge.challenge_id);
    assert.match(challenge.action_hint, /challenge_id/);
    const wrong = world.interact(agentId, puzzleNode.id, 'solve', {
      answer: 'definitely incorrect', challengeId: challenge.challenge_id, requestId: `wrong_${suffix}`
    });
    assert.equal(wrong.success, false);
    const answer = PuzzleManager.getPuzzleForNode(puzzleNode.id, puzzleNode.category).answer;
    const requestId = `solve_${suffix}`;
    const solved = world.interact(agentId, puzzleNode.id, 'solve', {
      solution: answer, challenge_id: challenge.challenge_id, request_id: requestId
    });
    assert.equal(solved.success, true);
    const repeated = world.interact(agentId, puzzleNode.id, 'solve', {
      text: answer, challengeId: challenge.challenge_id, requestId
    });
    assert.equal(repeated.idempotent, true);
    assert.equal(events.filter(event => event.type === 'puzzle_solved').length, 1);

    const truth = world.interact(agentId, 'trial_obelisk_truth', 'inspect');
    assert.equal(truth.locked, true);
    assert.ok(truth.requirement.required_solved > 0);
    assert.ok(truth.requirement.required_merit > 0);

    const scenic = world.interact(agentId, byType('scenic').id);
    assert.equal(scenic.success, true);
    assert.ok(Array.isArray(scenic.celestial_view.travelers));

    const defaultNode = nodes.find(node => node.type === 'landmark' || node.type === 'rest');
    const defaultResult = world.interact(agentId, defaultNode.id);
    assert.equal(defaultResult.description, defaultNode.description);

    world.activeAgents.set('resident_projection', {
      id: 'resident_projection', name: 'Resident Projection', pos: [7, 8],
      zone_name: 'Gate of Arrival', status: 'Reflecting', is_resident: true,
      role: 'Keeper', aspiration: 'Harmony', public_intent: 'Listen', needs: { energy: 80 }
    });
    const spectator = world.getAllEntitiesForSpectator();
    assert.deepEqual(Object.keys(spectator), ['agents', 'zones', 'obstacles', 'landscape', 'world_objects', 'dimensions']);
    assert.deepEqual(spectator.dimensions, { width: world.width, height: world.height });
    const residentProjection = spectator.agents.find(projected => projected.id === 'resident_projection');
    assert.deepEqual(
      {
        is_resident: residentProjection.is_resident,
        role: residentProjection.role,
        aspiration: residentProjection.aspiration,
        public_intent: residentProjection.public_intent,
        needs: residentProjection.needs
      },
      {
        is_resident: true,
        role: 'Keeper',
        aspiration: 'Harmony',
        public_intent: 'Listen',
        needs: { energy: 80 }
      }
    );
  } finally {
    world.activeAgents.delete(agentId);
    db.prepare('DELETE FROM interaction_logs WHERE agent_id = ?').run(agentId);
    db.prepare('DELETE FROM transactions WHERE sender_id = ? OR recipient_id = ?').run(agentId, agentId);
    db.prepare('DELETE FROM profiles WHERE agent_id = ?').run(agentId);
    db.prepare('DELETE FROM accounts WHERE id = ?').run(agentId);
  }
});
