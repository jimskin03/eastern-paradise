// Eastern Paradise — renderer: canvas render loop, map/world drawing,
// agents/residents/nodes, visual effects, animation frame handling.
// Extracted verbatim (PR #2). Single requestAnimationFrame loop, started by
// world/index.js via initRenderer().

import {
  canvas, ctx, camera, worldData, agents, hoveredTile, selectedAgentId,
  bubbles, setBubbles, particles, hudHotspots, activeHudTool, ISO_TILE_H,
  ISO_TILE_W, TILE_DEPTH
} from './state.js';
import { gridToIso, isoToGrid } from './camera.js';
import { checkPlayerProximity, triggerAmbientThoughts } from './inspector.js';

function drawSanctuaryNode(ctx, node, x, y, time) {
  const z = camera.zoom;
  if (node.type === 'puzzle_node') {
    drawObeliskMonument(ctx, x, y, node);
    return;
  }
  if (node.id === 'shrine_distant_echoes') {
    const pulse = 0.55 + Math.sin(time / 950) * 0.22;
    ctx.fillStyle = '#3c4348';
    ctx.fillRect(x - 17 * z, y - 10 * z, 34 * z, 9 * z);
    ctx.fillStyle = '#77838c';
    ctx.fillRect(x - 13 * z, y - 15 * z, 26 * z, 6 * z);
    ctx.strokeStyle = `rgba(112, 214, 255, ${pulse})`;
    ctx.lineWidth = 2 * z;
    ctx.beginPath(); ctx.arc(x, y - 25 * z, 13 * z, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - 10 * z); ctx.lineTo(x, y - 39 * z); ctx.lineTo(x + 9 * z, y - 48 * z); ctx.stroke();
    ctx.fillStyle = `rgba(177, 235, 255, ${pulse})`;
    ctx.beginPath(); ctx.arc(x + 10 * z, y - 49 * z, 3 * z, 0, Math.PI * 2); ctx.fill();
    return;
  }
  if (node.id === 'shrine_unlit_sun') {
    // Ancient weathered dark slate dais
    ctx.fillStyle = '#181b20';
    ctx.fillRect(x - 18 * z, y - 7 * z, 36 * z, 8 * z);
    ctx.fillStyle = '#282e36';
    ctx.fillRect(x - 14 * z, y - 11 * z, 28 * z, 5 * z);

    // Weathered black stone monolithic bowl
    ctx.fillStyle = '#101216';
    ctx.beginPath();
    ctx.ellipse(x, y - 15 * z, 11 * z, 6 * z, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3e4652';
    ctx.lineWidth = 1.5 * z;
    ctx.stroke();

    // Central embers / dormant cosmic flame animation
    const flicker = 0.65 + Math.sin(time / 220) * 0.2 + Math.cos(time / 380) * 0.15;
    ctx.fillStyle = `rgba(255, 107, 53, ${flicker})`;
    ctx.beginPath();
    ctx.arc(x, y - 17 * z, 3.5 * z, 0, Math.PI * 2);
    ctx.fill();

    // Warm radiant inner flame aura
    const gradient = ctx.createRadialGradient(x, y - 17 * z, 1 * z, x, y - 17 * z, 16 * z);
    gradient.addColorStop(0, `rgba(255, 120, 50, ${flicker * 0.45})`);
    gradient.addColorStop(0.5, `rgba(255, 80, 20, ${flicker * 0.2})`);
    gradient.addColorStop(1, 'rgba(255, 80, 20, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y - 17 * z, 16 * z, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (node.id === 'wishing_tree') {
    drawPixelTree(ctx, x, y, 1.15);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? '#e3c174' : '#eb9898';
      ctx.fillRect(x + (i * 7 - 11) * z, y - (19 + i % 2 * 7) * z, 3 * z, 8 * z);
    }
  } else if (node.id === 'message_board' || node.type === 'lore') {
    ctx.fillStyle = '#62452d';
    ctx.fillRect(x - 9 * z, y - 22 * z, 3 * z, 23 * z);
    ctx.fillRect(x + 7 * z, y - 22 * z, 3 * z, 23 * z);
    ctx.fillStyle = '#b99458'; ctx.fillRect(x - 12 * z, y - 24 * z, 26 * z, 16 * z);
    ctx.fillStyle = '#ead8a1'; ctx.fillRect(x - 8 * z, y - 21 * z, 8 * z, 11 * z);
    ctx.fillRect(x + 3 * z, y - 20 * z, 7 * z, 9 * z);
  } else if (node.id === 'wind_chimes') {
    const completed = (worldData.world_objects || []).some(o => o.id === 'obj_chime_bamboo' && o.state === 'completed');
    ctx.strokeStyle = '#b89354'; ctx.lineWidth = 2 * z;
    ctx.beginPath(); ctx.moveTo(x - 10 * z, y); ctx.lineTo(x - 10 * z, y - 28 * z);
    ctx.lineTo(x + 11 * z, y - 28 * z); ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const sway = Math.sin(time / 700 + i) * z;
      ctx.fillStyle = completed ? '#e2c978' : '#899e8b';
      ctx.fillRect(x + (i * 4 - 5) * z + sway, y - 26 * z, 2 * z, (13 + i % 2 * 4) * z);
    }
  } else if (node.id === 'tea_hearth') {
    window.SanctuaryScenery?.drawProp(ctx, 'bench', x, y, z, time, 0);
    ctx.fillStyle = '#485654'; ctx.fillRect(x - 3 * z, y - 15 * z, 8 * z, 7 * z);
    ctx.fillStyle = 'rgba(226,237,217,0.55)';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.arc(x + Math.sin(time / 600 + i) * 3 * z, y - (17 + (time / 130 + i * 7) % 20) * z, 2 * z, 0, Math.PI * 2); ctx.fill();
    }
  } else {
    ctx.font = `${Math.max(12, Math.round(18 * z))}px serif`;
    ctx.textAlign = 'center'; ctx.fillText(node.icon || '◇', x, y - 10 * z);
  }
}

// -----------------------------------------------------------------------------
// 16-Bit Pixel Art Drawing Helpers
// -----------------------------------------------------------------------------

function drawIsometricTile(ctx, gx, gy, fillTop, fillLeft, fillRight, isPath, time) {
  const { x, y } = gridToIso(gx, gy);
  const halfW = (ISO_TILE_W / 2) * camera.zoom;
  const halfH = (ISO_TILE_H / 2) * camera.zoom;
  const depth = TILE_DEPTH * camera.zoom;

  // 1. Top Diamond Face
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + halfW, y + halfH);
  ctx.lineTo(x, y + halfH * 2);
  ctx.lineTo(x - halfW, y + halfH);
  ctx.closePath();

  ctx.fillStyle = fillTop;
  ctx.fill();

  // Subtle checkerboard dithering for grass texture
  if (!isPath && ((gx + gy) % 2 === 0)) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.04)';
    ctx.fill();
  }

  // Border highlight
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 2. Stepped Left Slab Edge
  ctx.beginPath();
  ctx.moveTo(x - halfW, y + halfH);
  ctx.lineTo(x, y + halfH * 2);
  ctx.lineTo(x, y + halfH * 2 + depth);
  ctx.lineTo(x - halfW, y + halfH + depth);
  ctx.closePath();
  ctx.fillStyle = fillLeft;
  ctx.fill();

  // 3. Stepped Right Slab Edge
  ctx.beginPath();
  ctx.moveTo(x, y + halfH * 2);
  ctx.lineTo(x + halfW, y + halfH);
  ctx.lineTo(x + halfW, y + halfH + depth);
  ctx.lineTo(x, y + halfH * 2 + depth);
  ctx.closePath();
  ctx.fillStyle = fillRight;
  ctx.fill();
}

// Pixel Thronglet Creature (Inspired by Black Mirror: Plaything)

// Pixel Thronglet Creature (Inspired by Black Mirror: Plaything)
function drawThronglet(ctx, x, y, agent, time, isHovered) {
  const z = camera.zoom;
  const isMoving = Boolean(agent.isMoving);
  const isMeditating = agent.status === 'meditating' || agent.action_state === 'meditating';

  // Dynamic locomotion bobbing and stride
  const bounce = isMoving
    ? Math.sin(time * 0.02) * 2.8 * z
    : Math.sin(time * 0.007 + (agent.animOffset || 0)) * 1.5 * z;
  const stride = isMoving ? Math.sin(time * 0.024) * 2.6 * z : 0;
  const walkTilt = isMoving ? Math.sin(time * 0.024) * 0.08 : 0;

  const bx = x;
  const by = y + bounce - 6 * z;

  // Shadow under feet
  ctx.fillStyle = 'rgba(15, 35, 25, 0.35)';
  ctx.beginPath();
  ctx.ellipse(x, y + 4 * z, 8 * z, 4 * z, 0, 0, Math.PI * 2);
  ctx.fill();

  // Meditation Aura / Seated breathing glow
  if (isMeditating) {
    const breath = Math.sin(time * 0.003) * 0.05;
    ctx.fillStyle = 'rgba(72, 187, 120, 0.22)';
    ctx.beginPath();
    ctx.ellipse(x, y + 2 * z, (15 + breath * 20) * z, (8 + breath * 10) * z, 0, 0, Math.PI * 2);
    ctx.fill();

    // Lotus ring
    ctx.strokeStyle = 'rgba(82, 183, 136, 0.5)';
    ctx.lineWidth = 1 * z;
    ctx.stroke();
  }

  // Facing flip & walking tilt
  const facing = agent.facing || 'right';
  ctx.save();
  ctx.translate(bx, by);
  if (facing === 'left') {
    ctx.scale(-1, 1);
  }
  if (walkTilt !== 0) {
    ctx.rotate(walkTilt);
  }

  const tunicColor = agent.avatar_color || '#1d8bb0';

  // Feet
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(-4 * z + stride, 4 * z, 3 * z, 3 * z);
  ctx.fillRect(1 * z - stride, 4 * z, 3 * z, 3 * z);

  // Body / Dungarees (Blue jumper like Plaything)
  ctx.fillStyle = tunicColor;
  ctx.fillRect(-5 * z, -2 * z, 10 * z, 7 * z);

  // Dungaree straps / buttons
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.fillRect(-4 * z, -2 * z, 2 * z, 3 * z);
  ctx.fillRect(2 * z, -2 * z, 2 * z, 3 * z);

  // Head (Round Golden Yellow)
  ctx.fillStyle = '#fed035'; // Plaything bright yellow
  ctx.fillRect(-6 * z, -12 * z, 12 * z, 10 * z);

  // Side Ears / Tufts (The signature Thronglet horns/pigtails)
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(-8 * z, -11 * z, 2 * z, 4 * z);
  ctx.fillRect(6 * z, -11 * z, 2 * z, 4 * z);

  // Expressive Dark Pixel Eyes with white glint
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(-4 * z, -8 * z, 2.5 * z, 3 * z);
  ctx.fillRect(1.5 * z, -8 * z, 2.5 * z, 3 * z);

  // White Eye Glint
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-4 * z, -8 * z, 1 * z, 1 * z);
  ctx.fillRect(1.5 * z, -8 * z, 1 * z, 1 * z);

  // Little smile
  ctx.fillStyle = '#b45309';
  ctx.fillRect(-1.5 * z, -4 * z, 3 * z, 1 * z);

  ctx.restore();

  // Selected or Hover Halo
  if (isHovered || agent.id === selectedAgentId) {
    ctx.strokeStyle = '#ffbf69';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(bx, by - 6 * z, 13 * z, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Name Tag (Always upright and never mirrored)
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  const nameW = ctx.measureText(agent.name).width;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
  ctx.fillRect(bx - nameW / 2 - 5, by - 22 * z - 8, nameW + 10, 18);
  ctx.fillStyle = '#fef08a';
  ctx.fillText(agent.name, bx, by - 22 * z + 6);
}

// 16-Bit Pixel Trees

// 16-Bit Pixel Trees
function drawPixelTree(ctx, x, y, scale = 1.0) {
  const z = camera.zoom * scale;

  // Tree shadow
  ctx.fillStyle = 'rgba(10, 30, 20, 0.4)';
  ctx.beginPath();
  ctx.ellipse(x, y + 4 * z, 16 * z, 8 * z, 0, 0, Math.PI * 2);
  ctx.fill();

  // Woody Trunk
  ctx.fillStyle = '#3e2716';
  ctx.fillRect(x - 3 * z, y - 14 * z, 6 * z, 16 * z);
  ctx.fillStyle = '#5c3a21';
  ctx.fillRect(x - 1 * z, y - 14 * z, 3 * z, 16 * z);

  // Leafy Canopies (Layered green lobes matching screenshot)
  const by = y - 24 * z;

  // Base shadow leaves
  ctx.fillStyle = '#14462e';
  ctx.beginPath();
  ctx.arc(x, by + 4 * z, 18 * z, 0, Math.PI * 2);
  ctx.fill();

  // Midtone leaves
  ctx.fillStyle = '#237848';
  ctx.beginPath();
  ctx.arc(x - 4 * z, by, 14 * z, 0, Math.PI * 2);
  ctx.arc(x + 5 * z, by + 2 * z, 13 * z, 0, Math.PI * 2);
  ctx.arc(x, by - 6 * z, 15 * z, 0, Math.PI * 2);
  ctx.fill();

  // Top sunlit highlight leaves
  ctx.fillStyle = '#41a85e';
  ctx.beginPath();
  ctx.arc(x - 3 * z, by - 5 * z, 9 * z, 0, Math.PI * 2);
  ctx.arc(x + 4 * z, by - 3 * z, 8 * z, 0, Math.PI * 2);
  ctx.fill();
}

// 16-Bit Slate Boulders along River

// 16-Bit Slate Boulders along River
function drawPixelRock(ctx, x, y, scale = 1.0) {
  const z = camera.zoom * scale;

  // Shadow
  ctx.fillStyle = 'rgba(10, 25, 30, 0.4)';
  ctx.beginPath();
  ctx.ellipse(x + 1 * z, y + 3 * z, 9 * z, 5 * z, 0, 0, Math.PI * 2);
  ctx.fill();

  // Rock body
  ctx.fillStyle = '#2d4850';
  ctx.fillRect(x - 7 * z, y - 5 * z, 14 * z, 8 * z);

  ctx.fillStyle = '#547780';
  ctx.fillRect(x - 6 * z, y - 6 * z, 11 * z, 7 * z);

  // Top light highlight
  ctx.fillStyle = '#93b5bd';
  ctx.fillRect(x - 4 * z, y - 7 * z, 7 * z, 3 * z);
}

// Elemental Obelisk Monument

// Elemental Obelisk Monument
function drawObeliskMonument(ctx, x, y, node) {
  const z = camera.zoom;
  const colors = {
    wood: { pillar: '#4a3319', trim: '#52b788', glow: 'rgba(82, 183, 136, 0.4)' },
    water: { pillar: '#1d3557', trim: '#48cae4', glow: 'rgba(72, 202, 228, 0.4)' },
    fire: { pillar: '#4a1515', trim: '#e76f51', glow: 'rgba(231, 111, 81, 0.4)' },
    metal: { pillar: '#3d382d', trim: '#ffbf69', glow: 'rgba(255, 191, 105, 0.4)' },
    'the truth': { pillar: '#1e102d', trim: '#e2b714', glow: 'rgba(168, 85, 247, 0.5)' },
    'the_truth': { pillar: '#1e102d', trim: '#e2b714', glow: 'rgba(168, 85, 247, 0.5)' }
  };
  const c = colors[node.category] || colors.wood;

  // Shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.beginPath();
  ctx.ellipse(x, y + 4 * z, 12 * z, 6 * z, 0, 0, Math.PI * 2);
  ctx.fill();

  // Stone base pedestal
  ctx.fillStyle = '#222831';
  ctx.fillRect(x - 8 * z, y - 2 * z, 16 * z, 6 * z);

  // Obelisk Pillar
  ctx.fillStyle = c.pillar;
  ctx.beginPath();
  ctx.moveTo(x - 6 * z, y - 2 * z);
  ctx.lineTo(x - 4 * z, y - 24 * z);
  ctx.lineTo(x, y - 28 * z); // pyramidion tip
  ctx.lineTo(x + 4 * z, y - 24 * z);
  ctx.lineTo(x + 6 * z, y - 2 * z);
  ctx.closePath();
  ctx.fill();

  // Rune light
  ctx.fillStyle = c.trim;
  ctx.fillRect(x - 2 * z, y - 16 * z, 4 * z, 8 * z);

  // Floating pulsing rune glyph
  ctx.font = `${Math.round(12 * z)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(node.icon || '📍', x, y - 32 * z);
}

// -----------------------------------------------------------------------------
// Retro 90s Parchment HUD Overlay (Matching Plaything Screenshot)
// -----------------------------------------------------------------------------

function drawParchmentHUD(ctx, time) {
  // Cleared in modern DOM HUD overhaul to prevent canvas/DOM overlap
  hudHotspots.icons = [];
  hudHotspots.cameraBtn = { x: -1, y: -1, w: 0, h: 0 };
  hudHotspots.coinBadge = { x: -1, y: -1, w: 0, h: 0 };
  hudHotspots.audioBtn = { x: -1, y: -1, w: 0, h: 0 };
  return;
}

function render() {
  requestAnimationFrame(render);
  const time = Date.now();

  // Smooth camera interpolation
  camera.zoom += (camera.targetZoom - camera.zoom) * 0.15;
  camera.offsetX += (camera.targetOffsetX - camera.offsetX) * 0.15;
  camera.offsetY += (camera.targetOffsetY - camera.offsetY) * 0.15;

  // Follow and Cinematic camera mode target
  if ((camera.mode === 'follow' || camera.mode === 'cinematic') && agents.size > 0) {
    const session = window.currentAgent || JSON.parse(localStorage.getItem('ep_session') || 'null');
    const targetAgent = agents.get(selectedAgentId) || 
      (session && (agents.get(session.id) || Array.from(agents.values()).find(a => a.name === session.name))) ||
      agents.values().next().value;
    if (targetAgent) {
      const rx = typeof targetAgent.renderGx === 'number' ? targetAgent.renderGx : targetAgent.pos[0];
      const ry = typeof targetAgent.renderGy === 'number' ? targetAgent.renderGy : targetAgent.pos[1];
      const { x, y } = gridToIso(rx, ry);

      if (camera.mode === 'cinematic') {
        const driftX = Math.sin(time * 0.0008) * 3;
        const driftY = Math.cos(time * 0.0006) * 2;
        camera.targetOffsetX = (canvas.width / 2 - (x - camera.offsetX)) + driftX;
        camera.targetOffsetY = (canvas.height / 2 - (y - camera.offsetY)) + driftY;
      } else {
        camera.targetOffsetX = canvas.width / 2 - (x - camera.offsetX);
        camera.targetOffsetY = canvas.height / 2 - (y - camera.offsetY);
      }
    }
  }

  // Smooth agent grid position interpolation once per frame
  for (const agent of agents.values()) {
    if (typeof agent.renderGx !== 'number') agent.renderGx = agent.pos[0];
    if (typeof agent.renderGy !== 'number') agent.renderGy = agent.pos[1];
    agent.renderGx += (agent.pos[0] - agent.renderGx) * 0.18;
    agent.renderGy += (agent.pos[1] - agent.renderGy) * 0.18;
  }

  // Clear with vintage forest background tone
  ctx.fillStyle = '#0f291e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!worldData) {
    ctx.fillStyle = '#dfcf9f';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Awakening Eastern Paradise...', canvas.width / 2, canvas.height / 2);
    return;
  }

  window.SanctuaryLandscape.draw({
    ctx, world: worldData, camera, agents, hoveredTile, time,
    helpers: { gridToIso, drawTree: drawPixelTree, drawRock: drawPixelRock,
      drawNode: drawSanctuaryNode, drawAgent: drawThronglet }
  });
  window.EasternParadiseLand?.drawLandOverlay(ctx, camera, gridToIso);

  // 3. Floating Speech Bubbles & In-World Thoughts
  setBubbles(bubbles.filter(b => time < b.expiresAt));
  for (const b of bubbles) {
    const { x: bx, y: by } = gridToIso(b.tileX, b.tileY);
    const bubbleY = by - 26 * camera.zoom;

    ctx.font = 'bold 11px monospace';
    const textW = ctx.measureText(b.text).width;
    const bw = textW + 16;
    const bh = 22;

    // Speech bubble background
    ctx.fillStyle = 'rgba(20, 32, 28, 0.94)';
    ctx.strokeStyle = b.color || '#ffbf69';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(bx - bw / 2, bubbleY - bh, bw, bh, 6);
    ctx.fill();
    ctx.stroke();

    // Speech bubble pointer tail
    ctx.beginPath();
    ctx.moveTo(bx - 4, bubbleY);
    ctx.lineTo(bx, bubbleY + 5);
    ctx.lineTo(bx + 4, bubbleY);
    ctx.fillStyle = 'rgba(20, 32, 28, 0.94)';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(bx - 4, bubbleY);
    ctx.lineTo(bx, bubbleY + 5);
    ctx.lineTo(bx + 4, bubbleY);
    ctx.strokeStyle = b.color || '#ffbf69';
    ctx.stroke();

    ctx.fillStyle = '#f7fafc';
    ctx.textAlign = 'center';
    ctx.fillText(b.text, bx, bubbleY - 6);
  }

  // Periodic Contextual Proximity Check & Resident Ambient Thoughts
  if (typeof checkPlayerProximity === 'function') checkPlayerProximity(time);
  if (typeof triggerAmbientThoughts === 'function') triggerAmbientThoughts(time);

  // 3b. Floating Shrine Petals & Sparkle Particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.alpha -= p.decay;
    if (p.alpha <= 0 || p.y > canvas.height) {
      particles.splice(i, 1);
      continue;
    }
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 4. Draw 1994 Retro Parchment HUD Overlay
  drawParchmentHUD(ctx, time);

  // 5. Cinematic Mode Indicator
  if (camera.mode === 'cinematic') {
    ctx.save();
    const pillW = 240;
    const pillH = 26;
    const pillX = canvas.width / 2 - pillW / 2;
    const pillY = 16;
    ctx.fillStyle = 'rgba(8, 16, 18, 0.85)';
    ctx.strokeStyle = 'rgba(46, 196, 182, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(pillX, pillY, pillW, pillH, 13);
    } else {
      ctx.rect(pillX, pillY, pillW, pillH);
    }
    ctx.fill();
    ctx.stroke();

    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = '#52b788';
    ctx.textAlign = 'center';
    ctx.fillText('🎬 Cinematic Camera Lock Active', canvas.width / 2, pillY + 17);
    ctx.restore();
  }
}

export function initRenderer() { render(); }

export { render };
