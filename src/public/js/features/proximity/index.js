// Proximity Banner Handlers
export function handleProxInspect() {
  if (window.currentProxNode) {
        window.openPuzzleModal(window.currentProxNode.id, 'inspect');
  }
}
export function handleProxAction() {
  if (!window.currentProxNode) return;
  const n = window.currentProxNode;
  if (n.type === 'puzzle_node') {
        window.openPuzzleModal(n.id, 'solve');
  } else if (n.id === 'message_board') {
        window.openConsoleDrawer('boardTab');
  } else if (n.id === 'wind_chimes' || n.id === 'wishing_tree') {
        window.openConsoleDrawer('journalTab');
  } else {
        window.openAgentProfileInspector('resident_ailicia');
  }
}
