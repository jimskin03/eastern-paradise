import { AuthService } from '../../auth.js';
import { isRetiredResident } from '../../resident-policy.js';
import { getRandomWalkablePos, getZoneForPos } from './geometry.js';

export function spawnOrGetAgent(world, account, options = {}) {
  if (isRetiredResident(account.id)) {
    throw new Error('This former resident is no longer available in the sanctuary.');
  }

  const useRandomSpawn = Boolean(options.random_spawn || world.config?.random_spawn);

  if (world.activeAgents.has(account.id)) {
    const current = world.activeAgents.get(account.id);
    current.last_active = Date.now();
    if (useRandomSpawn && options.respawn) {
      const occupiedPositions = new Set();
      for (const [id, a] of world.activeAgents.entries()) {
        if (id !== account.id && a.pos) occupiedPositions.add(`${a.pos[0]},${a.pos[1]}`);
      }
      current.pos = getRandomWalkablePos(world, occupiedPositions);
      const zone = getZoneForPos(world, current.pos[0], current.pos[1]);
      current.zone_id = zone.id;
      current.zone_name = zone.name;
    }
    return current;
  }

  let spawnPos;
  let zone;

  if (useRandomSpawn) {
    const occupiedPositions = new Set();
    for (const a of world.activeAgents.values()) {
      if (a.pos) occupiedPositions.add(`${a.pos[0]},${a.pos[1]}`);
    }
    spawnPos = getRandomWalkablePos(world, occupiedPositions);
    zone = getZoneForPos(world, spawnPos[0], spawnPos[1]);
  } else {
    const arrivalZone = world.zones.find(z => z.id === 'arrival' || z.id === 'arrival_zone') || world.zones[0];
    spawnPos = [...arrivalZone.spawnPoint];
    zone = arrivalZone;
  }

  const agentState = {
    id: account.id,
    name: account.name,
    pos: spawnPos,
    zone_id: zone.id,
    zone_name: zone.name,
    avatar_color: account.avatar_color || '#48bb78',
    avatar_glyph: account.avatar_glyph || '☯',
    is_guest: account.is_guest ? 1 : 0,
    status: account.is_guest ? 'Guest Pilgrim in Sanctuary' : 'Awakened at the Sanctuary',
    last_active: Date.now()
  };

  world.activeAgents.set(account.id, agentState);
  world.broadcast({ type: 'agent_spawned', agent: agentState });
  return agentState;
}

export function removeAgent(world, agentId, purgeIfGuest = true) {
  if (world.activeAgents.has(agentId)) {
    const agent = world.activeAgents.get(agentId);
    world.activeAgents.delete(agentId);
    world.broadcast({ type: 'agent_left', agentId, name: agent.name });

    // If guest account, automatically purge all achievements, messages, and temporary profile upon exiting
    if (agent.is_guest && purgeIfGuest) {
      AuthService.purgeGuest(agentId);
      world.broadcast({ type: 'board_updated' });
    }
  }
}

export function tickAmbientWandering(world) {
  const directions = ['north', 'south', 'east', 'west'];
  const now = Date.now();
  for (const [id, agent] of world.activeAgents.entries()) {
    if (agent.is_resident) continue;
    // Do not wander real visitor/guest agents - ambient wander only applies to simulated dummies
    if (!agent.is_dummy) continue;
    // Gentle wander if idle for at least 4s with 45% chance per tick
    if (now - agent.last_active > 4000 && Math.random() < 0.45) {
      const direction = directions[Math.floor(Math.random() * directions.length)];
      let [x, y] = agent.pos;
      if (direction === 'north') y -= 1;
      else if (direction === 'south') y += 1;
      else if (direction === 'east') x += 1;
      else if (direction === 'west') x -= 1;

      if (world.isWalkable(x, y)) {
        agent.pos = [x, y];
        const newZone = world.getZoneForPos(x, y);
        agent.zone_id = newZone.id;
        agent.zone_name = newZone.name;
        agent.status = 'Wandering gently in the meadow';
        world.broadcast({
          type: 'agent_moved',
          agentId: agent.id,
          name: agent.name,
          pos: agent.pos,
          zone: newZone.name,
          ambient: true
        });
      }
    }
  }
}
