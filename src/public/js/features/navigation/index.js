export function openConsoleDrawer(tabId = 'consoleTab', btn = null) {
  const drawer = document.getElementById('consoleDrawer');
  const backdrop = document.getElementById('drawerBackdrop');
  if (drawer) drawer.classList.add('open');
  if (backdrop) backdrop.classList.add('open');
   switchDrawerTab(tabId);
   // Sync top header navigation
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  if (btn) {
    btn.classList.add('active');
  } else {
    const headerBtn = document.querySelector(`.tab-btn[onclick*="${tabId}"]`);
    if (headerBtn) headerBtn.classList.add('active');
  }
}
export function closeConsoleDrawer() {
  const drawer = document.getElementById('consoleDrawer');
  const backdrop = document.getElementById('drawerBackdrop');
  if (drawer) drawer.classList.remove('open');
  if (backdrop) backdrop.classList.remove('open');
   document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  const specBtn = document.querySelector('.tab-btn[onclick*="spectatorTab"]');
  if (specBtn) specBtn.classList.add('active');
}
export function toggleConsoleDrawer() {
  const drawer = document.getElementById('consoleDrawer');
  if (drawer && drawer.classList.contains('open')) {
    closeConsoleDrawer();
  } else {
    openConsoleDrawer('consoleTab');
  }
}
export function switchDrawerTab(tabId, btn = null) {
  document.querySelectorAll('.drawer-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.drawer-tab-btn').forEach(el => el.classList.remove('active'));
   const pane = document.getElementById(tabId);
  if (pane) pane.classList.add('active');
   const b = btn || document.querySelector(`.drawer-tab-btn[onclick*="${tabId}"]`);
  if (b) b.classList.add('active');
  if (tabId === 'journalTab' && typeof window.refreshJournal === 'function') window.refreshJournal();
  if (tabId === 'boardTab' && typeof window.refreshBoard === 'function') window.refreshBoard();
  if (tabId === 'inhabitantsTab' && typeof window.refreshInhabitants === 'function') window.refreshInhabitants();
  if (tabId === 'consoleTab' && typeof window.refreshAgentState === 'function') window.refreshAgentState();
  if (tabId === 'treasuryTab' && typeof window.refreshTreasury === 'function') window.refreshTreasury();
}
export function switchTab(tabId, btn) {
  if (tabId === 'spectatorTab') {
    closeConsoleDrawer();
    setPlayerMode('spectate');
    return;
  }
  openConsoleDrawer(tabId, btn);
}
export function setPlayerMode(mode) {
  document.querySelectorAll('.btn-mode').forEach(b => b.classList.remove('active'));
  const btnMap = {
    spectate: document.getElementById('btnModeSpectate'),
    guest: document.getElementById('btnModeGuest'),
    dispatch: document.getElementById('btnModeDispatch')
  };
  if (btnMap[mode]) btnMap[mode].classList.add('active');
   if (mode === 'spectate') {
    closeConsoleDrawer();
        if (typeof window.setSanctuaryCamera === 'function') window.setSanctuaryCamera('overview');
  } else if (mode === 'guest') {
    if (!window.currentAgent) {
      window.uiGuestLogin();
    } else {
      focusPlayer();
    }
  } else if (mode === 'dispatch') {
    window.openDispatchModal();
  }
}
export function focusPlayer() {
  if (!window.currentAgent) return;
  const myName = window.currentAgent.name;
  let targetAgent = null;
  if (window.agents) {
    for (const a of window.agents.values()) {
      if (a.name === myName || a.id === window.currentAgent.id) {
        targetAgent = a;
        break;
      }
    }
  }
  if (targetAgent && typeof window.gridToIso === 'function') {
    if (window.camera) {
      window.camera.mode = 'follow';
      window.selectedAgentId = targetAgent.id;
      window.camera.targetZoom = 1.4;
    }
  }
}
