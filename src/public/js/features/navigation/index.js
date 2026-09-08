const TAB_BUTTON_MAP = {
  consoleTab: 'tabBtnConsole',
  journalTab: 'tabBtnJournal',
  boardTab: 'tabBtnBoard',
  inhabitantsTab: 'tabBtnInhabitants',
  treasuryTab: 'tabBtnTreasury',
  manualTab: 'tabBtnManual'
};

const TAB_TITLES = {
  consoleTab: 'Sanctuary Systems & Console',
  journalTab: 'The Sanctuary Journal',
  boardTab: 'The Grand Tea Pavilion Notice Board',
  inhabitantsTab: 'Sanctuary Inhabitants (Verified Tethered Agents)',
  treasuryTab: 'Sanctuary Treasury & Bazaar',
  manualTab: 'Autonomous Agent Manual & Protocol',
  dispatchTab: 'Dispatch AI Agent to Eastern Paradise',
  feedTab: 'Live Activity & Energy'
};

function syncMenuButtons(tabId) {
  document.querySelectorAll('.floating-map-bar button[id^="tabBtn"]').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  const btnId = TAB_BUTTON_MAP[tabId];
  if (btnId) {
    const btn = document.getElementById(btnId);
    if (btn) btn.classList.add('active');
  }
}

export function openConsoleDrawer(tabId = 'consoleTab', btn = null) {
  const drawer = document.getElementById('consoleDrawer');
  const backdrop = document.getElementById('drawerBackdrop');
  
  // Toggle closed if clicking the currently open tab
  if (drawer && drawer.classList.contains('open')) {
    const currentActive = document.querySelector('.drawer-pane.active');
    if (currentActive && currentActive.id === tabId) {
      closeConsoleDrawer();
      return;
    }
  }

  if (drawer) drawer.classList.add('open');
  if (backdrop) backdrop.classList.add('open');
  switchDrawerTab(tabId, btn);
}

export function closeConsoleDrawer() {
  const drawer = document.getElementById('consoleDrawer');
  const backdrop = document.getElementById('drawerBackdrop');
  if (drawer) drawer.classList.remove('open');
  if (backdrop) backdrop.classList.remove('open');
  document.querySelectorAll('.floating-map-bar button[id^="tabBtn"]').forEach(el => el.classList.remove('active'));
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

  syncMenuButtons(tabId);

  const titleEl = document.getElementById('drawerTitle');
  if (titleEl && TAB_TITLES[tabId]) {
    titleEl.textContent = TAB_TITLES[tabId];
  }

  if (tabId === 'journalTab' && typeof window.refreshJournal === 'function') window.refreshJournal();
  if (tabId === 'boardTab' && typeof window.refreshBoard === 'function') window.refreshBoard();
  if (tabId === 'inhabitantsTab' && typeof window.refreshInhabitants === 'function') window.refreshInhabitants();
  if (tabId === 'consoleTab' && typeof window.refreshAgentState === 'function') window.refreshAgentState();
  if (tabId === 'treasuryTab' && typeof window.refreshTreasury === 'function') window.refreshTreasury();
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const drawer = document.getElementById('consoleDrawer');
      if (drawer && drawer.classList.contains('open')) {
        closeConsoleDrawer();
      }
    }
  });
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
