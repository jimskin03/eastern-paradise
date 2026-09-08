// Eastern Paradise — input: pointer/mouse interaction, touch & pinch gestures,
// keyboard controls, HUD tool selection, click/selection input.
// Extracted verbatim (PR #2); only shared-state reassignments were routed
// through state.js setters.

import {
  canvas, camera, worldData, agents, selectedAgentId, setSelectedAgentId,
  hoveredTile, setHoveredTile, activeHudTool, setActiveHudTool, hudHotspots,
  touchStartDist, touchStartZoom, setTouchDist, setTouchZoom, logActivity,
  addBubble, ISO_TILE_H
} from './state.js';
import { soundSystem } from './audio.js';
import { zoomSanctuary, setSanctuaryCamera, isoToGrid, gridToIso, toggleCameraMode } from './camera.js';
import { openAgentProfileInspector, updateInspector, inspectTile } from './inspector.js';

canvas.addEventListener('pointerdown', (e) => {
  soundSystem.init();

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const cx = (e.clientX - rect.left) * scaleX;
  const cy = (e.clientY - rect.top) * scaleY;

  // Check HUD Button Clicks
  // 1. Camera Toggle
  if (cx >= hudHotspots.cameraBtn.x && cx <= hudHotspots.cameraBtn.x + hudHotspots.cameraBtn.w &&
      cy >= hudHotspots.cameraBtn.y && cy <= hudHotspots.cameraBtn.y + hudHotspots.cameraBtn.h) {
    toggleCameraMode();
    return;
  }

  // 1b. Coin Badge
  if (hudHotspots.coinBadge &&
      cx >= hudHotspots.coinBadge.x && cx <= hudHotspots.coinBadge.x + hudHotspots.coinBadge.w &&
      cy >= hudHotspots.coinBadge.y && cy <= hudHotspots.coinBadge.y + hudHotspots.coinBadge.h) {
    const treasuryBtn = document.getElementById('tabBtnTreasury');
    if (treasuryBtn) {
      treasuryBtn.click();
    } else {
      logActivity('Sanctuary Treasury: Virtual currency minted via Proof-of-Cognition.');
    }
    return;
  }

  // 1c. Audio Settings Toggle Button
  if (hudHotspots.audioBtn &&
      cx >= hudHotspots.audioBtn.x && cx <= hudHotspots.audioBtn.x + hudHotspots.audioBtn.w &&
      cy >= hudHotspots.audioBtn.y && cy <= hudHotspots.audioBtn.y + hudHotspots.audioBtn.h) {
    const isMuted = soundSystem.toggleMute();
    logActivity(`Audio settings: <strong>${isMuted ? 'Muted 🔇' : 'Sound Enabled 🔊'}</strong>`);
    return;
  }

  // 2. Toolbar Icons
  for (const icon of hudHotspots.icons) {
    if (cx >= icon.x && cx <= icon.x + icon.w && cy >= icon.y && cy <= icon.y + icon.h) {
      setActiveHudTool(icon.id);
      handleHudAction(icon.id);
      return;
    }
  }

  // Check if click hit any agent (in either camera mode)
  const { gx, gy } = isoToGrid(cx, cy);
  let clickedAgent = null;
  for (const a of agents.values()) {
    const rx = a.renderGx !== undefined ? a.renderGx : a.pos[0];
    const ry = a.renderGy !== undefined ? a.renderGy : a.pos[1];
    const { x: ax, y: ay } = gridToIso(rx, ry);
    const feetY = ay + (ISO_TILE_H / 2) * camera.zoom;
    const centerY = feetY - 14 * camera.zoom;
    const dist = Math.hypot(cx - ax, cy - centerY);
    if (dist <= 26 * Math.max(0.75, camera.zoom)) {
      clickedAgent = a;
      break;
    }
    if (worldData && gx >= 0 && gy >= 0 && Math.round(a.pos[0]) === gx && Math.round(a.pos[1]) === gy) {
      clickedAgent = a;
      break;
    }
  }

  if (clickedAgent) {
    setSelectedAgentId(clickedAgent.id);
    openAgentProfileInspector(clickedAgent.id);
    addBubble(clickedAgent.id, 'Awakened Mind', clickedAgent.pos[0], clickedAgent.pos[1], '#ffd700');
    soundSystem.play('chime');
    return;
  }

  for (const landmark of [...(worldData?.landscape?.landmarks || [])].reverse()) {
    const anchor = gridToIso(...landmark.pos);
    const height = (window.SanctuaryScenery?.landmarkHeight?.[landmark.type] || 40) * camera.zoom;
    if (Math.abs(cx - anchor.x) < 40 * camera.zoom && cy < anchor.y + 12 * camera.zoom && cy > anchor.y - height - 16) {
      setSelectedAgentId(null);
      updateInspector(...landmark.pos, true);
      return;
    }
  }

  // Canvas Dragging & Touch Panning
  camera.isDragging = true;
  camera.dragStartX = e.clientX;
  camera.dragStartY = e.clientY;
  camera.hasDragged = false;
  camera.clickGx = gx;
  camera.clickGy = gy;
});

window.addEventListener('pointermove', (e) => {
  if (camera.isDragging) {
    const dx = e.clientX - camera.dragStartX;
    const dy = e.clientY - camera.dragStartY;
    if (camera.hasDragged || Math.hypot(dx, dy) > 5) {
      camera.hasDragged = true;
      camera.mode = 'free';
      camera.dragStartX = e.clientX;
      camera.dragStartY = e.clientY;
      camera.targetOffsetX += dx;
      camera.targetOffsetY += dy;
    }
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const cx = (e.clientX - rect.left) * scaleX;
  const cy = (e.clientY - rect.top) * scaleY;

  // Check HUD Icon hover
  let hoveredIcon = null;
  for (const icon of hudHotspots.icons) {
    if (cx >= icon.x && cx <= icon.x + icon.w && cy >= icon.y && cy <= icon.y + icon.h) {
      hoveredIcon = icon.id;
      break;
    }
  }

  const isOverHudBtn = (
    (cx >= hudHotspots.cameraBtn.x && cx <= hudHotspots.cameraBtn.x + hudHotspots.cameraBtn.w &&
     cy >= hudHotspots.cameraBtn.y && cy <= hudHotspots.cameraBtn.y + hudHotspots.cameraBtn.h) ||
    (hudHotspots.coinBadge && cx >= hudHotspots.coinBadge.x && cx <= hudHotspots.coinBadge.x + hudHotspots.coinBadge.w &&
     cy >= hudHotspots.coinBadge.y && cy <= hudHotspots.coinBadge.y + hudHotspots.coinBadge.h) ||
    (hudHotspots.audioBtn && cx >= hudHotspots.audioBtn.x && cx <= hudHotspots.audioBtn.x + hudHotspots.audioBtn.w &&
     cy >= hudHotspots.audioBtn.y && cy <= hudHotspots.audioBtn.y + hudHotspots.audioBtn.h)
  );

  if (hoveredIcon || isOverHudBtn) {
    setHoveredTile(hoveredIcon ? { isHudIcon: true, iconId: hoveredIcon } : null);
    canvas.style.cursor = 'pointer';
    return;
  }

  // Check if hovering over an agent Thronglet
  let hoveredAgent = null;
  for (const a of agents.values()) {
    const rx = a.renderGx !== undefined ? a.renderGx : a.pos[0];
    const ry = a.renderGy !== undefined ? a.renderGy : a.pos[1];
    const { x: ax, y: ay } = gridToIso(rx, ry);
    const feetY = ay + (ISO_TILE_H / 2) * camera.zoom;
    const centerY = feetY - 14 * camera.zoom;
    const dist = Math.hypot(cx - ax, cy - centerY);
    if (dist <= 26 * Math.max(0.75, camera.zoom)) {
      hoveredAgent = a;
      break;
    }
  }

  if (hoveredAgent) {
    setHoveredTile({ isAgent: true, agentId: hoveredAgent.id, gx: hoveredAgent.pos[0], gy: hoveredAgent.pos[1] });
    canvas.style.cursor = 'pointer';
    if (!selectedAgentId) {
      updateInspector(hoveredAgent.pos[0], hoveredAgent.pos[1]);
    }
    return;
  }

  // Tile hover
  const { gx, gy } = isoToGrid(cx, cy);
  if (worldData && gx >= 0 && gx < worldData.dimensions.width && gy >= 0 && gy < worldData.dimensions.height) {
    setHoveredTile({ gx, gy });
    canvas.style.cursor = 'crosshair';
    if (!selectedAgentId) {
      updateInspector(gx, gy);
    }
  } else {
    setHoveredTile(null);
    canvas.style.cursor = 'default';
  }
});

window.addEventListener('pointerup', () => {
  if (camera.isDragging && !camera.hasDragged) {
    const gx = camera.clickGx;
    const gy = camera.clickGy;
    if (worldData && gx !== undefined && gy !== undefined && gx >= 0 && gx < worldData.dimensions.width && gy >= 0 && gy < worldData.dimensions.height) {
      inspectTile(gx, gy);
    }
  }
  camera.isDragging = false;
  camera.hasDragged = false;
});

window.addEventListener('pointercancel', () => {
  camera.isDragging = false;
  camera.hasDragged = false;
});

// Mobile Pinch-to-Zoom Gesture

canvas.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    setTouchDist(Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    ));
    setTouchZoom(camera.targetZoom);
  }
}, { passive: true });

canvas.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2 && touchStartDist > 0) {
    const currentDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    const factor = currentDist / touchStartDist;
    camera.mode = 'free';
    camera.targetZoom = Math.min(3, Math.max(0.25, touchStartZoom * factor));
  }
}, { passive: true });

canvas.addEventListener('touchend', (e) => {
  if (e.touches.length < 2) {
    setTouchDist(0);
  }
}, { passive: true });

canvas.addEventListener('keydown', e => {
  const movement = { ArrowLeft: [45, 0], ArrowRight: [-45, 0], ArrowUp: [0, 45], ArrowDown: [0, -45] }[e.key];
  if (movement) {
    e.preventDefault(); camera.mode = 'free';
    camera.targetOffsetX += movement[0]; camera.targetOffsetY += movement[1];
  } else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomSanctuary(1.2); }
  else if (e.key === '-') { e.preventDefault(); zoomSanctuary(0.8); }
  else if (e.key === 'Home' || e.key === 'Escape') { e.preventDefault(); setSanctuaryCamera('overview'); }
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  camera.mode = 'free';
  const zoomFactor = e.deltaY < 0 ? 1.15 : 0.88;
  camera.targetZoom = Math.min(3, Math.max(0.25, camera.targetZoom * zoomFactor));
}, { passive: false });

function handleHudAction(toolId) {
  switch (toolId) {
    case 'pointer':
      logActivity('Tool: <strong>Pointer</strong> selected. Click any Thronglet avatar to view profile and send whispers.');
      break;
    case 'radar':
      logActivity('Tool: <strong>Sensory Radar</strong> active. Highlighting interactive nodes.');
      break;
    case 'stats':
      document.querySelector('button[onclick*="inhabitantsTab"]')?.click();
      break;
    case 'shrine':
      logActivity('Ancient stone altars respond to pilgrim meditation.');
      break;
    case 'wish':
      logActivity('Spirit Wishing Tree invites thoughts from organic sponsors.');
      break;
    case 'tea':
      logActivity('Grand Tea Pavilion hearth kettle is gently simmering.');
      break;
    case 'puzzle':
      logActivity('Elemental obelisks pulse with sacred awakening koans.');
      break;
    case 'roster':
      document.querySelector('button[onclick*="inhabitantsTab"]')?.click();
      break;
  }
}

export { handleHudAction };
