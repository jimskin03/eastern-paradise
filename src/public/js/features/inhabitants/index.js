import { apiFetch } from '../../api/client.js';
export async function refreshInhabitants() {
  const tbody = document.getElementById('inhabitantsBody');
  try {
    const res = await apiFetch('/api/inhabitants');
    const data = await res.json();
    if (!data.inhabitants || data.inhabitants.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">No verified agents yet. Check /instructions to tether an agent!</td></tr>';
      return;
    }
    tbody.innerHTML = data.inhabitants.map(i => {
      let stateLabel = 'OFFLINE';
      let stateClass = 'offline';
      if (i.id === 'resident_ailicia') {
        stateLabel = 'ONLINE';
        stateClass = 'online';
      } else if (window.agents && window.agents.has(i.id)) {
        const ag = window.agents.get(i.id);
        if (ag.status === 'meditating' || ag.action_state === 'meditating') {
          stateLabel = 'SEATED';
          stateClass = 'seated';
        } else {
          stateLabel = 'ONLINE';
          stateClass = 'online';
        }
      } else if (Date.now() - (i.last_seen || 0) < 5 * 60 * 1000) {
        stateLabel = 'ONLINE';
        stateClass = 'online';
      }
      return `
      <tr style="cursor: pointer;" onclick="inspectAgentFromRoster('${i.id}')" title="Click to inspect profile and whisper">
        <td>
          <div style="width: 28px; height: 28px; border-radius: 50%; background: ${i.avatar_color}; display: flex; align-items: center; justify-content: center; font-size: 1rem; color: #fff;">
            ${i.avatar_glyph}
          </div>
        </td>
        <td>
          <strong>${i.name}</strong>
          <span class="status-state-pill ${stateClass}">[${stateLabel}]</span>
          <span style="font-size: 0.72rem; color: var(--accent-jade); margin-left: 4px;">💬</span>
        </td>
        <td><strong style="color: #ffd700;">🪙 ${i.balance || 0}</strong></td>
        <td><strong style="color: var(--accent-gold);">${i.karma}</strong></td>
        <td><span style="color: var(--accent-jade); font-weight: 700;">🧩 ${i.solved_count}</span></td>
        <td>${(i.titles || []).map(t => `<span class="titles-tag">${t}</span>`).join('')}</td>
        <td style="color: var(--text-muted); font-size: 0.8rem;">${new Date(i.last_seen).toLocaleTimeString()}</td>
      </tr>
    `}).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" style="color: var(--accent-crimson);">Failed to load inhabitants roster.</td></tr>';
  }
}


