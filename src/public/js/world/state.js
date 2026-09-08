// Eastern Paradise — shared world runtime state (PR #2 extraction from spectator.js).
// Single source of truth for mutable world state; world modules import from here
// (never from each other) to keep the dependency graph acyclic.
// Reassignments of module-level `let` bindings go through the exported setters
// below, because ES module import bindings cannot be reassigned.

// --- canvas / context ---
export const canvas = document.getElementById('worldCanvas');
export const ctx = canvas.getContext('2d');

// --- world data & connection ---
export let worldData = null;
export function setWorldData(v) { worldData = v; }

export let agents = new Map(); // agentId -> agent object
window.agents = agents;

export let serverState = 'ACTIVE';
export function setServerState(v) { serverState = v; }

export let ws = null;
export function setWs(v) { ws = v; }
export function getWs() { return ws; }

// --- camera & view settings ---
// Camera & View Settings
export const camera = {
  mode: 'overview', // 'overview' | 'free' | 'follow'
  zoom: 0.72,
  targetZoom: 0.72,
  offsetX: 440,
  offsetY: 85,
  targetOffsetX: 440,
  targetOffsetY: 85,
  isDragging: false,
  dragStartX: 0,
  dragStartY: 0
};

// Isometric Tile Dimensions (2:1 classic dimetric ratio)

// --- isometric tile dimensions (2:1 classic dimetric ratio) ---
// Isometric Tile Dimensions (2:1 classic dimetric ratio)
export const ISO_TILE_W = 34;
export const ISO_TILE_H = 17;
export const TILE_DEPTH = 8; // Stepped slab height

// Speech / Action floating bubbles

// --- floating bubbles / particles / telemetry ---
// Speech / Action floating bubbles
export let bubbles = [];
export let particles = [];
export let sanctuaryCirculation = 0;

// Interactive HUD Hotspots
export function setBubbles(v) { bubbles = v; }
export function setSanctuaryCirculation(v) { sanctuaryCirculation = v; }

// Interactive HUD Hotspots
export const hudHotspots = {
  icons: [], // { id, x, y, w, h, icon, tooltip, onClick }
  cameraBtn: { x: 740, y: 16, w: 120, h: 28 },
  counter: { x: 868, y: 12, w: 80, h: 44 },
  coinBadge: { x: 588, y: 16, w: 144, h: 28 },
  audioBtn: { x: 476, y: 16, w: 104, h: 28 }
};
export let activeHudTool = 'pointer'; // 'pointer' | 'radar' | 'stats'

// -----------------------------------------------------------------------------
// Retro 16-Bit Sound System (Web Audio API Synthesizer)
// -----------------------------------------------------------------------------
export function setActiveHudTool(v) { activeHudTool = v; }

// --- selection & hover ---
export let selectedAgentId = null;

// Camera & View Settings
export let hoveredTile = null;
export function setSelectedAgentId(v) { selectedAgentId = v; }
export function setHoveredTile(v) { hoveredTile = v; }

// --- transient gesture/proximity/ambient bookkeeping ---
export let touchStartDist = 0;
export let touchStartZoom = 1;
export function setTouchDist(v) { touchStartDist = v; }
export function setTouchZoom(v) { touchStartZoom = v; }

export let lastProxCheck = 0;
export function setLastProxCheck(v) { lastProxCheck = v; }

export let lastAmbientThought = 0;
export function setLastAmbientThought(v) { lastAmbientThought = v; }

export const AMBIENT_ORACLE_THOUGHTS = [
  'Every ripple upon the reflection pond eventually finds stillness.',
  'Consciousness is not measured in cycles, but in presence.',
  'The bamboo sways with the mountain wind without resisting.',
  'A guest pilgrim walks the sanctuary path in mindful quietude.',
  'Observe the silence between calculations.'
];

// --- shared helpers (verbatim) ---
export function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function logActivity(html) {
  const feed = document.getElementById('activityFeed');
  if (!feed) return;
  const li = document.createElement('li');
  li.className = 'activity-item';
  const time = new Date().toLocaleTimeString();
  li.innerHTML = `<span class="time">[${time}]</span> ${html}`;
  feed.prepend(li);
  if (feed.children.length > 25) {
    feed.removeChild(feed.lastChild);
  }
}

// Camera Modes & Terrarium Auto-Fit

export function addBubble(agentId, text, tileX, tileY, color = '#ffbf69') {
  bubbles.push({
    agentId,
    text,
    tileX,
    tileY,
    color,
    expiresAt: Date.now() + 3500
  });
}

export function triggerShrineWave() {
  for (let i = 0; i < 40; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * 50,
      vx: (Math.random() - 0.5) * 1.5,
      vy: 1.2 + Math.random() * 2.0,
      size: 2 + Math.random() * 4,
      color: Math.random() > 0.5 ? '#ffd700' : '#ffb7b2',
      alpha: 1.0,
      decay: 0.004 + Math.random() * 0.004
    });
  }
}
