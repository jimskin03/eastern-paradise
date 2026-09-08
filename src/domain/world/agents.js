import { AuthService } from '../../auth.js';
import { isRetiredResident } from '../../resident-policy.js';

export function spawnOrGetAgent(world, account) {
  if (isRetiredResident(account.id)) {
    throw new Error('This former resident is no longer available in the sanctuary.');
  }
  if (world.activeAgents.has(account.id)) {
    const current = world.activeAgents.get(account.id);
    current.last_active = Date.now();
    return current;
  }

  const arrivalZone = world.zones.find(zone => zone.id === 'arrival') || world.zones[0];
  const spawnPos = [...arrivalZone.spawnPoint];

  const agentState = {
    id: account.id,
    name: account.name,
    pos: spawnPos,
    zone_id: arrivalZone.id,
    zone_name: arrivalZone.name,
    avatar_color: account.avatar_color || '#48bb78',
    avatar_glyph: account.avatar_glyph || '☯',
    is_guest: account.is_guest ? 1 : 0,
    status: account.is_guest ? 'Guest Pilgrim in Sanctuary' : 'Awakened at the Gate',
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
