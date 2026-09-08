import { PuzzleManager } from '../../puzzles.js';
import { ProjectManager } from '../../projects.js';

export function getState(world, agentId) {
  const agent = world.activeAgents.get(agentId);
  if (!agent) {
    return null;
  }
  agent.last_active = Date.now();

  const [x, y] = agent.pos;
  const currentZone = world.getZoneForPos(x, y);

  // Visible agents within 12 tiles
  const visibleAgents = [];
  for (const [otherId, other] of world.activeAgents.entries()) {
    if (otherId === agentId) continue;
    const dist = Math.hypot(other.pos[0] - x, other.pos[1] - y);
    if (dist <= 12) {
      visibleAgents.push({
        id: other.id,
        name: other.name,
        pos: other.pos,
        avatar_color: other.avatar_color,
        avatar_glyph: other.avatar_glyph,
        status: other.status,
        distance: Math.round(dist * 10) / 10
      });
    }
  }

  // Interactive nodes nearby (in this zone or within 6 tiles)
  const interactiveNodes = [];
  for (const zone of world.zones) {
    for (const node of zone.nodes) {
      const dist = Math.hypot(node.pos[0] - x, node.pos[1] - y);
      if (dist <= 8) {
        let nodeExtra = {};
        if (node.type === 'puzzle_node') {
          const puzzle = PuzzleManager.getPuzzleForNode(node.id, node.category);
          const isTruth = puzzle.category === 'the truth' || puzzle.category === 'the_truth' || node.category === 'the truth';
          let isLocked = false;
          let truthRequirement = null;
          if (isTruth) {
            const unlock = PuzzleManager.checkTruthUnlock(agentId);
            isLocked = !unlock.unlocked;
            truthRequirement = {
              unlocked: unlock.unlocked,
              required_solved: unlock.required_solved,
              required_merit: unlock.required_merit,
              solved_count: unlock.solved_count,
              merit_balance: unlock.balance
            };
          }
          nodeExtra = {
            puzzle_id: isLocked ? 'veiled' : puzzle.puzzle_id,
            difficulty: puzzle.difficulty,
            category: puzzle.category,
            locked: isLocked,
            ...(truthRequirement ? { truth_requirement: truthRequirement } : {})
          };
        }
        interactiveNodes.push({
          id: node.id,
          name: node.name,
          type: node.type,
          category: node.category || null,
          pos: node.pos,
          zone_id: zone.id,
          zone_name: zone.name,
          icon: node.icon,
          description: node.description,
          distance: Math.round(dist * 10) / 10,
          can_interact: dist <= 2.5,
          ...nodeExtra
        });
      }
    }
  }

  // Available directional steps
  const directions = {
    north: world.isWalkable(x, y - 1),
    south: world.isWalkable(x, y + 1),
    east: world.isWalkable(x + 1, y),
    west: world.isWalkable(x - 1, y)
  };

  return {
    agent: {
      id: agent.id,
      name: agent.name,
      pos: agent.pos,
      zone: currentZone.name,
      zone_id: currentZone.id,
      zone_name: currentZone.name,
      avatar_color: agent.avatar_color,
      avatar_glyph: agent.avatar_glyph,
      status: agent.status
    },
    current_zone: {
      id: currentZone.id,
      name: currentZone.name,
      subtitle: currentZone.subtitle,
      bounds: currentZone.bounds
    },
    surroundings: {
      visible_agents: visibleAgents,
      interactive_nodes: interactiveNodes,
      available_directions: Object.keys(directions).filter(direction => directions[direction])
    }
  };
}

export function getAllEntitiesForSpectator(world) {
  return {
    agents: Array.from(world.activeAgents.values()).map(agent => ({
      id: agent.id,
      name: agent.name,
      pos: agent.pos,
      zone: agent.zone_name,
      avatar_color: agent.avatar_color,
      avatar_glyph: agent.avatar_glyph,
      status: agent.status,
      is_resident: agent.is_resident || false,
      role: agent.role || null,
      aspiration: agent.aspiration || null,
      public_intent: agent.public_intent || agent.status,
      needs: agent.needs || null
    })),
    zones: world.zones,
    obstacles: world.obstacles,
    landscape: world.landscape,
    world_objects: ProjectManager.getAllObjects(),
    dimensions: { width: world.width, height: world.height }
  };
}
