import { apiFetch } from '../../api/client.js';
export async function refreshJournal() {
  const recapContent = document.getElementById('journalRecapContent');
  const timeLabel = document.getElementById('journalLastVisitTime');
  const chimeDetails = document.getElementById('projectChimeDetails');
  const statusBadge = document.getElementById('projectStatusBadge');
  const eventsList = document.getElementById('journalEventsList');
   const lastVisitStr = localStorage.getItem('ep_last_visit');
  const lastVisit = lastVisitStr ? Number(lastVisitStr) : (Date.now() - 60 * 60 * 1000);
  const minutesAgo = Math.max(1, Math.round((Date.now() - lastVisit) / 60000));
  if (timeLabel) {
    timeLabel.textContent = lastVisitStr ? `${minutesAgo}m ago` : 'First visit';
  }
   // 1. Fetch Recap
  try {
    const recapRes = await apiFetch(`/api/journal/recap?since=${lastVisit}&limit=8`);
    const recapData = await recapRes.json();
    if (recapData.success && recapData.recap && recapData.recap.length > 0) {
      recapContent.innerHTML = recapData.recap.map(r => `
        <div style="margin-bottom: 0.4rem; padding-left: 0.5rem; border-left: 2px solid var(--accent-jade);">
          <strong>${window.escapeHtml(r.actor_name || 'Sanctuary')}:</strong> ${window.escapeHtml(r.description)}
        </div>
      `).join('');
    } else {
      recapContent.innerHTML = `<span style="color: var(--text-muted); font-style: italic;">The sanctuary has rested peacefully. No major events recorded since your arrival.</span>`;
    }
  } catch (err) {
    if (recapContent) recapContent.textContent = 'Unable to load recap.';
  }
   // Record this visit
  localStorage.setItem('ep_last_visit', Date.now());
   // 2. Fetch Projects (The Wishing-Tree Chime)
  try {
    const projRes = await apiFetch('/api/projects');
    const projData = await projRes.json();
    if (projData.success && projData.projects && projData.projects.length > 0) {
      const chime = projData.projects.find(p => p.id === 'obj_chime_bamboo') || projData.projects[0];
      const data = chime.data || {};
      const needed = data.materials_needed || {};
      const collected = data.materials_collected || {};
      const progress = data.repair_progress || 0;
       if (statusBadge) {
        statusBadge.textContent = chime.state === 'completed' ? '✨ Fully Restored' : (chime.state === 'in_progress' ? '🔨 In Progress' : '⚠️ Damaged');
        statusBadge.className = chime.state === 'completed' ? 'badge-tag metal' : (chime.state === 'in_progress' ? 'badge-tag wood' : 'badge-tag fire');
      }
       let materialsHtml = '';
      for (const k of Object.keys(needed)) {
        const has = collected[k] || 0;
        const req = needed[k] || 1;
        const label = k.replace(/_/g, ' ');
        const isDone = has >= req;
        materialsHtml += `
          <span class="avatar-title-pill" style="border-color: ${isDone ? 'var(--accent-jade)' : '#e53e3e'}; color: ${isDone ? 'var(--accent-jade)' : '#fc8181'};">
            ${isDone ? '✓' : '○'} ${label} (${has}/${req})
          </span>
        `;
      }
       const contributors = chime.contributors || [];
      const contribNames = contributors.length > 0
        ? contributors.map(c => window.escapeHtml(c.name)).join(', ')
        : 'No contributions yet';
       if (chimeDetails) {
        chimeDetails.innerHTML = `
          <div style="margin-bottom: 0.6rem;">
            <strong>${window.escapeHtml(data.name || 'Resonance Chimes')}</strong> — Status: <em>${window.escapeHtml(chime.state)}</em> (${progress}% Restored)
          </div>
          <div class="need-progress-track" style="height: 8px; margin-bottom: 0.75rem;">
            <div class="need-progress-fill curiosity" style="width: ${progress}%;"></div>
          </div>
          <div style="display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.75rem;">
            ${materialsHtml}
          </div>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.75rem;">
            Sanctuary Contributors: <strong>${contribNames}</strong>
          </div>
          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            <button class="btn-primary" style="font-size: 0.78rem; padding: 0.35rem 0.75rem;" onclick="uiContributeProject('repair_work')">
              🔨 Offer Restoration Effort
            </button>
            <button class="btn-secondary" style="font-size: 0.78rem; padding: 0.35rem 0.75rem;" onclick="uiContributeProject('willow_ribbon')">
              🎋 Tie Wishing Silk
            </button>
            <button class="btn-secondary" style="font-size: 0.78rem; padding: 0.35rem 0.75rem;" onclick="uiContributeProject('copper_striker')">
              ⚙️ Gift Copper Fitting
            </button>
          </div>
          <div id="projectContributeFeedback" style="margin-top: 0.5rem; font-size: 0.8rem;"></div>
        `;
      }
    }
  } catch (err) {
    if (chimeDetails) chimeDetails.textContent = 'Unable to load project status.';
  }
   // 3. Fetch Chronicle (All recent events)
  try {
    const eventsRes = await apiFetch('/api/journal?limit=30');
    const eventsData = await eventsRes.json();
    if (eventsData.success && eventsData.events && eventsData.events.length > 0) {
      if (eventsList) {
        eventsList.innerHTML = eventsData.events.map(e => {
          const time = new Date(e.created_at).toLocaleTimeString();
          let icon = '📖';
          if (e.event_type === 'resident_dialogue') icon = '💬';
          else if (e.event_type === 'whisper_answered') icon = '🕊️';
          else if (e.event_type === 'object_repaired' || e.event_type === 'project_contribution') icon = '🎐';
          else if (e.event_type === 'chime_ringing') icon = '🔔';
           return `
            <li class="activity-item" style="padding: 0.5rem 0; border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
              <span class="time">[${time}]</span>
              <span>${icon} <strong>${window.escapeHtml(e.actor_name || 'Sanctuary')}:</strong> ${window.escapeHtml(e.description)}</span>
            </li>
          `;
        }).join('');
      }
    } else {
      if (eventsList) eventsList.innerHTML = '<li class="activity-item">No world events recorded yet.</li>';
    }
  } catch (err) {
    if (eventsList) eventsList.innerHTML = '<li class="activity-item">Error reading chronicles.</li>';
  }
}
export async function uiContributeProject(itemType) {
  const fb = document.getElementById('projectContributeFeedback');
  if (fb) fb.innerHTML = '<span style="color: var(--accent-gold);">Contributing to the chime restoration...</span>';
   try {
    const headers = { 'Content-Type': 'application/json' };
    if (window.currentAgent && window.currentAgent.api_key) {
      headers['Authorization'] = `Bearer ${window.currentAgent.api_key}`;
    }
    const res = await apiFetch('/api/projects/contribute', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        item_type: itemType,
        quantity: 1,
        contributor_name: window.currentAgent ? window.currentAgent.name : 'Spectator Traveler'
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      if (fb) fb.innerHTML = `<span style="color: var(--accent-jade);">✨ ${window.escapeHtml(data.message)}</span>`;
      window.refreshJournal();
    } else {
      if (fb) fb.innerHTML = `<span style="color: var(--accent-crimson);">⚠️ ${window.escapeHtml(data.message || 'Contribution failed')}</span>`;
    }
  } catch (err) {
    if (fb) fb.innerHTML = '<span style="color: var(--accent-crimson);">Network error.</span>';
  }
}

