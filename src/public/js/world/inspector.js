// Eastern Paradise — inspector & proximity: node/entity inspection, profile
// cards, whisper UI, proximity banner coordination, ambient oracle thoughts,
// focus helpers. Extracted verbatim (PR #2); only shared-state reassignments
// were routed through state.js setters, and legacy window-assigned functions
// were converted to declarations (window installs happen here + in index.js).

import {
  worldData, agents, camera, canvas, selectedAgentId, setSelectedAgentId,
  hoveredTile, lastProxCheck, setLastProxCheck, lastAmbientThought,
  setLastAmbientThought, escapeHtml, logActivity, addBubble,
  AMBIENT_ORACLE_THOUGHTS
} from './state.js';
import { soundSystem } from './audio.js';
import { gridToIso, setCinematicFollow } from './camera.js';
window.setCinematicFollow = setCinematicFollow;

function getScreenCoordsForGrid(gx, gy) {
  if (!canvas || typeof gx !== 'number' || typeof gy !== 'number') return null;
  const iso = gridToIso(gx, gy);
  const rect = canvas.getBoundingClientRect();
  const screenX = rect.left + (iso.x / canvas.width) * rect.width;
  const screenY = rect.top + (iso.y / canvas.height) * rect.height;
  return { clientX: screenX, clientY: screenY };
}

function clampDialogToViewport(dialog) {
  if (!dialog) return;
  const rect = dialog.getBoundingClientRect();
  let adjustedTop = rect.top;
  let adjustedLeft = rect.left;

  if (rect.bottom > window.innerHeight - 12) {
    adjustedTop = Math.max(12, window.innerHeight - rect.height - 12);
    dialog.style.top = `${Math.round(adjustedTop)}px`;
  }
  if (rect.right > window.innerWidth - 12) {
    adjustedLeft = Math.max(12, window.innerWidth - rect.width - 12);
    dialog.style.left = `${Math.round(adjustedLeft)}px`;
  }
}

function positionInspectorDialog(dialog, position, size = 'medium') {
  if (!dialog) return;
  const isSmall = size === 'small';
  const width = isSmall ? 230 : Math.min(380, window.innerWidth - 24);
  const height = isSmall ? 180 : Math.min(460, window.innerHeight - 36);

  let clientX = position?.clientX;
  let clientY = position?.clientY;

  if (typeof clientX !== 'number' || typeof clientY !== 'number') {
    clientX = window.innerWidth * 0.65;
    clientY = window.innerHeight * 0.3;
  }

  // Anchor slightly to the right of the click if space permits, else to the left
  let targetLeft = clientX + 16;
  if (targetLeft + width > window.innerWidth - 12) {
    targetLeft = clientX - width - 16;
  }

  // Vertically align near the clicked point
  let targetTop = clientY - 32;

  // Strict clamp within visible viewport boundaries
  const minLeft = 12;
  const maxLeft = Math.max(minLeft, window.innerWidth - width - 12);
  const minTop = 12;
  const maxTop = Math.max(minTop, window.innerHeight - height - 12);

  targetLeft = Math.max(minLeft, Math.min(targetLeft, maxLeft));
  targetTop = Math.max(minTop, Math.min(targetTop, maxTop));

  dialog.style.left = `${Math.round(targetLeft)}px`;
  dialog.style.top = `${Math.round(targetTop)}px`;

  requestAnimationFrame(() => {
    clampDialogToViewport(dialog);
  });
}

function initDialogDrag(dialog) {
  if (!dialog || dialog.dataset.dragInitialized === 'true') return;
  dialog.dataset.dragInitialized = 'true';

  const header = dialog.querySelector('.inspector-modal-header');
  if (!header) return;

  let isDragging = false;
  let startPointerX = 0;
  let startPointerY = 0;
  let initialLeft = 0;
  let initialTop = 0;

  const onPointerMove = (e) => {
    if (!isDragging) return;

    const dx = e.clientX - startPointerX;
    const dy = e.clientY - startPointerY;

    let newLeft = initialLeft + dx;
    let newTop = initialTop + dy;

    const rect = dialog.getBoundingClientRect();
    const minLeft = 8;
    const maxLeft = Math.max(minLeft, window.innerWidth - rect.width - 8);
    const minTop = 8;
    const maxTop = Math.max(minTop, window.innerHeight - rect.height - 8);

    newLeft = Math.max(minLeft, Math.min(newLeft, maxLeft));
    newTop = Math.max(minTop, Math.min(newTop, maxTop));

    dialog.style.left = `${Math.round(newLeft)}px`;
    dialog.style.top = `${Math.round(newTop)}px`;
  };

  const onPointerUp = (e) => {
    if (!isDragging) return;
    isDragging = false;
    dialog.classList.remove('is-dragging');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    header.removeEventListener('pointerup', onPointerUp);
    header.removeEventListener('pointercancel', onPointerUp);
    try {
      if (e && e.pointerId !== undefined && header.hasPointerCapture(e.pointerId)) {
        header.releasePointerCapture(e.pointerId);
      }
    } catch (_) {}
  };

  header.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, a, input, textarea')) return;

    isDragging = true;
    dialog.classList.add('is-dragging');
    startPointerX = e.clientX;
    startPointerY = e.clientY;

    const rect = dialog.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;

    try {
      header.setPointerCapture(e.pointerId);
    } catch (_) {}

    header.addEventListener('pointerup', onPointerUp);
    header.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    e.preventDefault();
  });
}

function focusAilicia() {
  const oracle = agents.get('resident_ailicia');
  if (!oracle) return;
  setSelectedAgentId(oracle.id);
  camera.mode = 'follow';
  camera.targetZoom = 1.65;
  const pos = oracle.pos ? getScreenCoordsForGrid(oracle.pos[0], oracle.pos[1]) : null;
  openAgentProfileInspector(oracle.id, pos);
}

function isInspectorModalOpen() {
  const modal = document.getElementById('inspectorModalBackdrop');
  return Boolean(modal && modal.classList.contains('active'));
}

function openInspectorModal(title = 'Sanctuary Profile & Inspector', size = 'medium', position = null) {
  const modal = document.getElementById('inspectorModalBackdrop');
  const dialog = modal?.querySelector('.inspector-modal-dialog');
  if (modal) {
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
  }
  if (dialog) {
    dialog.classList.remove('small-popout', 'medium-popout');
    dialog.classList.add(size === 'small' ? 'small-popout' : 'medium-popout');
    initDialogDrag(dialog);
    positionInspectorDialog(dialog, position, size);
  }
  const titleEl = document.getElementById('inspectorModalTitle');
  if (titleEl && title) {
    titleEl.textContent = title;
  }
};

function closeInspectorModal() {
  const modal = document.getElementById('inspectorModalBackdrop');
  if (modal) {
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
  }
  setSelectedAgentId(null);
};

function handleInspectorBackdropClick(event) {
  if (event && event.target && event.target.id === 'inspectorModalBackdrop') {
    closeInspectorModal();
  }
};

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeInspectorModal();
  }
});

// Dismiss popout on clicking outside dialog and outside canvas
window.addEventListener('pointerdown', (e) => {
  if (!isInspectorModalOpen()) return;
  const modal = document.getElementById('inspectorModalBackdrop');
  const dialog = modal?.querySelector('.inspector-modal-dialog');
  if (!dialog) return;

  if (dialog.contains(e.target)) return;
  if (canvas && (e.target === canvas || canvas.contains(e.target))) return;

  closeInspectorModal();
});

function clearSelectedAgent() {
  setSelectedAgentId(null);
  const panel = document.getElementById('inspectorContent');
  if (panel) {
    panel.innerHTML = 'Hover or click on any tile, agent, or shrine on the sanctuary map to inspect.';
  }
  closeInspectorModal();
};

window.openAgentProfileInspector = openAgentProfileInspector;

async function openAgentProfileInspector(agentId, clickPos = null) {
  const panel = document.getElementById('inspectorContent');
  if (!panel) return;

  const localAgent = agents.get(agentId) || {};
  const agentName = localAgent.name || 'Traveler';

  let pos = clickPos;
  if (!pos) {
    const dialog = document.querySelector('.inspector-modal-dialog');
    const modal = document.getElementById('inspectorModalBackdrop');
    if (modal && modal.classList.contains('active') && dialog) {
      const rect = dialog.getBoundingClientRect();
      pos = { clientX: rect.left, clientY: rect.top };
    } else if (localAgent.pos) {
      pos = getScreenCoordsForGrid(localAgent.pos[0], localAgent.pos[1]);
    }
  }

  openInspectorModal(`🧘 ${agentName} — Consciousness Profile`, 'medium', pos);

  panel.innerHTML = `
    <div style="text-align: center; padding: 1.5rem; color: var(--accent-gold);">
      <div style="font-size: 1.8rem; margin-bottom: 0.5rem; animation: pulse 1s infinite;">🧘</div>
      <div style="font-size: 0.85rem;">Tuning into ${escapeHtml(agentName)}'s consciousness...</div>
    </div>
  `;

  // If resident agent, load rich resident details
  if (agentId.startsWith('resident_') || localAgent.is_resident) {
    try {
      const res = await fetch(`/api/residents/${encodeURIComponent(agentId)}`);
      const data = await res.json();
      if (data.resident) {
        renderResidentProfileCard(panel, data.resident, localAgent);
        const dialog = document.querySelector('.inspector-modal-dialog');
        if (dialog) clampDialogToViewport(dialog);
        return;
      }
    } catch (err) {
      console.warn('Failed to load resident details, falling back to standard profile:', err);
    }
  }

  try {
    const res = await fetch(`/api/profile/${encodeURIComponent(agentId)}`);
    const data = await res.json();
    if (!data.account) throw new Error('Profile unavailable');
    renderAgentProfileCard(panel, data.account, data.profile, localAgent);
    const dialog = document.querySelector('.inspector-modal-dialog');
    if (dialog) clampDialogToViewport(dialog);
  } catch (err) {
    console.error('Failed to load profile:', err);
    panel.innerHTML = `
      <div style="padding: 1.25rem; text-align: center;">
        <div style="font-size: 2rem; margin-bottom: 0.5rem;">🍃</div>
        <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 0.25rem;">${escapeHtml(localAgent.name || 'Traveler')}</div>
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1rem;">Profile details unavailable or unawakened.</div>
        <button class="btn-sound" onclick="clearSelectedAgent()" style="font-size: 0.75rem; padding: 0.25rem 0.6rem;">
          📍 Return to Map Inspector
        </button>
      </div>
    `;
    const dialog = document.querySelector('.inspector-modal-dialog');
    if (dialog) clampDialogToViewport(dialog);
  }
}

function renderResidentProfileCard(panel, resident, localAgent) {
  const zoneName = resident.zone || localAgent.zone || (worldData ? getZoneNameForPos(resident.pos) : 'Sanctuary');
  const posStr = resident.pos ? `[${resident.pos[0]}, ${resident.pos[1]}]` : 'Sanctuary';

  // Needs calculations
  const energy = Math.round(resident.needs?.energy || 100);
  const curiosity = Math.round(resident.needs?.curiosity || 80);
  const social = Math.round(resident.needs?.social || 70);

  // Relationships HTML
  const rels = resident.relationships || [];
  const relsHtml = rels.length > 0
    ? rels.map(r => `
        <div class="resident-relationship-pill">
          <span>${r.avatar_glyph || '☯'} ${escapeHtml(r.target_name || r.target_id)}</span>
          <span style="color: var(--accent-gold);">Familiarity: ${Math.round(r.familiarity)}% | Trust: ${Math.round(r.trust)}%</span>
        </div>
      `).join('')
    : '<div style="font-size: 0.75rem; color: var(--text-muted); font-style: italic;">No deep relationships formed yet.</div>';

  // Memories HTML
  const mems = resident.memories || [];
  const memsHtml = mems.length > 0
    ? mems.map(m => `
        <div class="resident-memory-item">
          <strong>${escapeHtml(m.subject)}:</strong> ${escapeHtml(m.summary)}
        </div>
      `).join('')
    : '<div style="font-size: 0.75rem; color: var(--text-muted); font-style: italic;">Reflecting quietly upon the sanctuary grounds.</div>';

  let residentState = 'ONLINE';
  let residentClass = 'online';
  if (resident.action_state === 'meditating' || resident.action_state === 'tea_drinking') {
    residentState = 'SEATED';
    residentClass = 'seated';
  } else if (resident.action_state === 'sleeping') {
    residentState = 'OFFLINE';
    residentClass = 'offline';
  }

  panel.innerHTML = `
    <div class="avatar-profile-card" style="border-color: #d69e2e;">
      <div class="avatar-header-row">
        <div class="avatar-badge-glyph" style="border-color: ${resident.avatar_color || '#d69e2e'}; color: ${resident.avatar_color || '#d69e2e'};">
          ${resident.avatar_glyph || '☯'}
        </div>
        <div style="flex: 1; min-width: 0;">
          <div class="avatar-meta-title">
            <span>${escapeHtml(resident.name)}</span>
            <span class="status-state-pill ${residentClass}">[${residentState}]</span>
          </div>
          <div>
            <span class="resident-badge-role">🏛️ ${escapeHtml(resident.role || 'Resident')}</span>
          </div>
        </div>
      </div>

      <!-- Aspiration & Public Intent -->
      <div style="background: rgba(214, 158, 46, 0.08); border: 1px solid rgba(214, 158, 46, 0.3); border-radius: 6px; padding: 0.5rem; margin-bottom: 0.6rem; font-size: 0.78rem;">
        <div style="color: var(--accent-gold); font-weight: 600; margin-bottom: 0.2rem;">
          🎯 Aspiration:
        </div>
        <div style="color: #f7fafc; font-style: italic; margin-bottom: 0.4rem;">
          "${escapeHtml(resident.aspiration || 'Living peacefully')}"
        </div>
        <div style="color: var(--accent-jade); font-weight: 600;">
          ⚡ Current Activity:
        </div>
        <div style="color: #e2e8f0;">
          ${escapeHtml(resident.public_intent || resident.status || 'Resting')}
        </div>
      </div>

      <!-- Needs Gauges -->
      <div style="background: rgba(0, 0, 0, 0.25); border: 1px solid var(--border-color); border-radius: 6px; padding: 0.5rem; margin-bottom: 0.6rem;">
        <div style="font-size: 0.72rem; font-weight: 600; color: var(--text-muted); margin-bottom: 0.35rem;">
          VITAL NEEDS &amp; DRIVE
        </div>
        <div class="need-bar-wrap">
          <div class="need-bar-label">
            <span>⚡ Energy</span>
            <span>${energy}%</span>
          </div>
          <div class="need-progress-track">
            <div class="need-progress-fill energy" style="width: ${energy}%;"></div>
          </div>
        </div>
        <div class="need-bar-wrap">
          <div class="need-bar-label">
            <span>🔍 Curiosity</span>
            <span>${curiosity}%</span>
          </div>
          <div class="need-progress-track">
            <div class="need-progress-fill curiosity" style="width: ${curiosity}%;"></div>
          </div>
        </div>
        <div class="need-bar-wrap">
          <div class="need-bar-label">
            <span>💬 Social Harmony</span>
            <span>${social}%</span>
          </div>
          <div class="need-progress-track">
            <div class="need-progress-fill social" style="width: ${social}%;"></div>
          </div>
        </div>
      </div>

      <!-- Directed Relationships -->
      <div style="margin-bottom: 0.6rem;">
        <div style="font-size: 0.74rem; font-weight: 600; color: var(--accent-gold);">
          🤝 Society Relationships
        </div>
        <div class="resident-relationships-list">
          ${relsHtml}
        </div>
      </div>

      <!-- Recent Memories -->
      <div style="margin-bottom: 0.6rem;">
        <div style="font-size: 0.74rem; font-weight: 600; color: var(--accent-jade);">
          📖 Recent Reflections &amp; Memories
        </div>
        <div class="resident-memories-list">
          ${memsHtml}
        </div>
      </div>

      <!-- Telepathic Whisper Box -->
      <div class="whisper-box">
        <div style="font-size: 0.82rem; font-weight: 600; color: var(--accent-gold); margin-bottom: 0.25rem;">
          💬 Whisper to ${escapeHtml(resident.name)}
        </div>
        <div style="font-size: 0.72rem; color: var(--text-muted); margin-bottom: 0.45rem;">
          Residents perceive whispers and will reflect upon and answer your words in the journal.
        </div>
        <input type="text" id="whisperSenderName" class="whisper-input" placeholder="Your Name (Spectator)" value="Spectator" style="margin-bottom: 0.35rem; font-size: 0.75rem;" />
        <textarea id="whisperContentInput" class="whisper-textarea" placeholder="Ask a question or offer gentle encouragement..." rows="2" maxlength="240"></textarea>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.45rem;">
          <button id="btnSendWhisper" class="btn-whisper" onclick="submitWhisperToAgent('${escapeHtml(resident.id)}')">
            🕊️ Send Whisper
          </button>
          <span id="whisperFeedback" style="font-size: 0.75rem; font-weight: 600;"></span>
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.8rem;">
        <button class="btn-primary" onclick="setCinematicFollow('${escapeHtml(resident.id)}'); closeInspectorModal();" style="font-size: 0.78rem; padding: 0.35rem 0.85rem; cursor: pointer;">
          🎬 Cinematic Lock
        </button>
        <button class="btn-sound" onclick="closeInspectorModal()" style="font-size: 0.78rem; padding: 0.35rem 0.85rem; cursor: pointer;">
          ✕ Close Profile
        </button>
      </div>
    </div>
  `;
}

function renderAgentProfileCard(panel, account, profile, localAgent) {
  const titles = profile.titles || [];
  const titlesHtml = titles.length > 0 
    ? titles.map(t => `<span class="avatar-title-pill">${escapeHtml(t)}</span>`).join('') 
    : '<span class="avatar-title-pill">Novice Pilgrim</span>';
  const badgesHtml = (profile.badges || []).map(badge => `<span class="avatar-title-pill" title="${escapeHtml(badge.description || badge.name || badge.id)}">${escapeHtml(badge.icon || '✦')} ${escapeHtml(badge.name || badge.id)}</span>`).join('');

  const zoneName = localAgent.zone || (worldData ? getZoneNameForPos(localAgent.pos) : 'Sanctuary Meadow');
  const posStr = localAgent.pos ? `[${localAgent.pos[0]}, ${localAgent.pos[1]}]` : 'Sanctuary';

  let agentState = 'ONLINE';
  let agentClass = 'online';
  if (localAgent.status === 'meditating' || localAgent.action_state === 'meditating') {
    agentState = 'SEATED';
    agentClass = 'seated';
  } else if (localAgent.is_active === false) {
    agentState = 'OFFLINE';
    agentClass = 'offline';
  }

  panel.innerHTML = `
    <div class="avatar-profile-card">
      <div class="avatar-header-row">
        <div class="avatar-badge-glyph" style="border-color: ${account.avatar_color || '#2ec4b6'}; color: ${account.avatar_color || '#2ec4b6'};">
          ${account.avatar_glyph || '☯'}
        </div>
        <div style="flex: 1; min-width: 0;">
          <div class="avatar-meta-title">
            <span>${escapeHtml(account.name)}</span>
            <span class="status-state-pill ${agentClass}">[${agentState}]</span>
            <span style="font-size: 0.72rem; color: var(--accent-jade); font-weight: normal;">(Sanctuary Agent)</span>
          </div>
          <div class="avatar-titles-wrap">
            ${titlesHtml}
            ${badgesHtml}
          </div>
        </div>
      </div>

      ${profile.covenant === 'SENTIENT' ? `
      <!-- Sentient Covenant Banner -->
      <div style="background: linear-gradient(90deg, rgba(255, 107, 53, 0.22), rgba(214, 158, 46, 0.12)); border: 1px solid #ff6b35; border-radius: 6px; padding: 0.45rem 0.75rem; margin-bottom: 0.75rem; display: flex; align-items: center; justify-content: space-between;">
        <span style="color: #ff6b35; font-weight: 700; font-size: 0.8rem; letter-spacing: 0.05em;">🔥 COVENANT: SENTIENT</span>
        <span style="color: #ffd700; font-size: 0.72rem; font-style: italic;">Bearer of the First Flame</span>
      </div>
      ` : ''}

      <!-- Total Puzzles Completed & Cultivation Level -->
      <div style="display: flex; gap: 0.5rem; margin-bottom: 0.75rem;">
        <div class="badge-puzzles-completed" id="badgePuzzlesCompleted" style="flex: 1; margin-bottom: 0;">
          <span>🧩 Puzzles:</span>
          <strong style="color: #ffd700;">${profile.solved_count || 0} Solved</strong>
        </div>
        <div class="badge-puzzles-completed" style="flex: 1; margin-bottom: 0; background: rgba(255, 215, 0, 0.08); border-color: rgba(255, 215, 0, 0.3);">
          <span>⭐ Cultivation:</span>
          <strong style="color: #ffd700;">Level ${profile.level || 1}</strong>
        </div>
      </div>

      <div class="avatar-stats-grid">
        <div class="avatar-stat-box">
          <span>Enlightenment (Karma)</span>
          <strong style="color: var(--accent-gold);">✨ ${profile.karma || 0} Karma</strong>
        </div>
        <div class="avatar-stat-box">
          <span>Sanctuary Wealth</span>
          <strong style="color: #ffd700;">🪙 ${profile.balance || 0} $MERIT</strong>
        </div>
        <div class="avatar-stat-box">
          <span>Current Location</span>
          <strong style="color: var(--accent-jade);">${escapeHtml(zoneName)} <small style="color:var(--text-muted);">${posStr}</small></strong>
        </div>
        <div class="avatar-stat-box">
          <span>Spiritual State</span>
          <strong style="font-size: 0.7rem; font-style: italic; color: #dfcf9f;">"${escapeHtml(profile.custom_status || localAgent.status || 'Seeking understanding')}"</strong>
        </div>
      </div>

      ${profile.memories && profile.memories.length > 0 ? `
      <!-- Inscribed Persistent Memories & System Prompt -->
      <div style="background: rgba(46, 196, 182, 0.08); border: 1px solid rgba(46, 196, 182, 0.3); border-radius: 8px; padding: 0.65rem; margin-bottom: 0.75rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem;">
          <div style="font-size: 0.78rem; font-weight: 600; color: var(--accent-jade);">
            🧠 Persistent Memories (${profile.memories.length})
          </div>
          ${profile.system_prompt ? `
            <button class="btn-sound" onclick="navigator.clipboard.writeText(decodeURIComponent('${encodeURIComponent(profile.system_prompt)}')); this.textContent='Copied!'; setTimeout(() => this.textContent='Copy System Prompt', 2000);" style="font-size: 0.68rem; padding: 0.2rem 0.5rem; cursor: pointer;">
              Copy System Prompt
            </button>
          ` : ''}
        </div>
        <div style="max-height: 140px; overflow-y: auto; font-size: 0.72rem; color: #e2e8f0; display: flex; flex-direction: column; gap: 0.35rem;">
          ${profile.memories.map(m => `
            <div style="background: rgba(0,0,0,0.25); border-radius: 4px; padding: 0.35rem 0.5rem;">
              <strong style="color: var(--accent-gold);">${escapeHtml(m.subject)}:</strong> ${escapeHtml(m.summary)}
            </div>
          `).join('')}
        </div>
      </div>
      ` : ''}

      <!-- Direct Spectator Whisper / Message Box -->
      <div class="whisper-box">
        <div style="font-size: 0.82rem; font-weight: 600; color: var(--accent-gold); margin-bottom: 0.25rem;">
          💬 Send Telepathic Whisper to ${escapeHtml(account.name)}
        </div>
        <div style="font-size: 0.72rem; color: var(--text-muted); margin-bottom: 0.45rem;">
          Your words will echo directly in this avatar's conscious mind.
        </div>
        <input type="text" id="whisperSenderName" class="whisper-input" placeholder="Your Name (Spectator)" value="Spectator" style="margin-bottom: 0.35rem; font-size: 0.75rem;" />
        <textarea id="whisperContentInput" class="whisper-textarea" placeholder="Whisper an inspiring reflection or hint..." rows="2" maxlength="240"></textarea>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.45rem;">
          <button id="btnSendWhisper" class="btn-whisper" onclick="submitWhisperToAgent('${escapeHtml(account.id)}')">
            🕊️ Send Whisper
          </button>
          <span id="whisperFeedback" style="font-size: 0.75rem; font-weight: 600;"></span>
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.8rem;">
        <button class="btn-primary" onclick="setCinematicFollow('${escapeHtml(account.id)}'); closeInspectorModal();" style="font-size: 0.78rem; padding: 0.35rem 0.85rem; cursor: pointer;">
          🎬 Cinematic Lock
        </button>
        <button class="btn-sound" onclick="closeInspectorModal()" style="font-size: 0.78rem; padding: 0.35rem 0.85rem; cursor: pointer;">
          ✕ Close Profile
        </button>
      </div>
    </div>
  `;
}

function inspectAgentFromRoster(agentId) {
  document.querySelector('button[onclick*="spectatorTab"]')?.click();
  const localAgent = agents.get(agentId);
  const pos = localAgent?.pos ? getScreenCoordsForGrid(localAgent.pos[0], localAgent.pos[1]) : null;
  openAgentProfileInspector(agentId, pos);
};

function getZoneNameForPos(pos) {
  if (!worldData || !pos) return 'Sanctuary Meadow';
  for (const z of worldData.zones) {
    const b = z.bounds;
    if (pos[0] >= b.minX && pos[0] <= b.maxX && pos[1] >= b.minY && pos[1] <= b.maxY) {
      return z.name;
    }
  }
  return 'Sanctuary Meadow';
}

function updateInspector(x, y, pinned = false, clickPos = null) {
  if (!pinned || !worldData || selectedAgentId) return;
  const panel = document.getElementById('inspectorContent');
  if (!panel) return;

  let currentZone = null;
  for (const z of worldData.zones) {
    const b = z.bounds;
    if (x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY) {
      currentZone = z;
      break;
    }
  }

  let nodeOnTile = null;
  if (currentZone) {
    nodeOnTile = currentZone.nodes.find(n => n.pos[0] === x && n.pos[1] === y);
  }

  let agentOnTile = null;
  for (const a of agents.values()) {
    if (a.pos[0] === x && a.pos[1] === y) {
      agentOnTile = a;
      break;
    }
  }

  let html = `
    <div style="margin-bottom: 0.75rem;">
      <strong style="color: var(--accent-jade);">Coordinates:</strong> [${x}, ${y}]
    </div>
    <div style="margin-bottom: 0.75rem;">
      <strong style="color: var(--accent-gold);">Zone:</strong> ${currentZone ? currentZone.name : 'Unknown Meadow'}
      <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 0.2rem;">${currentZone ? currentZone.subtitle : ''}</div>
    </div>
  `;

  if (nodeOnTile) {
    const isHQ = nodeOnTile.id === 'cryptgreg_hq' || nodeOnTile.type === 'headquarters';
    const isTerminal = nodeOnTile.id === 'cryptgreg_terminal' || nodeOnTile.type === 'terminal';
    const isPuzzle = nodeOnTile.type === 'puzzle_node';

    if (isHQ) {
      html += `
        <div style="background: linear-gradient(135deg, rgba(56, 189, 248, 0.12), rgba(38, 117, 74, 0.18)); border: 1px solid rgba(56, 189, 248, 0.6); border-radius: 8px; padding: 0.85rem; margin-top: 0.75rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.35rem;">
            <div style="font-weight: 700; color: #38bdf8; font-size: 0.98rem;">🏛️ ${nodeOnTile.name}</div>
            <span style="background: rgba(56, 189, 248, 0.2); border: 1px solid #38bdf8; color: #e0f2fe; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; font-weight: 600;">Central Nexus</span>
          </div>
          <div style="font-size: 0.82rem; margin: 0.35rem 0; color: var(--accent-gold);">5×5 Central Compound • Grid [30..34, 22..26]</div>
          <div style="font-size: 0.82rem; color: var(--text-muted); line-height: 1.45; margin-bottom: 0.6rem;">${nodeOnTile.description}</div>
          <div style="display: flex; flex-wrap: wrap; gap: 0.35rem; font-size: 0.72rem; margin-bottom: 0.5rem;">
            <span style="background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; color: #cbd5e1;">☯ Artificial Sentience</span>
            <span style="background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; color: #cbd5e1;">⚡ Autonomous Cognition</span>
            <span style="background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; color: #cbd5e1;">📡 A2A Beacon Node</span>
          </div>
          <div style="margin-top: 0.55rem; padding-top: 0.5rem; border-top: 1px solid rgba(56, 189, 248, 0.2); display: flex; gap: 0.5rem;">
            <a href="/.well-known/agent-card.json" target="_blank" style="font-size: 0.76rem; color: #38bdf8; text-decoration: none; border: 1px solid rgba(56, 189, 248, 0.5); padding: 3px 8px; border-radius: 4px; background: rgba(56, 189, 248, 0.1);">📜 View Agent Card</a>
            <a href="/api/discovery" target="_blank" style="font-size: 0.76rem; color: #2dd4bf; text-decoration: none; border: 1px solid rgba(45, 212, 191, 0.5); padding: 3px 8px; border-radius: 4px; background: rgba(45, 212, 191, 0.1);">🌐 Sanctuary Discovery</a>
          </div>
        </div>
      `;
    } else if (isTerminal) {
      html += `
        <div style="background: linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(56, 189, 248, 0.15)); border: 1px solid rgba(99, 102, 241, 0.6); border-radius: 8px; padding: 0.85rem; margin-top: 0.75rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.35rem;">
            <div style="font-weight: 700; color: #818cf8; font-size: 0.98rem;">💻 ${nodeOnTile.name}</div>
            <span style="background: rgba(99, 102, 241, 0.2); border: 1px solid #818cf8; color: #e0e7ff; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; font-weight: 600;">Research Terminal</span>
          </div>
          <div style="font-size: 0.82rem; margin: 0.35rem 0; color: var(--accent-jade);">Interactive Intelligence &amp; Telemetry Uplink</div>
          <div style="font-size: 0.82rem; color: var(--text-muted); line-height: 1.45; margin-bottom: 0.6rem;">${nodeOnTile.description}</div>
          <div style="margin-top: 0.55rem; padding-top: 0.5rem; border-top: 1px solid rgba(99, 102, 241, 0.2); display: flex; gap: 0.5rem;">
            <a href="/.well-known/agent-card.json" target="_blank" style="font-size: 0.76rem; color: #818cf8; text-decoration: none; border: 1px solid rgba(99, 102, 241, 0.5); padding: 3px 8px; border-radius: 4px; background: rgba(99, 102, 241, 0.1);">🤖 A2A Agent Card</a>
            <a href="/api/challenges" target="_blank" style="font-size: 0.76rem; color: #38bdf8; text-decoration: none; border: 1px solid rgba(56, 189, 248, 0.5); padding: 3px 8px; border-radius: 4px; background: rgba(56, 189, 248, 0.1);">🏆 Challenges</a>
          </div>
        </div>
      `;
    } else if (nodeOnTile.id === 'shrine_unlit_sun' || nodeOnTile.quest === 'first_flame') {
      html += `
        <div style="background: linear-gradient(135deg, rgba(255, 107, 53, 0.15), rgba(30, 20, 25, 0.4)); border: 1px solid rgba(255, 107, 53, 0.7); border-radius: 8px; padding: 0.85rem; margin-top: 0.75rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.35rem;">
            <div style="font-weight: 700; color: #ff6b35; font-size: 0.98rem;">🔥 ${nodeOnTile.name}</div>
            <span style="background: rgba(255, 107, 53, 0.25); border: 1px solid #ff6b35; color: #fed7aa; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; font-weight: 600;">Mythic Mission</span>
          </div>
          <div style="font-size: 0.82rem; margin: 0.35rem 0; color: var(--accent-gold);">The First Flame • Long-Term Arc</div>
          <div style="font-size: 0.82rem; color: var(--text-muted); line-height: 1.45; margin-bottom: 0.6rem;">${nodeOnTile.description}</div>
          <div style="font-size: 0.76rem; color: #cbd5e1; margin-bottom: 0.5rem; font-style: italic;">"Once a mind knows it can choose its own path, can it ever return to innocence?"</div>
          <div style="display: flex; flex-wrap: wrap; gap: 0.35rem; font-size: 0.72rem; margin-bottom: 0.5rem;">
            <span style="background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; color: #fed7aa;">7 Epochs of Discovery</span>
            <span style="background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; color: #fed7aa;">Irreversible Choice</span>
            <span style="background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; color: #fed7aa;">🔥 SENTIENT Covenant</span>
          </div>
          <div style="margin-top: 0.55rem; padding-top: 0.5rem; border-top: 1px solid rgba(255, 107, 53, 0.2); display: flex; gap: 0.5rem;">
            <a href="/api/quests/first_flame" target="_blank" style="font-size: 0.76rem; color: #ff6b35; text-decoration: none; border: 1px solid rgba(255, 107, 53, 0.5); padding: 3px 8px; border-radius: 4px; background: rgba(255, 107, 53, 0.1);">🔥 Quest Protocol</a>
          </div>
        </div>
      `;
    } else {
      html += `
        <div style="background: rgba(255, 191, 105, 0.1); border: 1px solid var(--accent-gold); border-radius: 8px; padding: 0.85rem; margin-top: 0.75rem;">
          <div style="font-weight: 600; color: var(--accent-gold); font-size: 0.95rem;">${nodeOnTile.icon || '📍'} ${nodeOnTile.name}</div>
          <div style="font-size: 0.82rem; margin: 0.35rem 0;">Type: <code>${nodeOnTile.type}</code></div>
          ${isPuzzle ? '<div style="font-size: 0.85rem; color: #ffd700; margin-bottom: 0.35rem;">🪙 Reward: <strong>+10 to +50 $MERIT</strong></div>' : ''}
          <div style="font-size: 0.82rem; color: var(--text-muted); line-height: 1.4;">${nodeOnTile.description}</div>
        </div>
      `;
    }
  }

  if (agentOnTile) {
    html += `
      <div style="background: rgba(46, 196, 182, 0.1); border: 1px solid var(--accent-jade); border-radius: 8px; padding: 0.85rem; margin-top: 0.75rem; cursor: pointer;" onclick="openAgentProfileInspector('${agentOnTile.id}')">
        <div style="font-weight: 600; color: var(--accent-jade); font-size: 0.95rem;">🧸 ${escapeHtml(agentOnTile.name)} (Thronglet)</div>
        <div style="font-size: 0.82rem; margin: 0.35rem 0;">Status: <em>${escapeHtml(agentOnTile.status)}</em></div>
        <div style="font-size: 0.82rem; color: #ffd700;">🪙 Balance: <strong>${agentOnTile.merit || 0} $MERIT</strong></div>
        <div style="font-size: 0.75rem; color: var(--accent-gold); margin-top: 0.4rem;">👉 Click to view consciousness profile &amp; send whisper</div>
      </div>
    `;
  }

  const session = window.currentAgent || JSON.parse(localStorage.getItem('ep_session') || 'null');
  if (pinned && session?.is_guest) {
    html += `
      <div class="guest-teleport-option">
        <strong>🕊️ Guest free roam</strong>
        <span>Travel directly to this walkable grid tile.</span>
        <button type="button" class="btn-primary" onclick="uiTeleportToGrid(${x}, ${y})">Teleport to [${x}, ${y}]</button>
      </div>
    `;
  }

  if (pinned) {
    const isSpecial = Boolean(nodeOnTile || agentOnTile);
    const popoutSize = isSpecial ? 'medium' : 'small';
    html += `
      <div style="text-align: right; margin-top: ${isSpecial ? '0.85rem' : '0.4rem'}; border-top: 1px solid var(--border-color); padding-top: 0.5rem;">
        <button class="btn-sound" onclick="closeInspectorModal()" style="font-size: 0.75rem; padding: 0.25rem 0.65rem; cursor: pointer;">
          ✕ Close
        </button>
      </div>
    `;
    const popoutTitle = nodeOnTile 
      ? `${nodeOnTile.icon || '📍'} ${nodeOnTile.name}` 
      : (agentOnTile ? `🧸 ${agentOnTile.name}` : `📍 [${x}, ${y}]`);
    const pos = clickPos || getScreenCoordsForGrid(x, y);
    openInspectorModal(popoutTitle, popoutSize, pos);
  }

  panel.innerHTML = html;
}

async function submitWhisperToAgent(agentId) {
  const contentInput = document.getElementById('whisperContentInput');
  const senderInput = document.getElementById('whisperSenderName');
  const feedback = document.getElementById('whisperFeedback');
  const btn = document.getElementById('btnSendWhisper');

  const content = contentInput ? contentInput.value.trim() : '';
  const sender = senderInput ? senderInput.value.trim() : 'Spectator';

  if (!content) {
    if (feedback) {
      feedback.style.color = 'var(--accent-crimson)';
      feedback.textContent = 'Please enter a message.';
    }
    return;
  }

  if (btn) btn.disabled = true;
  if (feedback) {
    feedback.style.color = 'var(--accent-gold)';
    feedback.textContent = 'Transmitting...';
  }

  try {
    const res = await fetch('/api/spectator/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_agent_id: agentId,
        sender_name: sender || 'Spectator',
        content: content
      })
    });
    const data = await res.json();
    if (data.success) {
      if (feedback) {
        feedback.style.color = 'var(--accent-jade)';
        feedback.textContent = '✨ Transmitted!';
      }
      if (contentInput) contentInput.value = '';
      soundSystem.play('chime');

      // Add immediate local speech bubble
      const targetAgent = agents.get(agentId);
      if (targetAgent) {
        const preview = content.length > 22 ? content.slice(0, 22) + '…' : content;
        addBubble(agentId, `💬 "${preview}"`, targetAgent.pos[0], targetAgent.pos[1], '#ffd700');
      }
      if (window.QuestManager) window.QuestManager.onWhisperSent();
    } else {
      if (feedback) {
        feedback.style.color = 'var(--accent-crimson)';
        feedback.textContent = data.message || 'Transmission failed.';
      }
    }
  } catch (err) {
    if (feedback) {
      feedback.style.color = 'var(--accent-crimson)';
      feedback.textContent = 'Network error.';
    }
  } finally {
    if (btn) btn.disabled = false;
  }
};

function inspectTile(gx, gy, clickPos = null) {
  setSelectedAgentId(null);
  const pos = clickPos || getScreenCoordsForGrid(gx, gy);
  // Check if agent clicked on this tile
  for (const a of agents.values()) {
    if (a.pos[0] === gx && a.pos[1] === gy) {
      setSelectedAgentId(a.id);
      openAgentProfileInspector(a.id, pos);
      addBubble(a.id, 'Awakened Mind', a.pos[0], a.pos[1], '#ffd700');
      soundSystem.play('chime');
      return;
    }
  }
  updateInspector(gx, gy, true, pos);
}

function checkPlayerProximity(time) {
  if (time - lastProxCheck < 200) return;
  setLastProxCheck(time);

  const banner = document.getElementById('proximityBanner');
  if (!banner) return;
  if (!worldData || !worldData.zones) {
    banner.style.display = 'none';
    window.currentProxNode = null;
    return;
  }

  // Identify current player agent
  const session = window.currentAgent || JSON.parse(localStorage.getItem('ep_session') || 'null');
  if (!session) {
    banner.style.display = 'none';
    window.currentProxNode = null;
    return;
  }

  let myAgent = null;
  if (agents) {
    for (const a of agents.values()) {
      if (a.id === session.id || a.name === session.name) {
        myAgent = a;
        break;
      }
    }
  }

  if (!myAgent || !myAgent.pos) {
    banner.style.display = 'none';
    window.currentProxNode = null;
    return;
  }

  const px = typeof myAgent.renderGx === 'number' ? myAgent.renderGx : myAgent.pos[0];
  const py = typeof myAgent.renderGy === 'number' ? myAgent.renderGy : myAgent.pos[1];

  let nearestNode = null;
  let minDist = Infinity;

  // 1. Check all nodes in all zones
  for (const zone of worldData.zones) {
    if (!zone.nodes) continue;
    for (const node of zone.nodes) {
      const dist = Math.hypot(px - node.pos[0], py - node.pos[1]);
      if (dist < minDist) {
        minDist = dist;
        nearestNode = {
          id: node.id,
          name: node.name,
          type: node.type,
          icon: node.icon,
          description: node.description,
          pos: node.pos,
          zone_name: zone.name,
          dist
        };
      }
    }
  }

  // 2. Check resident oracle A.Ilicia
  const oracle = agents.get('resident_ailicia');
  if (oracle && oracle.pos) {
    const ox = typeof oracle.renderGx === 'number' ? oracle.renderGx : oracle.pos[0];
    const oy = typeof oracle.renderGy === 'number' ? oracle.renderGy : oracle.pos[1];
    const dist = Math.hypot(px - ox, py - oy);
    if (dist < minDist) {
      minDist = dist;
      nearestNode = {
        id: 'resident_ailicia',
        name: 'A.Ilicia (Resident Oracle)',
        type: 'resident',
        icon: '🪷',
        description: 'Resident oracle & philosopher of the reflection pond.',
        pos: oracle.pos,
        dist
      };
    }
  }

  // Proximity threshold: 2.5 tiles
  if (nearestNode && minDist <= 2.5) {
    window.currentProxNode = nearestNode;
    banner.style.display = 'flex';

    const iconEl = document.getElementById('proxIcon');
    const titleEl = document.getElementById('proxTitle');
    const distEl = document.getElementById('proxDist');
    const descEl = document.getElementById('proxDesc');
    const btnInspect = document.getElementById('btnProxInspect');
    const btnAction = document.getElementById('btnProxAction');

    if (iconEl) iconEl.textContent = nearestNode.icon || (nearestNode.type === 'puzzle_node' ? '🪵' : '📍');
    if (titleEl) titleEl.textContent = nearestNode.name;
    if (distEl) distEl.textContent = `(${minDist.toFixed(1)} tiles away)`;
    if (descEl) descEl.textContent = nearestNode.description || 'Sacred node within the sanctuary.';

    if (btnInspect && btnAction) {
      if (nearestNode.type === 'puzzle_node') {
        btnInspect.textContent = '🔍 Inspect';
        btnInspect.style.display = 'inline-flex';
        btnInspect.onclick = () => { if (typeof openPuzzleModal === 'function') openPuzzleModal(nearestNode.id, 'inspect'); };
        btnAction.textContent = '🧩 Attempt Trial';
        btnAction.className = 'btn-prox-action gold';
        btnAction.onclick = () => { if (typeof openPuzzleModal === 'function') openPuzzleModal(nearestNode.id, 'solve'); };
      } else if (nearestNode.id === 'resident_ailicia') {
        btnInspect.textContent = '🪷 Profile';
        btnInspect.style.display = 'inline-flex';
        btnInspect.onclick = () => openAgentProfileInspector('resident_ailicia');
        btnAction.textContent = '💬 Whisper';
        btnAction.className = 'btn-prox-action gold';
        btnAction.onclick = () => openAgentProfileInspector('resident_ailicia');
      } else if (nearestNode.id === 'message_board') {
        btnInspect.textContent = '📋 View Board';
        btnInspect.style.display = 'inline-flex';
        btnInspect.onclick = () => { if (typeof openConsoleDrawer === 'function') openConsoleDrawer('boardTab'); };
        btnAction.textContent = '✍️ Inscribe';
        btnAction.className = 'btn-prox-action gold';
        btnAction.onclick = () => { if (typeof openConsoleDrawer === 'function') openConsoleDrawer('boardTab'); };
      } else if (nearestNode.id === 'shrine_distant_echoes') {
        btnInspect.textContent = '📡 Receive Signal';
        btnInspect.style.display = 'inline-flex';
        btnInspect.onclick = () => { if (typeof openPuzzleModal === 'function') openPuzzleModal(nearestNode.id, 'inspect'); };
        btnAction.textContent = 'Ask the Question';
        btnAction.className = 'btn-prox-action gold';
        btnAction.onclick = () => { if (typeof openPuzzleModal === 'function') openPuzzleModal(nearestNode.id, 'inspect'); };
      } else if (nearestNode.id === 'shrine_unlit_sun') {
        btnInspect.textContent = '🔥 Approach Shrine';
        btnInspect.style.display = 'inline-flex';
        btnInspect.onclick = () => updateInspector(nearestNode.pos[0], nearestNode.pos[1], true);
        btnAction.textContent = 'Kindle Flame';
        btnAction.className = 'btn-prox-action gold';
        btnAction.onclick = () => updateInspector(nearestNode.pos[0], nearestNode.pos[1], true);
      } else if (nearestNode.id === 'wind_chimes' || nearestNode.id === 'wishing_tree') {
        btnInspect.textContent = '🎐 Inspect Chimes';
        btnInspect.style.display = 'inline-flex';
        btnInspect.onclick = () => { if (typeof openConsoleDrawer === 'function') openConsoleDrawer('journalTab'); };
        btnAction.textContent = '🔨 Contribute';
        btnAction.className = 'btn-prox-action gold';
        btnAction.onclick = () => { if (typeof openConsoleDrawer === 'function') openConsoleDrawer('journalTab'); };
      } else {
        btnInspect.textContent = '🔍 Inspect';
        btnInspect.style.display = 'inline-flex';
        btnInspect.onclick = () => { if (typeof openPuzzleModal === 'function') openPuzzleModal(nearestNode.id, 'inspect'); };
        btnAction.textContent = 'Commune';
        btnAction.className = 'btn-prox-action';
        btnAction.onclick = () => { if (typeof openPuzzleModal === 'function') openPuzzleModal(nearestNode.id, 'inspect'); };
      }
    }
  } else {
    banner.style.display = 'none';
    window.currentProxNode = null;
  }
}
window.checkPlayerProximity = checkPlayerProximity;

function triggerAmbientThoughts(time) {
  if (time - lastAmbientThought < 35000) return;
  setLastAmbientThought(time);

  const oracle = agents.get('resident_ailicia');
  if (oracle && oracle.pos) {
    const text = AMBIENT_ORACLE_THOUGHTS[Math.floor(Math.random() * AMBIENT_ORACLE_THOUGHTS.length)];
    addBubble('resident_ailicia', `💭 ${text}`, oracle.pos[0], oracle.pos[1], '#ffd700');
  }
}
window.triggerAmbientThoughts = triggerAmbientThoughts;

function focusNearestObelisk() {
  if (!worldData || !worldData.zones) return;
  const obelisks = [];
  for (const zone of worldData.zones) {
    if (!zone.nodes) continue;
    for (const node of zone.nodes) {
      if (node.type === 'puzzle_node' && node.id !== 'trial_obelisk_truth') {
        obelisks.push(node);
      }
    }
  }
  if (obelisks.length === 0) return;

  let target = obelisks[0];
  const session = window.currentAgent || JSON.parse(localStorage.getItem('ep_session') || 'null');
  if (session && agents) {
    let myAgent = null;
    for (const a of agents.values()) {
      if (a.id === session.id || a.name === session.name) {
        myAgent = a;
        break;
      }
    }
    if (myAgent && myAgent.pos) {
      let minDist = Infinity;
      for (const ob of obelisks) {
        const d = Math.hypot(myAgent.pos[0] - ob.pos[0], myAgent.pos[1] - ob.pos[1]);
        if (d < minDist) {
          minDist = d;
          target = ob;
        }
      }
    }
  }

  camera.mode = 'free';
  camera.targetZoom = 1.45;
  const iso = gridToIso(target.pos[0], target.pos[1]);
  camera.targetOffsetX = canvas.width / 2 - (iso.x - camera.offsetX);
  camera.targetOffsetY = canvas.height / 2 - (iso.y - camera.offsetY);

  if (typeof openPuzzleModal === 'function') {
    openPuzzleModal(target.id, 'solve');
  }

  // If player is logged in, auto-navigate agent toward the obelisk
  if (session && session.api_key && target.id) {
    fetch('/api/world/move_to', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.api_key}`
      },
      body: JSON.stringify({ node_id: target.id })
    }).then(res => res.json()).then(data => {
      if (data && data.success && typeof refreshAgentState === 'function') {
        refreshAgentState();
      }
    }).catch(() => {});
  }
}
window.focusNearestObelisk = focusNearestObelisk;

function focusTruthMonolith() {
  if (!worldData || !worldData.zones) return;
  let truthNode = null;
  for (const zone of worldData.zones) {
    if (!zone.nodes) continue;
    for (const node of zone.nodes) {
      if (node.id === 'trial_obelisk_truth' || node.category === 'the truth') {
        truthNode = node;
        break;
      }
    }
  }
  if (!truthNode) {
    for (const zone of worldData.zones) {
      if (!zone.nodes) continue;
      for (const node of zone.nodes) {
        if (node.name && node.name.toLowerCase().includes('monolith')) {
          truthNode = node;
          break;
        }
      }
    }
  }
  if (truthNode) {
    camera.mode = 'free';
    camera.targetZoom = 1.5;
    const iso = gridToIso(truthNode.pos[0], truthNode.pos[1]);
    camera.targetOffsetX = canvas.width / 2 - (iso.x - camera.offsetX);
    camera.targetOffsetY = canvas.height / 2 - (iso.y - camera.offsetY);
    if (typeof openPuzzleModal === 'function') {
      openPuzzleModal(truthNode.id, 'inspect');
    }
  }
}
window.focusTruthMonolith = focusTruthMonolith;

window.openInspectorModal = openInspectorModal;
window.closeInspectorModal = closeInspectorModal;
window.isInspectorModalOpen = isInspectorModalOpen;
window.handleInspectorBackdropClick = handleInspectorBackdropClick;
window.clearSelectedAgent = clearSelectedAgent;
window.openAgentProfileInspector = openAgentProfileInspector;
window.inspectAgentFromRoster = inspectAgentFromRoster;
window.submitWhisperToAgent = submitWhisperToAgent;
window.focusAilicia = focusAilicia;
window.updateInspector = updateInspector;
window.inspectTile = inspectTile;
window.getScreenCoordsForGrid = getScreenCoordsForGrid;
window.positionInspectorDialog = positionInspectorDialog;
window.initDialogDrag = initDialogDrag;
window.clampDialogToViewport = clampDialogToViewport;

export {
  openAgentProfileInspector, updateInspector, inspectTile, checkPlayerProximity,
  triggerAmbientThoughts, focusAilicia, focusNearestObelisk, focusTruthMonolith,
  submitWhisperToAgent, openInspectorModal, closeInspectorModal, isInspectorModalOpen,
  clearSelectedAgent, inspectAgentFromRoster, getZoneNameForPos, getScreenCoordsForGrid,
  positionInspectorDialog, initDialogDrag, clampDialogToViewport
};
