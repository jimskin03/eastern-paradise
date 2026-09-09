import { apiFetch } from '../../api/client.js';

function elapsedLabel(createdAt) {
  if (!createdAt) return 'quiet now';
  const minutes = Math.max(0, Math.floor((Date.now() - Number(createdAt)) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function renderActivity(activity) {
  const card = document.getElementById('happeningNowCard');
  if (!card || !activity) return;
  const title = document.getElementById('happeningNowTitle');
  const description = document.getElementById('happeningNowDescription');
  const meta = document.getElementById('happeningNowMeta');
  const action = document.getElementById('happeningNowAction');
  if (title) title.textContent = activity.title || 'The sanctuary is listening';
  if (description) description.textContent = activity.description || 'No public trace is available yet.';
  if (meta) meta.textContent = `${activity.actor_name || 'Sanctuary'} · ${elapsedLabel(activity.created_at)}`;
  if (action) {
    if (activity.kind === 'agent' && activity.agent_id) {
      action.hidden = false;
      action.textContent = 'Watch';
      action.onclick = () => window.focusAgentInCinematic?.(activity.agent_id);
    } else {
      action.hidden = false;
      action.textContent = 'Open Journal';
      action.onclick = () => window.openConsoleDrawer?.('journalTab');
    }
  }
}

export async function refreshHappeningNow() {
  const card = document.getElementById('happeningNowCard');
  if (!card) return;
  try {
    const response = await apiFetch('/api/discovery');
    if (!response.ok) throw new Error(`Discovery returned ${response.status}`);
    const data = await response.json();
    renderActivity(data.happening_now);
  } catch (_) {
    renderActivity({
      kind: 'quiet',
      title: 'The sanctuary is resting',
      description: 'The latest trace is available in the Journal.',
      actor_name: 'Sanctuary'
    });
  }
}

export function toggleHappeningNow(force) {
  const card = document.getElementById('happeningNowCard');
  const button = document.getElementById('btnHappeningNow');
  if (!card) return false;
  const shouldOpen = typeof force === 'boolean' ? force : !card.classList.contains('open');
  card.classList.toggle('open', shouldOpen);
  card.setAttribute('aria-hidden', String(!shouldOpen));
  if (button) button.setAttribute('aria-expanded', String(shouldOpen));
  if (shouldOpen) refreshHappeningNow();
  return shouldOpen;
}

window.addEventListener('keydown', event => {
  if (event.key === 'Escape') toggleHappeningNow(false);
});

export function initHappeningNow() {
  refreshHappeningNow();
  // Refresh occasionally while the page is open, without turning this card
  // into a polling dashboard.
  window.setInterval(refreshHappeningNow, 60 * 1000);
}
