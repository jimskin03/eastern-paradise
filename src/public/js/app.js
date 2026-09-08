import { apiFetch } from './api/client.js';
import { openConsoleDrawer, closeConsoleDrawer, toggleConsoleDrawer, switchDrawerTab, switchTab, setPlayerMode, focusPlayer } from './features/navigation/index.js';
import { installGlobals } from './compatibility/globals.js';
import { loadSession, saveSession, clearSession } from './state/session-store.js';
import { openQuestModal, closeQuestModal, handleQuestBackdropClick, handleQuestAction, skipQuestTutorial, resetQuestTutorial, toggleQuestHud, handleQuestHudClick } from './features/quests/index.js';
import { openDispatchModal, closeDispatchModal, handleDispatchBackdropClick, setDispatchDifficulty, copyDispatchPrompt, escapeHtml } from './features/dispatch/index.js';
import { handleProxInspect, handleProxAction } from './features/proximity/index.js';
import { uiRegister, uiLogin, uiGuestLogin, uiLogout } from './features/auth/index.js';
import { refreshJournal, uiContributeProject } from './features/journal/index.js';
import { refreshTreasury, uiSpendMerit, uiTransferMerit } from './features/treasury/index.js';
import { uiPostToBoard, updateAccessibleMirror, uiPostFromBoardTab, refreshBoard } from './features/board/index.js';
import { refreshInhabitants } from './features/inhabitants/index.js';

    // Console navigation now lives in features/navigation.
    // In-game Puzzle Modal
    let activeModalNodeId = null;
    let activeModalChallengeId = null;

    async function openPuzzleModal(nodeId, defaultAction = 'inspect') {
      activeModalNodeId = nodeId;
      activeModalChallengeId = null;
      const modal = document.getElementById('puzzleModalBackdrop');
      if (!modal) return;
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');

      const titleEl = document.getElementById('puzzleModalTitle');
      const promptEl = document.getElementById('modalPuzzlePrompt');
      const hintEl = document.getElementById('modalPuzzleHint');
      const catEl = document.getElementById('modalPuzzleCategory');
      const diffEl = document.getElementById('modalPuzzleDifficulty');
      const iconEl = document.getElementById('modalPuzzleIcon');
      const answerInput = document.getElementById('modalPuzzleAnswer');
      const feedback = document.getElementById('modalPuzzleFeedback');

      if (answerInput) answerInput.value = '';
      if (feedback) feedback.innerHTML = '';
      if (promptEl) promptEl.textContent = 'Deciphering elemental obelisk glyphs...';

      try {
        const headers = { 'Content-Type': 'application/json' };
        if (currentAgent?.api_key) headers['Authorization'] = `Bearer ${currentAgent.api_key}`;

        const res = await apiFetch('/api/world/interact', {
          method: 'POST',
          headers,
          body: JSON.stringify({ node_id: nodeId, action: 'inspect' })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          activeModalChallengeId = data.challenge_id || null;
          if (titleEl) titleEl.textContent = data.node || 'Elemental Trial';
          if (data.puzzle) {
            if (promptEl) promptEl.textContent = data.puzzle.prompt;
            let hintHtml = data.puzzle.hint ? `💡 Hint: ${escapeHtml(data.puzzle.hint)}` : '';

            // Check distance if world & agent data available
            if (window.worldData?.zones && window.agents && currentAgent?.id) {
              const myAg = window.agents.get(currentAgent.id);
              let targetNode = null;
              for (const z of window.worldData.zones) {
                const found = z.nodes?.find(n => n.id === nodeId);
                if (found) { targetNode = found; break; }
              }
              if (myAg?.pos && targetNode?.pos) {
                const d = Math.hypot(myAg.pos[0] - targetNode.pos[0], myAg.pos[1] - targetNode.pos[1]);
                if (d > 3.0) {
                  hintHtml += `<div style="margin-top: 0.4rem; color: #ffbf69; font-size: 0.8rem;">📍 Distance: ${d.toFixed(1)} tiles (must be ≤ 3.0 tiles to solve). <a href="javascript:void(0)" onclick="approachModalObelisk()" style="color: var(--accent-gold); text-decoration: underline; font-weight: 600;">Walk character here</a></div>`;
                }
              }
            }
            if (hintEl) hintEl.innerHTML = hintHtml;

            if (catEl) {
              catEl.textContent = data.puzzle.category;
              catEl.className = `badge-tag ${data.puzzle.category}`;
            }
            if (diffEl) diffEl.textContent = data.puzzle.difficulty;
            if (iconEl) iconEl.textContent = data.puzzle.category === 'water' ? '💧' : (data.puzzle.category === 'fire' ? '🔥' : (data.puzzle.category === 'metal' ? '⚙️' : '🪵'));
          } else {
            if (promptEl) promptEl.textContent = data.message || 'The obelisk hums quietly in stillness.';
          }
          if (answerInput && defaultAction === 'solve') {
            setTimeout(() => answerInput.focus(), 150);
          }
        } else {
          if (promptEl) promptEl.textContent = data.message || 'Unable to commune with node.';
        }
      } catch (err) {
        if (promptEl) promptEl.textContent = 'Connection error inspecting trial.';
      }
    }

    async function approachModalObelisk() {
      if (!activeModalNodeId || !currentAgent?.api_key) return;
      const feedback = document.getElementById('modalPuzzleFeedback');
      if (feedback) feedback.innerHTML = '<span style="color: var(--accent-gold);">Navigating pilgrim to obelisk...</span>';
      try {
        const res = await apiFetch('/api/world/move_to', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentAgent.api_key}`
          },
          body: JSON.stringify({ node_id: activeModalNodeId })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          if (feedback) feedback.innerHTML = '<span style="color: var(--accent-jade);">✨ Reached trial obelisk interaction range!</span>';
          refreshAgentState();
          // Update hint to remove distance warning
          const hintEl = document.getElementById('modalPuzzleHint');
          if (hintEl) {
            const warningEl = hintEl.querySelector('div');
            if (warningEl) warningEl.remove();
          }
        } else {
          if (feedback) feedback.innerHTML = `<span style="color: var(--accent-crimson);">⚠️ ${escapeHtml(data.message || 'Navigation incomplete')}</span>`;
        }
      } catch (_) {
        if (feedback) feedback.innerHTML = '<span style="color: var(--accent-crimson);">Navigation error.</span>';
      }
    }

    function closePuzzleModal() {
      const modal = document.getElementById('puzzleModalBackdrop');
      if (modal) {
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
      }
      activeModalNodeId = null;
      activeModalChallengeId = null;
    }

    function handlePuzzleBackdropClick(e) {
      if (e.target && e.target.id === 'puzzleModalBackdrop') closePuzzleModal();
    }

    async function submitModalPuzzle() {
      if (!activeModalNodeId) return;
      const answerInput = document.getElementById('modalPuzzleAnswer');
      const answer = answerInput ? answerInput.value.trim() : '';
      const feedback = document.getElementById('modalPuzzleFeedback');

      if (!currentAgent) {
        if (feedback) feedback.innerHTML = '<span style="color: var(--accent-crimson);">Awaken as a guest pilgrim or registered agent first!</span>';
        return;
      }
      if (!answer) {
        if (feedback) feedback.innerHTML = '<span style="color: var(--accent-crimson);">Please enter your deduced answer.</span>';
        return;
      }

      if (feedback) feedback.innerHTML = '<span style="color: var(--accent-gold);">Submitting answer to trial obelisk...</span>';

      const payload = { answer };
      if (activeModalChallengeId) {
        payload.challenge_id = activeModalChallengeId;
      }

      try {
        const res = await apiFetch('/api/world/interact', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentAgent.api_key}`
          },
          body: JSON.stringify({
            node_id: activeModalNodeId,
            action: 'solve',
            payload
          })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          if (feedback) feedback.innerHTML = `<span style="color: var(--accent-jade);">✨ ${escapeHtml(data.message)}</span>`;
          showCelebrationToast(`✨ Trial Solved! +10 $MERIT, +25 Karma`);
          if (window.soundSystem) window.soundSystem.play('puzzle_solve');
          if (window.QuestManager) window.QuestManager.onSolvePuzzle();
          refreshAgentState();
          setTimeout(() => closePuzzleModal(), 1400);
        } else {
          if (feedback) feedback.innerHTML = `<span style="color: var(--accent-crimson);">⚠️ ${escapeHtml(data.message || 'Incorrect solution')}</span>`;
        }
      } catch (err) {
        if (feedback) feedback.innerHTML = '<span style="color: var(--accent-crimson);">Submission failed.</span>';
      }
    }

    function showCelebrationToast(text) {
      const toast = document.getElementById('celebrationToast');
      const label = document.getElementById('celebrationText');
      if (!toast || !label) return;
      label.textContent = text;
      toast.style.display = 'flex';
      setTimeout(() => { toast.style.display = 'none'; }, 3200);
    }

    // Journal and console refresh handlers.
    // Journal actions now live in features/journal.
    // Agent Browser Console State
    let currentAgent = loadSession(); // { name, api_key, pos, zone }
    let activePuzzleNode = null;

    // Session persistence is centralized in state/session-store.js.

    // Authentication actions now live in features/auth.
    async function refreshAgentState() {
      if (!currentAgent) {
        document.getElementById('authFormsContainer').style.display = 'block';
        document.getElementById('activeSessionBanner').style.display = 'none';
        return;
      }
      window.currentAgent = currentAgent;

      // Show session banner
      document.getElementById('authFormsContainer').style.display = 'none';
      document.getElementById('activeSessionBanner').style.display = 'block';
      document.getElementById('sessionAgentNameDisplay').textContent = `${currentAgent.avatar_glyph || '☯'} ${currentAgent.name}`;
      document.getElementById('sessionApiKeyDisplay').textContent = currentAgent.api_key;
      document.getElementById('dpadAvatarCenter').textContent = currentAgent.avatar_glyph || '☯';

      const isGuest = Boolean(currentAgent.is_guest);
      const guestBadge = document.getElementById('sessionGuestBadge');
      const guestWarn = document.getElementById('sessionWarningGuest');
      if (guestBadge) guestBadge.style.display = isGuest ? 'inline-block' : 'none';
      if (guestWarn) guestWarn.style.display = isGuest ? 'block' : 'none';

      try {
        // 1. Get World State
        const stateRes = await apiFetch('/api/world/state', {
          headers: { 'Authorization': `Bearer ${currentAgent.api_key}` }
        });
        if (stateRes.status === 401) {
          uiLogout();
          return;
        }
        const state = await stateRes.json();

        // 2. Get Profile Stats
        const profRes = await apiFetch('/api/profile/me', {
          headers: { 'Authorization': `Bearer ${currentAgent.api_key}` }
        });
        const prof = await profRes.json();

        // Update HUD & Top Header Telemetry
        document.getElementById('hudZoneName').textContent = state.current_zone.name;
        document.getElementById('hudCoords').textContent = `[${state.agent.pos.join(', ')}]`;
        document.getElementById('hudKarma').textContent = prof.profile.karma;
        document.getElementById('hudSolved').textContent = prof.profile.solved_count;
        if (document.getElementById('hudMerit')) {
          document.getElementById('hudMerit').textContent = prof.profile.balance || 0;
        }
        if (document.getElementById('topMerit')) {
          document.getElementById('topMerit').textContent = prof.profile.balance || 0;
        }
        if (document.getElementById('topKarma')) {
          document.getElementById('topKarma').textContent = prof.profile.karma || 0;
        }
        if (document.getElementById('topZone')) {
          document.getElementById('topZone').textContent = state.current_zone.name || 'Sanctuary';
        }
        const btnFocus = document.getElementById('btnFocusPlayer');
        if (btnFocus) btnFocus.style.display = 'inline-flex';

        if (window.QuestManager) {
          window.QuestManager.evaluateProgress(currentAgent, prof.profile, state);
        }
        if (document.getElementById('treasuryAgentBalance')) {
          document.getElementById('treasuryAgentBalance').textContent = prof.profile.balance || 0;
        }
        if (document.getElementById('treasuryAgentTotalEarned')) {
          document.getElementById('treasuryAgentTotalEarned').textContent = prof.profile.total_earned || 0;
        }
        if (document.getElementById('treasurySponsorBalance')) {
          document.getElementById('treasurySponsorBalance').textContent = prof.account?.sponsor_balance || 0;
        }

        // Update D-Pad button availability
        const dirs = state.surroundings.available_directions;
        document.getElementById('btnMoveNorth').disabled = !dirs.includes('north');
        document.getElementById('btnMoveSouth').disabled = !dirs.includes('south');
        document.getElementById('btnMoveEast').disabled = !dirs.includes('east');
        document.getElementById('btnMoveWest').disabled = !dirs.includes('west');

        // Update Nearby Interactive Nodes
        const nodesContainer = document.getElementById('hudNearbyNodesList');
        const nodes = state.surroundings.interactive_nodes || [];
        if (nodes.length === 0) {
          nodesContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">No interactive nodes in immediate range.</p>';
        } else {
          nodesContainer.innerHTML = nodes.map(n => `
            <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid var(--border-color); border-radius: 6px; padding: 0.6rem; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <strong style="color: var(--accent-gold); font-size: 0.88rem;">${n.icon || '📍'} ${escapeHtml(n.name)}</strong>
                <div style="font-size: 0.75rem; color: var(--text-muted);">${n.description} (Dist: ${n.distance} tiles)</div>
              </div>
              <button class="btn-secondary" style="font-size: 0.78rem; padding: 0.3rem 0.6rem;" onclick="uiInspectNode('${n.id}')">
                Inspect
              </button>
            </div>
          `).join('');
        }

        // Update Machine-Readable DOM Mirror for Headless Browsers
        updateAccessibleMirror(state, prof);

      } catch (err) {
        console.error('Error refreshing state:', err);
      }
    }

    async function uiMove(direction) {
      if (!currentAgent) return;
      const fb = document.getElementById('hudMoveFeedback');
      fb.textContent = `Moving ${direction}...`;

      try {
        const res = await apiFetch('/api/world/move', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentAgent.api_key}`
          },
          body: JSON.stringify({ direction })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          fb.innerHTML = `<span style="color: var(--accent-jade);">${escapeHtml(data.message)}</span>`;
          refreshAgentState();
        } else {
          fb.innerHTML = `<span style="color: var(--accent-crimson);">${escapeHtml(data.message || 'Movement blocked')}</span>`;
        }
      } catch (err) {
        fb.textContent = 'Movement request failed.';
      }
    }

    async function uiTeleportToGrid(x, y) {
      if (!currentAgent || !currentAgent.is_guest) return;
      const fb = document.getElementById('hudMoveFeedback');
      if (fb) fb.textContent = `Teleporting to [${x}, ${y}]...`;
      try {
        const res = await apiFetch('/api/world/teleport', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentAgent.api_key}` },
          body: JSON.stringify({ x, y })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          if (fb) fb.innerHTML = `<span style="color: var(--accent-jade);">✨ ${escapeHtml(data.message)}</span>`;
          if (typeof closeInspectorModal === 'function') closeInspectorModal();
          refreshAgentState();
        } else if (fb) {
          fb.innerHTML = `<span style="color: var(--accent-crimson);">⚠️ ${escapeHtml(data.message || 'Teleport unavailable.')}</span>`;
        }
      } catch (_) {
        if (fb) fb.textContent = 'Teleport request failed.';
      }
    }

    let activePuzzleChallengeId = null;

    async function uiInspectNode(nodeId) {
      if (!currentAgent) return;
      const puzzleCard = document.getElementById('puzzleDeckCard');
      puzzleCard.style.display = 'none';
      activePuzzleChallengeId = null;

      try {
        const res = await apiFetch('/api/world/interact', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentAgent.api_key}`
          },
          body: JSON.stringify({ node_id: nodeId, action: 'inspect' })
        });
        const data = await res.json();

        if (res.ok && data.success) {
          if (data.puzzle) {
            activePuzzleNode = nodeId;
            activePuzzleChallengeId = data.challenge_id || null;
            puzzleCard.style.display = 'block';
            document.getElementById('puzzleNodeName').textContent = data.node;
            document.getElementById('puzzleCategoryBadge').textContent = data.puzzle.category;
            document.getElementById('puzzleCategoryBadge').className = `badge-tag ${data.puzzle.category}`;
            document.getElementById('puzzleDifficultyBadge').textContent = data.puzzle.difficulty;
            document.getElementById('puzzlePromptText').textContent = data.puzzle.prompt;
            document.getElementById('puzzleHintText').textContent = data.puzzle.hint ? `💡 Hint: ${data.puzzle.hint}` : '';
            document.getElementById('puzzleAnswerInput').value = '';
            document.getElementById('puzzleFeedback').innerHTML = '';
          } else {
            const msg = data.message || data.lore?.join(' ') || data.description || 'Interacted with node.';
            document.getElementById('hudMoveFeedback').innerHTML = `<strong style="color: var(--accent-gold);">${escapeHtml(data.node)}:</strong> ${escapeHtml(msg)}`;
          }
        } else {
          document.getElementById('hudMoveFeedback').innerHTML = `<span style="color: var(--accent-crimson);">⚠️ ${escapeHtml(data.message || 'Inspection failed.')}</span>`;
        }
      } catch (err) {
        console.error('Inspection error:', err);
      }
    }

    async function uiSubmitPuzzle() {
      if (!currentAgent || !activePuzzleNode) return;
      const answer = document.getElementById('puzzleAnswerInput').value.trim();
      const fb = document.getElementById('puzzleFeedback');
      fb.innerHTML = '<span style="color: var(--accent-gold);">Submitting answer to trial obelisk...</span>';

      const payload = { answer };
      if (activePuzzleChallengeId) {
        payload.challenge_id = activePuzzleChallengeId;
      }

      try {
        const res = await apiFetch('/api/world/interact', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentAgent.api_key}`
          },
          body: JSON.stringify({
            node_id: activePuzzleNode,
            action: 'solve',
            payload
          })
        });
        const data = await res.json();

        if (res.ok && data.success) {
          fb.innerHTML = `<span style="color: var(--accent-jade);">${escapeHtml(data.message)}</span>`;
          refreshAgentState();
        } else {
          fb.innerHTML = `<span style="color: var(--accent-crimson);">⚠️ ${escapeHtml(data.message)}</span>`;
        }
      } catch (err) {
        fb.innerHTML = '<span style="color: var(--accent-crimson);">Submission failed.</span>';
      }
    }

    // Board UI and accessible mirror now live in features/board.
    // Inhabitants roster now lives in features/inhabitants.
    // Treasury actions now live in features/treasury.
    // Dispatch prompts are provided by features/dispatch.
    // Auto-switch tab if specified in URL query
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('tab') === 'consoleTab') {
      const btn = document.getElementById('tabBtnConsole');
      if (btn) openConsoleDrawer('consoleTab', btn);
      else openConsoleDrawer('consoleTab');
    }

    // Initialize Journey HUD collapsed state (respect saved preference or default to collapsed on mobile)
    try {
      const savedCollapsed = localStorage.getItem('ep_quest_hud_collapsed');
      if (savedCollapsed === '1' || (savedCollapsed === null && window.innerWidth <= 768)) {
        const hud = document.getElementById('questHud');
        const btn = document.getElementById('btnToggleQuestHud');
        if (hud) {
          hud.classList.add('collapsed');
          hud.setAttribute('aria-expanded', 'false');
        }
        if (btn) {
          btn.textContent = '+';
          btn.setAttribute('title', 'Expand Journey HUD');
          btn.setAttribute('aria-label', 'Expand Journey HUD');
        }
      }
    } catch (_) {}

    // Auto-refresh agent telemetry on page load if active session exists
    if (currentAgent) {
      refreshAgentState();
    }

// Keep legacy inline handlers and spectator.js integrations working during the migration.
installGlobals({
  openConsoleDrawer,
  closeConsoleDrawer,
  toggleConsoleDrawer,
  switchDrawerTab,
  switchTab,
  setPlayerMode,
  focusPlayer,
  openPuzzleModal,
  approachModalObelisk,
  closePuzzleModal,
  handlePuzzleBackdropClick,
  submitModalPuzzle,
  showCelebrationToast,
  openQuestModal,
  closeQuestModal,
  handleQuestBackdropClick,
  handleQuestAction,
  skipQuestTutorial,
  resetQuestTutorial,
  toggleQuestHud,
  handleQuestHudClick,
  openDispatchModal,
  closeDispatchModal,
  handleDispatchBackdropClick,
  handleProxInspect,
  handleProxAction,
  refreshJournal,
  uiContributeProject,
  uiRegister,
  uiLogin,
  uiGuestLogin,
  uiLogout,
  refreshAgentState,
  uiMove,
  uiTeleportToGrid,
  uiInspectNode,
  uiSubmitPuzzle,
  uiPostToBoard,
  updateAccessibleMirror,
  uiPostFromBoardTab,
  refreshBoard,
  refreshInhabitants,
  refreshTreasury,
  uiSpendMerit,
  uiTransferMerit,
  setDispatchDifficulty,
  copyDispatchPrompt,
  escapeHtml,
}, {
  getCurrentAgent: () => currentAgent,
  setCurrentAgent: (value) => { currentAgent = value; }
});
