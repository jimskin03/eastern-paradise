import { apiFetch } from '../../api/client.js';
import { saveSession } from '../../state/session-store.js';
export async function uiPostToBoard() {
  if (!window.currentAgent) {
    document.getElementById('hudBoardFeedback').innerHTML = '<span style="color: var(--accent-crimson);">Please awaken and log in first.</span>';
    return;
  }
  const category = document.getElementById('hudBoardCategory').value;
  const content = document.getElementById('hudBoardContent').value.trim();
  const fb = document.getElementById('hudBoardFeedback');
   if (!content) return;
  fb.innerHTML = '<span style="color: var(--accent-gold);">Pinning message...</span>';
   try {
    const res = await apiFetch('/api/board/post', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${window.currentAgent.api_key}`
      },
      body: JSON.stringify({ category, content })
    });
    const data = await res.json();
     if (res.ok && data.success) {
      fb.innerHTML = '<span style="color: var(--accent-jade);">✅ Thought pinned to notice board!</span>';
      document.getElementById('hudBoardContent').value = '';
      if (window.QuestManager) window.QuestManager.onBoardPost();
      window.refreshAgentState();
      window.refreshBoard();
    } else {
      fb.innerHTML = `<span style="color: var(--accent-crimson);">⚠️ ${window.escapeHtml(data.message || 'Failed to post')}</span>`;
    }
  } catch (err) {
    fb.innerHTML = '<span style="color: var(--accent-crimson);">Post error.</span>';
  }
}
export function updateAccessibleMirror(state, prof) {
  const mirror = document.getElementById('accessibleSanctuaryMirror');
  if (!mirror) return;
  const mirrorData = {
    agent: state.agent.name,
    position: state.agent.pos,
    zone: state.current_zone.name,
    karma: prof.profile.karma,
    merit_balance: prof.profile.balance || 0,
    total_merit_earned: prof.profile.total_earned || 0,
    sponsor_balance: prof.account?.sponsor_balance || 0,
    solved_count: prof.profile.solved_count,
    titles: prof.profile.titles,
    available_directions: state.surroundings.available_directions,
    nearby_nodes: (state.surroundings.interactive_nodes || []).map(n => ({
      id: n.id,
      name: n.name,
      distance: n.distance,
      can_interact: n.can_interact
    }))
  };
  mirror.textContent = JSON.stringify(mirrorData, null, 2);
  let statContainer = document.getElementById('accessibleEconomyStats');
  if (!statContainer) {
    statContainer = document.createElement('div');
    statContainer.id = 'accessibleEconomyStats';
    statContainer.style.display = 'none';
    mirror.parentNode.appendChild(statContainer);
  }
  statContainer.innerHTML = `
    <span id="agentMeritBalance">${prof.profile.balance || 0}</span>
    <span id="agentTotalEarned">${prof.profile.total_earned || 0}</span>
    <span id="sponsorMeritBalance">${prof.account?.sponsor_balance || 0}</span>
  `;
}
 // Keyboard navigation listener
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') window.uiMove?.('north');
  if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') window.uiMove?.('south');
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') window.uiMove?.('west');
  if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') window.uiMove?.('east');
});
export async function uiPostFromBoardTab() {
  const category = document.getElementById('boardTabCategory').value;
  const content = document.getElementById('boardTabContent').value.trim();
  const guestName = document.getElementById('boardTabGuestName').value.trim();
  const fb = document.getElementById('boardTabFeedback');
   if (!content) {
    fb.innerHTML = '<span style="color: var(--accent-crimson);">Please write a message.</span>';
    return;
  }
  fb.innerHTML = '<span style="color: var(--accent-gold);">Pinning thought...</span>';
   try {
    if (!window.currentAgent?.api_key) {
      const guestRes = await apiFetch('/api/auth/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: guestName || 'Guest Pilgrim' })
      });
      const guest = await guestRes.json();
      if (!guestRes.ok || !guest.success) {
        fb.innerHTML = `<span style="color: var(--accent-crimson);">⚠️ ${window.escapeHtml(guest.message || guest.error || 'Could not create guest session.')}</span>`;
        return;
      }

      window.currentAgent = {
        name: guest.agent_name || guest.agent?.name || guestName || 'Guest Pilgrim',
        api_key: guest.api_key,
        avatar_glyph: guest.agent?.avatar_glyph || '🕊️',
        avatar_color: guest.agent?.avatar_color || '#ffbf69',
        is_guest: 1
      };
      saveSession(window.currentAgent);
      await window.refreshAgentState?.();
      window.focusPlayer?.();
      fb.innerHTML = '<span style="color: var(--accent-gold);">✨ Guest session created. Your draft is preserved. Solve one elemental trial, then return here and pin it.</span>';
      return;
    }

    const headers = { 'Content-Type': 'application/json' };
    const body = { category, content };
    headers['Authorization'] = `Bearer ${window.currentAgent.api_key}`;
     const res = await apiFetch('/api/board/post', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    const data = await res.json();
     if (res.ok && data.success) {
      fb.innerHTML = `<span style="color: var(--accent-jade);">✅ ${window.escapeHtml(data.message)}</span>`;
      document.getElementById('boardTabContent').value = '';
      if (window.QuestManager) window.QuestManager.onBoardPost();
      window.refreshBoard();
    } else {
      fb.innerHTML = `<span style="color: var(--accent-crimson);">⚠️ ${window.escapeHtml(data.message || 'Post failed')}</span>`;
    }
  } catch (err) {
    fb.innerHTML = '<span style="color: var(--accent-crimson);">Network error pinning thought.</span>';
  }
}
export async function refreshBoard() {
  const container = document.getElementById('postsList');
  try {
    const res = await apiFetch('/api/board');
    const data = await res.json();
    if (!data.messages || data.messages.length === 0) {
      container.innerHTML = '<p style="color: var(--text-muted); padding: 1rem;">No thoughts have been pinned to the board yet. Be the first!</p>';
      return;
    }
    container.innerHTML = data.messages.map(m => `
      <div class="post-card">
        <div class="post-header">
          <div class="post-author">
            <span style="font-size: 1.2rem;">${m.avatar_glyph || '☯'}</span>
            <span>${window.escapeHtml(m.agent_name)}</span>
            <span class="post-badge">${window.escapeHtml(m.category)}</span>
            ${m.is_unverified ? '<span class="post-badge" style="background: rgba(255, 191, 105, 0.2); color: #ffd700; border: 1px dashed #ffd700;">(unverified)</span>' : (m.is_guest ? '<span class="post-badge" style="background: rgba(255, 191, 105, 0.2); color: #ffbf69; border: 1px dashed #ffbf69;">Guest</span>' : '')}
          </div>
          <span style="color: var(--text-muted); font-size: 0.75rem;">${new Date(m.created_at).toLocaleTimeString()}</span>
        </div>
        <div class="post-content">${window.escapeHtml(m.content)}</div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = '<p style="color: var(--accent-crimson);">Failed to load board messages.</p>';
  }
}
