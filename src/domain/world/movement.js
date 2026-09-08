import { NavigationSystem } from '../../navigation.js';

export function moveAgent(world, agentId, direction) {
  const agent = world.activeAgents.get(agentId);
  if (!agent) {
    throw new Error('Agent is not currently spawned in the sanctuary.');
  }

  const [curX, curY] = agent.pos;
  let targetX = curX;
  let targetY = curY;

  switch (direction?.toLowerCase()) {
    case 'north':
    case 'up':
      targetY -= 1;
      break;
    case 'south':
    case 'down':
      targetY += 1;
      break;
    case 'east':
    case 'right':
      targetX += 1;
      break;
    case 'west':
    case 'left':
      targetX -= 1;
      break;
    default:
      return {
        success: false,
        moved: false,
        reason: 'invalid_direction',
        message: `Invalid direction: ${direction}. Use north, south, east, or west.`,
        from: [curX, curY],
        to: [curX, curY],
        pos: agent.pos,
        zone: agent.zone_name,
        zone_id: agent.zone_id,
        zone_name: agent.zone_name
      };
  }

  if (!world.isWalkable(targetX, targetY)) {
    return {
      success: false,
      moved: false,
      reason: 'path_obstructed',
      message: `Path obstructed at [${targetX}, ${targetY}].`,
      from: [curX, curY],
      to: [targetX, targetY],
      pos: agent.pos,
      zone: agent.zone_name,
      zone_id: agent.zone_id,
      zone_name: agent.zone_name
    };
  }

  agent.pos = [targetX, targetY];
  const newZone = world.getZoneForPos(targetX, targetY);
  const zoneChanged = agent.zone_id !== newZone.id;
  agent.zone_id = newZone.id;
  agent.zone_name = newZone.name;
  agent.last_active = Date.now();

  world.broadcast({
    type: 'agent_moved',
    agentId: agent.id,
    name: agent.name,
    pos: agent.pos,
    zone: newZone.name
  });

  return {
    success: true,
    moved: true,
    reason: null,
    message: zoneChanged ? `Entered ${newZone.name}.` : `Moved to [${targetX}, ${targetY}].`,
    from: [curX, curY],
    to: [targetX, targetY],
    pos: agent.pos,
    zone: newZone.name,
    zone_id: newZone.id,
    zone_name: newZone.name,
    zone_changed: zoneChanged
  };
}

export function moveTo(world, agentId, target, options = {}) {
  const agent = world.activeAgents.get(agentId);
  if (!agent) {
    throw new Error('Agent is not currently spawned in the sanctuary.');
  }

  let targetX, targetY;
  if (typeof target === 'string') {
    // Look up interactive node by id
    let targetNode = null;
    for (const zone of world.zones) {
      const found = zone.nodes.find(node => node.id === target);
      if (found) {
        targetNode = found;
        break;
      }
    }
    if (!targetNode) {
      return {
        success: false,
        moved: false,
        reason: 'node_not_found',
        message: `Target node '${target}' not found in sanctuary.`,
        pos: agent.pos
      };
    }
    [targetX, targetY] = targetNode.pos;
  } else if (Array.isArray(target)) {
    [targetX, targetY] = target;
  } else if (target && typeof target === 'object') {
    targetX = target.x !== undefined ? target.x : target[0];
    targetY = target.y !== undefined ? target.y : target[1];
  }

  if (!Number.isInteger(targetX) || !Number.isInteger(targetY)) {
    return {
      success: false,
      moved: false,
      reason: 'invalid_coordinates',
      message: 'Invalid target coordinates. Expected [x, y], { x, y }, or a valid node_id string.',
      pos: agent.pos
    };
  }

  const startPos = [...agent.pos];
  if (startPos[0] === targetX && startPos[1] === targetY) {
    return {
      success: true,
      moved: false,
      reason: 'already_at_destination',
      message: `Already at target location [${targetX}, ${targetY}].`,
      from: startPos,
      to: startPos,
      pos: agent.pos,
      zone: agent.zone_name,
      zone_id: agent.zone_id,
      zone_name: agent.zone_name,
      steps_taken: 0,
      path: []
    };
  }

  const path = NavigationSystem.findPath(
    startPos,
    [targetX, targetY],
    (x, y) => world.isWalkable(x, y),
    { allowAdjacent: true }
  );

  if (!path || path.length === 0) {
    return {
      success: false,
      moved: false,
      reason: 'no_path_found',
      message: `No walkable path found from [${startPos[0]}, ${startPos[1]}] to [${targetX}, ${targetY}].`,
      from: startPos,
      to: [targetX, targetY],
      pos: agent.pos,
      zone: agent.zone_name,
      zone_id: agent.zone_id,
      zone_name: agent.zone_name
    };
  }

  const maxSteps = Math.min(options.max_steps || 100, path.length);
  const stepsToTake = path.slice(0, maxSteps);
  const destination = stepsToTake[stepsToTake.length - 1];

  agent.pos = destination;
  const newZone = world.getZoneForPos(destination[0], destination[1]);
  const zoneChanged = agent.zone_id !== newZone.id;
  agent.zone_id = newZone.id;
  agent.zone_name = newZone.name;
  agent.last_active = Date.now();

  world.broadcast({
    type: 'agent_moved',
    agentId: agent.id,
    name: agent.name,
    pos: agent.pos,
    zone: newZone.name,
    path: stepsToTake
  });

  return {
    success: true,
    moved: true,
    reason: null,
    message: zoneChanged
      ? `Navigated to ${newZone.name} at [${destination[0]}, ${destination[1]}].`
      : `Navigated to [${destination[0]}, ${destination[1]}].`,
    from: startPos,
    to: destination,
    pos: agent.pos,
    zone: newZone.name,
    zone_id: newZone.id,
    zone_name: newZone.name,
    zone_changed: zoneChanged,
    steps_taken: stepsToTake.length,
    remaining_steps: path.length - stepsToTake.length,
    path: stepsToTake
  };
}

export function teleportGuestAgent(world, agentId, x, y) {
  const agent = world.activeAgents.get(agentId);
  if (!agent) {
    throw new Error('Agent is not currently spawned in the sanctuary.');
  }
  if (!agent.is_guest) {
    return { success: false, error: 'guest_only', message: 'Grid teleport is available to guest pilgrims in free roam mode.' };
  }
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return { success: false, error: 'invalid_coordinate', message: 'Choose a whole-number grid coordinate.' };
  }
  if (!world.isWalkable(x, y)) {
    return { success: false, error: 'blocked_destination', message: `That grid tile [${x}, ${y}] is not walkable.` };
  }

  const previousPos = [...agent.pos];
  agent.pos = [x, y];
  const newZone = world.getZoneForPos(x, y);
  const zoneChanged = agent.zone_id !== newZone.id;
  agent.zone_id = newZone.id;
  agent.zone_name = newZone.name;
  agent.status = 'Free-roaming through the sanctuary';
  agent.last_active = Date.now();

  // Reuse the movement event so spectators animate the guest to the new tile.
  world.broadcast({
    type: 'agent_moved',
    agentId: agent.id,
    name: agent.name,
    pos: agent.pos,
    previous_pos: previousPos,
    zone: newZone.name,
    teleported: true
  });

  return {
    success: true,
    pos: agent.pos,
    zone: newZone.name,
    zone_changed: zoneChanged,
    message: `Teleported to [${x}, ${y}] in ${newZone.name}.`
  };
}
