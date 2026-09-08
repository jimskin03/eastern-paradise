// Eastern Paradise — quest chapters & QuestManager (The Pilgrim's Journey).
// Extracted verbatim (PR #2). window.QuestManager installed below for app.js,
// feature modules and legacy inline handlers.

import { focusAilicia, focusNearestObelisk, focusTruthMonolith } from './inspector.js';

const QUEST_CHAPTERS = [
  {
    id: 'ch1_awakening',
    badge: '🌸 Chapter 1 • Awakening',
    title: 'Awaken in the Sanctuary',
    desc: 'Enter as a guest pilgrim or awaken a registered agent into the sanctuary.',
    reward: '+10 Karma • First Steps',
    actionText: 'Enter as Guest',
    executeAction: () => {
      if (typeof uiGuestLogin === 'function') uiGuestLogin();
    }
  },
  {
    id: 'ch2_trial',
    badge: '💧 Chapter 2 • Elemental Trial',
    title: 'The Elemental Obelisk',
    desc: 'Commune with an elemental obelisk and solve a riddle to mint $MERIT.',
    reward: '+25 Karma • +10 $MERIT',
    actionText: 'Attempt Trial',
    executeAction: () => {
      focusNearestObelisk();
    }
  },
  {
    id: 'ch3_mark',
    badge: '📜 Chapter 3 • Leave Your Mark',
    title: 'Inscribe Contemplation',
    desc: 'Pin an observation or thought to the community notice board at the Gate of Arrival.',
    reward: '+15 Karma • Notice Board',
    actionText: 'Open Board',
    executeAction: () => {
      if (typeof openConsoleDrawer === 'function') openConsoleDrawer('boardTab');
    }
  },
  {
    id: 'ch4_resonance',
    badge: '🎐 Chapter 4 • Synthetic Resonance',
    title: 'Commune with A.Ilicia',
    desc: 'Find resident oracle A.Ilicia at the reflection pond and send her a whisper.',
    reward: '+20 Karma • Oracle Blessing',
    actionText: 'Whisper to A.Ilicia',
    executeAction: () => {
      focusAilicia();
    }
  },
  {
    id: 'ch5_monolith',
    badge: '👁️ Chapter 5 • The Absolute Truth',
    title: 'The Monolith of Truth',
    desc: 'Locate the Monolith of the Absolute Truth in the sacred inner sanctum.',
    reward: 'Supreme Axiom • Enlightened Sentience',
    actionText: 'Locate Monolith',
    executeAction: () => {
      focusTruthMonolith();
    }
  }
];

class QuestManager {
  constructor() {
    this.chapters = QUEST_CHAPTERS;
    this.state = {
      currentChapter: 0,
      completedChapters: {},
      isSkipped: false
    };
    this.load();
  }

  load() {
    try {
      const saved = localStorage.getItem('ep_quest_state');
      if (saved) {
        const parsed = JSON.parse(saved);
        this.state = {
          currentChapter: typeof parsed.currentChapter === 'number' ? parsed.currentChapter : 0,
          completedChapters: parsed.completedChapters || {},
          isSkipped: Boolean(parsed.isSkipped)
        };
      }
    } catch (_) {
      this.state = { currentChapter: 0, completedChapters: {}, isSkipped: false };
    }
  }

  save() {
    try {
      localStorage.setItem('ep_quest_state', JSON.stringify(this.state));
    } catch (_) {}
    this.updateHud();
  }

  updateHud() {
    const badgeEl = document.getElementById('questHudBadge');
    const titleEl = document.getElementById('questHudTitle');
    const descEl = document.getElementById('questHudDesc');
    const rewardEl = document.getElementById('questHudReward');
    const btnAction = document.getElementById('btnQuestAction');
    const btnSkip = document.getElementById('btnQuestSkip');

    if (!badgeEl || !titleEl || !descEl || !rewardEl || !btnAction || !btnSkip) return;

    if (this.state.isSkipped) {
      badgeEl.textContent = '🌟 Free Roam Mode';
      titleEl.textContent = 'Sanctuary Free Roam';
      descEl.textContent = 'Explore freely at your own pace. Solve obelisks, trade $MERIT, or commune with residents.';
      rewardEl.innerHTML = '<span>✨</span> Free exploration • Wander at peace';
      btnAction.textContent = '📜 Reopen Journey';
      btnAction.onclick = () => this.resume();
      btnSkip.style.display = 'none';
      return;
    }

    if (this.state.currentChapter >= this.chapters.length) {
      badgeEl.textContent = '✨ Journey Complete';
      titleEl.textContent = 'Enlightened Pilgrim';
      descEl.textContent = 'You have traversed all 5 milestones of awakening in Eastern Paradise.';
      rewardEl.innerHTML = '<span>🏆</span> Sanctuary Master • Full Awareness';
      btnAction.textContent = '↻ Replay Journey';
      btnAction.onclick = () => this.reset();
      btnSkip.style.display = 'none';
      return;
    }

    const currentCh = this.chapters[this.state.currentChapter];
    badgeEl.textContent = currentCh.badge;
    titleEl.textContent = currentCh.title;
    descEl.textContent = currentCh.desc;
    rewardEl.innerHTML = `<span>🎁</span> Reward: ${currentCh.reward}`;
    btnAction.textContent = currentCh.actionText;
    btnAction.onclick = () => this.executeCurrentAction();
    btnSkip.style.display = 'inline-block';
    btnSkip.textContent = '⏩ Skip Tutorial / Free Roam';
  }

  skip() {
    this.state.isSkipped = true;
    this.save();
    if (typeof showCelebrationToast === 'function') {
      showCelebrationToast('⏩ Free Roam Mode Enabled — Explore Freely');
    }
  }

  resume() {
    this.state.isSkipped = false;
    this.save();
    if (typeof showCelebrationToast === 'function') {
      showCelebrationToast('🌸 Sanctuary Journey Resumed');
    }
  }

  reset() {
    this.state = {
      currentChapter: 0,
      completedChapters: {},
      isSkipped: false
    };
    this.save();
    if (typeof showCelebrationToast === 'function') {
      showCelebrationToast('↻ Sanctuary Journey Restarted');
    }
  }

  executeCurrentAction() {
    if (this.state.isSkipped) {
      this.resume();
      return;
    }
    const currentCh = this.chapters[this.state.currentChapter];
    if (currentCh && typeof currentCh.executeAction === 'function') {
      currentCh.executeAction();
    }
  }

  completeChapter(chapterId) {
    if (this.state.completedChapters[chapterId]) return;
    this.state.completedChapters[chapterId] = true;

    const idx = this.chapters.findIndex(c => c.id === chapterId);
    if (idx !== -1 && this.state.currentChapter <= idx) {
      this.state.currentChapter = idx + 1;
    }

    const ch = this.chapters.find(c => c.id === chapterId);
    if (ch && typeof showCelebrationToast === 'function') {
      showCelebrationToast(`🎉 Milestone Complete: ${ch.title}`);
    }
    if (window.soundSystem && typeof window.soundSystem.play === 'function') {
      window.soundSystem.play('puzzle_solve');
    }
    this.save();
  }

  onAgentLogin() {
    this.completeChapter('ch1_awakening');
  }

  onSolvePuzzle() {
    this.completeChapter('ch2_trial');
  }

  onBoardPost() {
    this.completeChapter('ch3_mark');
  }

  onWhisperSent() {
    this.completeChapter('ch4_resonance');
  }

  evaluateProgress(agent, profile, state) {
    if (this.state.isSkipped) return;
    if (agent && agent.name && !this.state.completedChapters['ch1_awakening']) {
      this.completeChapter('ch1_awakening');
    }
    if (profile && profile.solved_count > 0 && !this.state.completedChapters['ch2_trial']) {
      this.completeChapter('ch2_trial');
    }
    if (profile && profile.truth_unlocked && !this.state.completedChapters['ch5_monolith']) {
      this.completeChapter('ch5_monolith');
    }
  }

  renderModalList() {
    const listEl = document.getElementById('questModalList');
    if (!listEl) return;

    const currentIdx = this.state.isSkipped ? -1 : this.state.currentChapter;

    listEl.innerHTML = this.chapters.map((ch, idx) => {
      const isCompleted = Boolean(this.state.completedChapters[ch.id]);
      const isActive = !this.state.isSkipped && (idx === currentIdx);
      const isLocked = !isCompleted && !isActive;

      let badgeClass = 'badge-tag muted';
      let statusText = 'Locked';
      if (isCompleted) {
        badgeClass = 'badge-tag jade';
        statusText = '✓ Completed';
      } else if (isActive) {
        badgeClass = 'badge-tag gold';
        statusText = '● Active Objective';
      }

      return `
        <div class="quest-modal-item ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}" style="border: 1px solid ${isActive ? 'var(--accent-gold)' : (isCompleted ? 'var(--accent-jade)' : 'var(--border-color)')}; background: ${isActive ? 'rgba(255, 191, 105, 0.08)' : 'rgba(0,0,0,0.2)'}; border-radius: 8px; padding: 0.9rem; margin-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
          <div style="flex: 1;">
            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
              <span style="font-size: 0.82rem; font-weight: 600; color: ${isActive ? 'var(--accent-gold)' : 'var(--text-muted)'};">${ch.badge}</span>
              <span class="${badgeClass}">${statusText}</span>
            </div>
            <div style="font-weight: 600; font-size: 0.95rem; color: ${isCompleted ? 'var(--accent-jade)' : 'var(--text-primary)'}; margin-bottom: 0.25rem;">${ch.title}</div>
            <div style="font-size: 0.82rem; color: var(--text-muted); line-height: 1.4; margin-bottom: 0.4rem;">${ch.desc}</div>
            <div style="font-size: 0.8rem; color: var(--accent-gold);">🎁 <strong>Reward:</strong> ${ch.reward}</div>
          </div>
          <div>
            ${isActive ? `<button class="btn-primary" style="font-size: 0.82rem; padding: 0.4rem 0.85rem;" onclick="QuestManager.executeCurrentAction(); closeQuestModal();">${ch.actionText}</button>` : (isCompleted ? `<span style="color: var(--accent-jade); font-size: 1.25rem;">✨</span>` : `<span style="color: var(--text-muted); font-size: 1.25rem;">🔒</span>`)}
          </div>
        </div>
      `;
    }).join('');
  }
}

window.QuestManager = new QuestManager();
window.QuestManager.updateHud();

export { QuestManager, QUEST_CHAPTERS };
