// Eastern Paradise — spectator.js has been modularized (PR #2).
// The world subsystem now lives in native ES modules under /js/world/
// (state, audio, camera, websocket, inspector, input, renderer, quests),
// bootstrapped by /js/world/index.js, which index.html loads directly
// (replacing the former <script src="/spectator.js"> tag).
// This file is kept only as a historical pointer shim; it is NOT loaded.
