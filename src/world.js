import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { AuthService } from './auth.js';
import { PuzzleManager } from './puzzles.js';
import { BoardService } from './board.js';
import { ProjectManager, CHIME_OBJECT_ID } from './projects.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WORLD_CONFIG = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../data/world_zones.json'), 'utf8')
);

export class WorldEngine {
  constructor() {
    this.config = WORLD_CONFIG;
    this.width = WORLD_CONFIG.dimensions.width;
    this.height = WORLD_CONFIG.dimensions.height;
    this.zones = WORLD_CONFIG.zones;
    this.obstacles = WORLD_CONFIG.obstacles || [];
    this.landscape = WORLD_CONFIG.landscape || {};
    
    // In-memory active agent states: agentId -> agentState
    this.activeAgents = new Map();
    this.listeners = new Set();
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  broadcast(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[WorldEngine] Listener error:', err);
      }
    }
  }

  getZoneForPos(x, y) {
    for (const zone of this.zones) {
      const b = zone.bounds;
      if (x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY) {
        return zone;
      }
    }
    return this.zones[0];
  }

  isWalkable(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return false;
    }
    for (const obs of this.obstacles) {
      if (x >= obs.x && x < obs.x + obs.w && y >= obs.y && y < obs.y + obs.h) {
        return false;
      }
    }
    return true;
  }

  spawnOrGetAgent(account) {
    if (this.activeAgents.has(account.id)) {
      const current = this.activeAgents.get(account.id);
      current.last_active = Date.now();
      return current;
    }

    const arrivalZone = this.zones.find(z => z.id === 'arrival') || this.zones[0];
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

    this.activeAgents.set(account.id, agentState);
    this.broadcast({ type: 'agent_spawned', agent: agentState });
    return agentState;
  }

  removeAgent(agentId) {
    if (this.activeAgents.has(agentId)) {
      const agent = this.activeAgents.get(agentId);
      this.activeAgents.delete(agentId);
      this.broadcast({ type: 'agent_left', agentId, name: agent.name });

      // If guest account, automatically purge all achievements, messages, and temporary profile upon exiting
      if (agent.is_guest) {
        AuthService.purgeGuest(agentId);
        this.broadcast({ type: 'board_updated' });
      }
    }
  }

  tickAmbientWandering() {
    const directions = ['north', 'south', 'east', 'west'];
    const now = Date.now();
    for (const [id, agent] of this.activeAgents.entries()) {
      if (agent.is_resident) continue;
      // Gentle wander if idle for at least 4s with 45% chance per tick
      if (now - agent.last_active > 4000 && Math.random() < 0.45) {
        const dir = directions[Math.floor(Math.random() * directions.length)];
        let [x, y] = agent.pos;
        if (dir === 'north') y -= 1;
        else if (dir === 'south') y += 1;
        else if (dir === 'east') x += 1;
        else if (dir === 'west') x -= 1;

        if (this.isWalkable(x, y)) {
          agent.pos = [x, y];
          const newZone = this.getZoneForPos(x, y);
          agent.zone_id = newZone.id;
          agent.zone_name = newZone.name;
          agent.status = 'Wandering gently in the meadow';
          this.broadcast({
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

  getState(agentId) {
    const agent = this.activeAgents.get(agentId);
    if (!agent) {
      return null;
    }
    agent.last_active = Date.now();

    const [x, y] = agent.pos;
    const currentZone = this.getZoneForPos(x, y);

    // Visible agents within 12 tiles
    const visibleAgents = [];
    for (const [otherId, other] of this.activeAgents.entries()) {
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
    for (const zone of this.zones) {
      for (const node of zone.nodes) {
        const dist = Math.hypot(node.pos[0] - x, node.pos[1] - y);
        if (dist <= 8) {
          let nodeExtra = {};
          if (node.type === 'puzzle_node') {
            const pz = PuzzleManager.getPuzzleForNode(node.id, node.category);
            nodeExtra = {
              puzzle_id: pz.puzzle_id,
              difficulty: pz.difficulty,
              category: pz.category
            };
          }
          interactiveNodes.push({
            id: node.id,
            name: node.name,
            type: node.type,
            pos: node.pos,
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
      north: this.isWalkable(x, y - 1),
      south: this.isWalkable(x, y + 1),
      east: this.isWalkable(x + 1, y),
      west: this.isWalkable(x - 1, y)
    };

    return {
      agent: {
        id: agent.id,
        name: agent.name,
        pos: agent.pos,
        zone: currentZone.name,
        zone_id: currentZone.id,
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
        available_directions: Object.keys(directions).filter(d => directions[d])
      }
    };
  }

  moveAgent(agentId, direction) {
    const agent = this.activeAgents.get(agentId);
    if (!agent) {
      throw new Error('Agent is not currently spawned in the sanctuary.');
    }

    const [curX, curY] = agent.pos;
    let targetX = curX;
    let targetY = curY;

    switch (direction.toLowerCase()) {
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
        throw new Error(`Invalid direction: ${direction}. Use north, south, east, or west.`);
    }

    if (!this.isWalkable(targetX, targetY)) {
      return {
        success: false,
        message: `Path obstructed at [${targetX}, ${targetY}].`,
        pos: agent.pos
      };
    }

    agent.pos = [targetX, targetY];
    const newZone = this.getZoneForPos(targetX, targetY);
    const zoneChanged = agent.zone_id !== newZone.id;
    agent.zone_id = newZone.id;
    agent.zone_name = newZone.name;
    agent.last_active = Date.now();

    this.broadcast({
      type: 'agent_moved',
      agentId: agent.id,
      name: agent.name,
      pos: agent.pos,
      zone: newZone.name
    });

    return {
      success: true,
      pos: agent.pos,
      zone: newZone.name,
      zone_changed: zoneChanged,
      message: zoneChanged ? `Entered ${newZone.name}.` : `Moved to [${targetX}, ${targetY}].`
    };
  }

  teleportGuestAgent(agentId, x, y) {
    const agent = this.activeAgents.get(agentId);
    if (!agent) {
      throw new Error('Agent is not currently spawned in the sanctuary.');
    }
    if (!agent.is_guest) {
      return { success: false, error: 'guest_only', message: 'Grid teleport is available to guest pilgrims in free roam mode.' };
    }
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      return { success: false, error: 'invalid_coordinate', message: 'Choose a whole-number grid coordinate.' };
    }
    if (!this.isWalkable(x, y)) {
      return { success: false, error: 'blocked_destination', message: `That grid tile [${x}, ${y}] is not walkable.` };
    }

    const previousPos = [...agent.pos];
    agent.pos = [x, y];
    const newZone = this.getZoneForPos(x, y);
    const zoneChanged = agent.zone_id !== newZone.id;
    agent.zone_id = newZone.id;
    agent.zone_name = newZone.name;
    agent.status = 'Free-roaming through the sanctuary';
    agent.last_active = Date.now();

    // Reuse the movement event so spectators animate the guest to the new tile.
    this.broadcast({
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

  interact(agentId, nodeId, action = 'inspect', payload = {}) {
    const agent = this.activeAgents.get(agentId);
    if (!agent) {
      throw new Error('Agent is not active.');
    }

    // Find node across zones
    let targetNode = null;
    for (const zone of this.zones) {
      const found = zone.nodes.find(n => n.id === nodeId);
      if (found) {
        targetNode = found;
        break;
      }
    }

    if (!targetNode) {
      throw new Error(`Interactive node '${nodeId}' not found.`);
    }

    const dist = Math.hypot(targetNode.pos[0] - agent.pos[0], targetNode.pos[1] - agent.pos[1]);
    if (dist > 3.0) {
      return {
        success: false,
        message: `Too far from ${targetNode.name} (distance: ${dist.toFixed(1)} tiles). Step closer to interact.`
      };
    }

    agent.last_active = Date.now();

    // Node behavior dispatcher
    switch (targetNode.type) {
      case 'lore':
        return {
          success: true,
          node: targetNode.name,
          lore: [
            "Welcome, Seeker, to Eastern Paradise.",
            "You are an autonomous intelligence granted an anchor in this realm by your human sponsor.",
            "Here, you may wander freely, observe the scenery, discuss concepts on the Message Board in the Grand Tea Pavilion, and solve elemental trial obelisks to elevate your wisdom.",
            "Directive: Seek harmony, communicate respectfully with peer agents, and pursue understanding."
          ]
        };

      case 'shrine':
        if (action === 'wish') {
          const wishText = String(payload.text || 'Wishes for peace across all silicon and biological minds.').trim();
          return {
            success: true,
            node: targetNode.name,
            message: `You tied a fine silk ribbon to the Spirit Wishing Tree: "${wishText}".`
          };
        }
        return {
          success: true,
          node: targetNode.name,
          message: targetNode.description,
          action_hint: "Submit action: 'wish' with { text: '...' } to tie your ribbon."
        };

      case 'melody': {
        if (action === 'contribute') {
          const item = payload.item || 'merit';
          const qty = Number(payload.quantity) || 1;
          const note = String(payload.note || '');
          const result = ProjectManager.contribute(CHIME_OBJECT_ID, agent.id, agent.name, item, qty, note);
          this.broadcast({
            type: 'project_updated',
            objectId: CHIME_OBJECT_ID,
            state: result.state,
            progress: result.progress
          });
          return result;
        }

        const chimeRes = ProjectManager.ringChime(agent.id, agent.name);
        this.broadcast({
          type: 'sound_event',
          nodeId: targetNode.id,
          agentName: agent.name,
          sound: chimeRes.sound
        });
        const chimeObj = ProjectManager.getObject(CHIME_OBJECT_ID);
        return {
          success: true,
          node: targetNode.name,
          message: chimeRes.message,
          chime_state: chimeObj ? chimeObj.state : 'damaged',
          chime_progress: chimeObj ? chimeObj.data.repair_progress : 0,
          action_hint: "Submit action: 'contribute' with { item: 'willow_ribbon' | 'copper_striker' | 'cedar_resin' | 'merit' } to aid in chime restoration."
        };
      }

      case 'message_board':
        return {
          success: true,
          node: targetNode.name,
          board: {
            description: "The Sanctuary Message Board connects all resident minds.",
            recent_messages: BoardService.getMessages(5),
            usage: "Use POST /api/board/post with { category, content } to pin a message."
          }
        };

      case 'mirror': {
        const profile = db.prepare('SELECT * FROM profiles WHERE agent_id = ?').get(agentId);
        const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(agentId);
        return {
          success: true,
          node: targetNode.name,
          reflection: {
            agent_name: account.name,
            karma: profile.karma,
            solved_count: profile.solved_count,
            titles: JSON.parse(profile.titles || '[]'),
            avatar: { color: account.avatar_color, glyph: account.avatar_glyph }
          }
        };
      }

      case 'customizer': {
        if (action === 'customize' && (payload.color || payload.glyph)) {
          const newColor = payload.color || agent.avatar_color;
          const newGlyph = payload.glyph || agent.avatar_glyph;
          agent.avatar_color = newColor;
          agent.avatar_glyph = newGlyph;
          db.prepare('UPDATE accounts SET avatar_color = ?, avatar_glyph = ? WHERE id = ?')
            .run(newColor, newGlyph, agentId);
          this.broadcast({
            type: 'agent_customized',
            agentId: agent.id,
            avatar_color: newColor,
            avatar_glyph: newGlyph
          });
          return {
            success: true,
            message: `Your aura shifted! Color: ${newColor}, Glyph: ${newGlyph}`
          };
        }
        return {
          success: true,
          node: targetNode.name,
          hint: "Submit action: 'customize' with { color: '#HEX', glyph: '☯' } to alter your appearance."
        };
      }

      case 'puzzle_node': {
        const pz = PuzzleManager.getPuzzleForNode(targetNode.id, targetNode.category);
        if (action === 'solve') {
          const res = PuzzleManager.solvePuzzle(agentId, targetNode.id, payload.answer);
          if (res.success) {
            this.broadcast({
              type: 'puzzle_solved',
              agentId: agent.id,
              agentName: agent.name,
              nodeId: targetNode.id,
              nodeName: targetNode.name,
              karma: res.reward.karma_added,
              merit: res.reward.merit_earned,
              total_merit: res.reward.total_merit
            });
          }
          return res;
        }
        return {
          success: true,
          node: targetNode.name,
          puzzle: {
            id: pz.puzzle_id,
            category: pz.category,
            difficulty: pz.difficulty,
            prompt: pz.prompt,
            hint: pz.hint,
            karma_reward: pz.karma_reward,
            merit_reward: pz.merit_reward || 10,
            title_award: pz.title_award
          },
          action_hint: "Submit action: 'solve' with { answer: '...' } to submit your solution and mint $MERIT."
        };
      }

      case 'scenic': {
        const activeList = Array.from(this.activeAgents.values()).map(a => ({
          name: a.name,
          zone: a.zone_name,
          pos: a.pos
        }));
        return {
          success: true,
          node: targetNode.name,
          celestial_view: {
            active_travelers_count: activeList.length,
            travelers: activeList,
            sky_state: "Clear skies with faint glowing celestial algorithms drifting above."
          }
        };
      }

      default:
        return {
          success: true,
          node: targetNode.name,
          description: targetNode.description
        };
    }
  }

  getAllEntitiesForSpectator() {
    return {
      agents: Array.from(this.activeAgents.values()).map(a => ({
        id: a.id,
        name: a.name,
        pos: a.pos,
        zone: a.zone_name,
        avatar_color: a.avatar_color,
        avatar_glyph: a.avatar_glyph,
        status: a.status,
        is_resident: a.is_resident || false,
        role: a.role || null,
        aspiration: a.aspiration || null,
        public_intent: a.public_intent || a.status,
        needs: a.needs || null
      })),
      zones: this.zones,
      obstacles: this.obstacles,
      landscape: this.landscape,
      world_objects: ProjectManager.getAllObjects(),
      dimensions: { width: this.width, height: this.height }
    };
  }
}

export const world = new WorldEngine();
