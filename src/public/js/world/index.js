// Eastern Paradise — world subsystem bootstrap (PR #2).
// The former 2,479-line spectator.js monolith is now focused native ES modules.
// This file wires the subsystems together, installs the legacy window.*
// compatibility surface (previously implicit globals of the classic script),
// and boots the world in the original order: feed hydration -> WebSocket ->
// single render loop.

import * as state from './state.js';
import soundSystem from './audio.js';
import {
  gridToIso, isoToGrid, fitTerrariumCamera, setSanctuaryCamera, zoomSanctuary,
  toggleSanctuaryExpanded, toggleCameraMode, updateCanvasDimensions
} from './camera.js';
import { initWebSocket } from './websocket.js';
import * as inspector from './inspector.js';
import { handleHudAction } from './input.js';
import { initRenderer } from './renderer.js';
import { QuestManager } from './quests.js';

// ---- legacy window.* compatibility surface ----
window.agents = state.agents;
window.soundSystem = soundSystem;
window.zoomSanctuary = zoomSanctuary;
window.setSanctuaryCamera = setSanctuaryCamera;
window.toggleSanctuaryExpanded = toggleSanctuaryExpanded;
window.toggleCameraMode = toggleCameraMode;
window.updateCanvasDimensions = updateCanvasDimensions;
window.gridToIso = gridToIso;
window.isoToGrid = isoToGrid;
window.fitTerrariumCamera = fitTerrariumCamera;
window.focusAilicia = inspector.focusAilicia;
window.focusNearestObelisk = inspector.focusNearestObelisk;
window.focusTruthMonolith = inspector.focusTruthMonolith;
window.openAgentProfileInspector = inspector.openAgentProfileInspector;
window.openInspectorModal = inspector.openInspectorModal;
window.closeInspectorModal = inspector.closeInspectorModal;
window.handleInspectorBackdropClick = inspector.handleInspectorBackdropClick;
window.clearSelectedAgent = inspector.clearSelectedAgent;
window.inspectAgentFromRoster = inspector.inspectAgentFromRoster;
window.submitWhisperToAgent = inspector.submitWhisperToAgent;
window.checkPlayerProximity = inspector.checkPlayerProximity;
window.triggerAmbientThoughts = inspector.triggerAmbientThoughts;
window.handleHudAction = handleHudAction;
window.QuestManager = QuestManager;

// ---- boot (original ordering from spectator.js) ----
initWebSocket();
initRenderer();
QuestManager.updateHud();
