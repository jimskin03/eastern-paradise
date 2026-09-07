// Quest Modal & Handlers
export function openQuestModal() {
  const modal = document.getElementById('questModalBackdrop');
  if (modal) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }
  if (window.QuestManager) window.QuestManager.renderModalList();
}
export function closeQuestModal() {
  const modal = document.getElementById('questModalBackdrop');
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
}
export function handleQuestBackdropClick(e) {
  if (e.target && e.target.id === 'questModalBackdrop') closeQuestModal();
}
export function handleQuestAction() {
  if (window.QuestManager) window.QuestManager.executeCurrentAction();
}
export function skipQuestTutorial() {
  if (window.QuestManager) window.QuestManager.skip();
}
export function resetQuestTutorial() {
  if (window.QuestManager) window.QuestManager.reset();
}
export function toggleQuestHud(e) {
  if (e) e.stopPropagation();
  const hud = document.getElementById('questHud');
  const btn = document.getElementById('btnToggleQuestHud');
  if (!hud) return;
  const isCollapsed = hud.classList.toggle('collapsed');
  if (btn) {
    btn.textContent = isCollapsed ? '+' : '–';
    btn.setAttribute('title', isCollapsed ? 'Expand Journey HUD' : 'Collapse Journey HUD');
    btn.setAttribute('aria-label', isCollapsed ? 'Expand Journey HUD' : 'Collapse Journey HUD');
  }
  try {
    localStorage.setItem('ep_quest_hud_collapsed', isCollapsed ? '1' : '0');
  } catch (_) {}
}
export function handleQuestHudClick(e) {
  const hud = document.getElementById('questHud');
  if (hud && hud.classList.contains('collapsed')) {
    toggleQuestHud(e);
  }
}
