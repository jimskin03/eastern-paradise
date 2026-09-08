import {
  removeAgent,
  spawnOrGetAgent,
  tickAmbientWandering
} from './domain/world/agents.js';
import { broadcast, onEvent } from './domain/world/events.js';
import { moveAgent, moveTo, teleportGuestAgent } from './domain/world/movement.js';
import { getAllEntitiesForSpectator, getState } from './domain/world/projection.js';
import { interact } from './domain/world/interactions.js';
import { WORLD_CONFIG } from './domain/world/config.js';
import {
  buildSpatialSets,
  getAllNodes,
  getZone,
  getZoneForPos,
  isWalkable
} from './domain/world/geometry.js';

export class WorldEngine {
  constructor(config = WORLD_CONFIG) {
    this.config = config;
    this.width = config.dimensions.width;
    this.height = config.dimensions.height;
    this.zones = config.zones;
    this.obstacles = config.obstacles || [];
    this.landscape = config.landscape || {};
    const spatialSets = buildSpatialSets(this.landscape);
    this.waterTiles = spatialSets.waterTiles;
    this.bridgeTiles = spatialSets.bridgeTiles;
    this.blockedTiles = spatialSets.blockedTiles;
    
    // In-memory active agent states: agentId -> agentState
    this.activeAgents = new Map();
    this.listeners = new Set();
  }

  onEvent(listener) {
    return onEvent(this, listener);
  }

  broadcast(event) {
    return broadcast(this, event);
  }

  getZoneForPos(x, y) {
    return getZoneForPos(this, x, y);
  }

  getZone(identifier) {
    return getZone(this, identifier);
  }

  getAllNodes() {
    return getAllNodes(this);
  }

  isWalkable(x, y) {
    return isWalkable(this, x, y);
  }

  spawnOrGetAgent(account) {
    return spawnOrGetAgent(this, account);
  }

  removeAgent(agentId, purgeIfGuest = true) {
    return removeAgent(this, agentId, purgeIfGuest);
  }

  tickAmbientWandering() {
    return tickAmbientWandering(this);
  }

  getState(agentId) {
    return getState(this, agentId);
  }

  moveAgent(agentId, direction) {
    return moveAgent(this, agentId, direction);
  }

  moveTo(agentId, target, options = {}) {
    return moveTo(this, agentId, target, options);
  }

  teleportGuestAgent(agentId, x, y) {
    return teleportGuestAgent(this, agentId, x, y);
  }

  interact(agentId, nodeId, action = 'inspect', payload = {}) {
    return interact(this, agentId, nodeId, action, payload);
  }

  getAllEntitiesForSpectator() {
    return getAllEntitiesForSpectator(this);
  }
}

export const world = new WorldEngine();
