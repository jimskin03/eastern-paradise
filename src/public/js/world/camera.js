// Eastern Paradise — world camera: pan, zoom, focus, overview, free camera,
// viewport transforms and coordinate conversion. Extracted verbatim (PR #2).

import {
  camera, canvas, worldData, ISO_TILE_W, ISO_TILE_H, TILE_DEPTH, logActivity
} from './state.js';

function gridToIso(gx, gy) {
  const sx = camera.offsetX + (gx - gy) * (ISO_TILE_W / 2) * camera.zoom;
  const sy = camera.offsetY + (gx + gy) * (ISO_TILE_H / 2) * camera.zoom;
  return { x: sx, y: sy };
}

function isoToGrid(screenX, screenY) {
  const adjX = (screenX - camera.offsetX) / camera.zoom;
  const adjY = (screenY - camera.offsetY) / camera.zoom;
  const gx = Math.round((adjX / (ISO_TILE_W / 2) + adjY / (ISO_TILE_H / 2)) / 2);
  const gy = Math.round((adjY / (ISO_TILE_H / 2) - adjX / (ISO_TILE_W / 2)) / 2);
  return { gx, gy };
}

// Camera Modes & Terrarium Auto-Fit
function fitTerrariumCamera() {
  if (camera.mode !== 'overview' || !worldData) return;
  const { width, height } = worldData.dimensions;
  const left = -(height - 1) * ISO_TILE_W / 2 - 30;
  const right = (width - 1) * ISO_TILE_W / 2 + 30;
  const bottom = (width + height) * ISO_TILE_H / 2 + TILE_DEPTH;
  const z = Math.min((canvas.width - 80) / (right - left), (canvas.height - 145) / (bottom + 60));
  camera.targetZoom = z;
  camera.targetOffsetX = (canvas.width - (left + right) * z) / 2;
  camera.targetOffsetY = 85 + (canvas.height - 115 - (bottom + 60) * z) / 2 + 60 * z;
}

function setSanctuaryCamera(mode) {
  camera.mode = mode;
  camera.isDragging = false;
  if (mode === 'overview') fitTerrariumCamera();
  if (mode === 'free') canvas.style.cursor = 'grab';
}

function zoomSanctuary(factor) {
  const oldZoom = camera.targetZoom;
  const newZoom = Math.min(3, Math.max(0.25, oldZoom * factor));
  const ratio = newZoom / oldZoom;
  camera.mode = 'free';
  camera.targetOffsetX = canvas.width / 2 - (canvas.width / 2 - camera.targetOffsetX) * ratio;
  camera.targetOffsetY = canvas.height / 2 - (canvas.height / 2 - camera.targetOffsetY) * ratio;
  camera.targetZoom = newZoom;
}

function toggleSanctuaryExpanded() {
  const expanded = document.getElementById('spectatorTab').classList.toggle('expanded-map');
  const button = document.getElementById('btnExpandMap');
  button.textContent = expanded ? 'Show inspector' : 'Expand map';
  button.setAttribute('aria-pressed', String(expanded));
  if (camera.mode === 'overview') fitTerrariumCamera();
}

function toggleCameraMode() {
  if (camera.mode === 'overview') {
    camera.mode = 'free';
    zoomSanctuary(1.4);
    logActivity('Camera set to <strong>Free Pan & Zoom</strong> (Drag to pan, wheel to zoom).');
  } else if (camera.mode === 'free') {
    camera.mode = 'follow';
    logActivity('Camera set to <strong>Follow Active Thronglet</strong>.');
  } else {
    camera.mode = 'overview';
    fitTerrariumCamera();
    logActivity('Camera set to <strong>Terrarium Overview</strong>.');
  }
}

function updateCanvasDimensions() {
  const isMobile = window.innerWidth <= 900;
  let targetW = 1440;
  let targetH = 810; // 16:9 widescreen desktop
  if (isMobile) {
    targetW = 720;
    targetH = Math.round(720 * (19 / 6)); // 2280 (19:6 mobile format)
  }
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
    if (camera.mode === 'overview') {
      fitTerrariumCamera();
      camera.zoom = camera.targetZoom;
      camera.offsetX = camera.targetOffsetX;
      camera.offsetY = camera.targetOffsetY;
    }
  }
}
window.addEventListener('resize', updateCanvasDimensions);


// -----------------------------------------------------------------------------
// Main Render Loop
// -----------------------------------------------------------------------------

window.addEventListener('resize', updateCanvasDimensions);

export { gridToIso, isoToGrid, fitTerrariumCamera, setSanctuaryCamera, zoomSanctuary, toggleSanctuaryExpanded, toggleCameraMode, updateCanvasDimensions };
