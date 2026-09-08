// Eastern Paradise — WebSocket connection to /ws/world: connection lifecycle,
// reconnect behavior, snapshot/delta processing, incoming world events and
// connection status UI. Extracted verbatim (PR #2); only shared-state
// reassignments were routed through state.js setters.

import {
  worldData, setWorldData, agents, serverState, setServerState,
  sanctuaryCirculation, setSanctuaryCirculation, canvas, escapeHtml, logActivity,
  addBubble, triggerShrineWave, setWs, getWs
} from './state.js';
import { soundSystem } from './audio.js';
import { fitTerrariumCamera, updateCanvasDimensions } from './camera.js';

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/world`;

  setWs(new WebSocket(wsUrl));

  getWs().onopen = () => {
    console.log('[Spectator] Connected to Eastern Paradise Isometric Live Stream.');
    const watermark = document.getElementById('feedSyncWatermark');
    if (watermark) watermark.textContent = `last-synced: ${new Date().toLocaleTimeString()} (live)`;
    const banner = document.getElementById('feedOfflineBanner');
    if (banner) banner.style.display = 'none';
  };

  getWs().onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleServerMessage(msg);
    } catch (err) {
      console.error('[Spectator] Error parsing message:', err);
    }
  };

  getWs().onclose = () => {
    const watermark = document.getElementById('feedSyncWatermark');
    if (watermark) watermark.textContent = 'last-synced: offline (reconnecting...)';
    const banner = document.getElementById('feedOfflineBanner');
    if (banner) banner.style.display = 'block';
    setTimeout(connectWebSocket, 3000);
  };
}

function handleServerMessage(msg) {
  const watermark = document.getElementById('feedSyncWatermark');
  if (watermark) watermark.textContent = `last-synced: ${new Date().toLocaleTimeString()} (live)`;

  switch (msg.type) {
    case 'init_world':
      setWorldData(msg.data);
      if (msg.server_state) updateServerStatus(msg.server_state);
      agents.clear();
      for (const a of (worldData.agents || [])) {
        agents.set(a.id, {
          ...a,
          curPos: [...a.pos],
          renderGx: a.pos[0],
          renderGy: a.pos[1],
          animOffset: Math.random() * 10,
          isMoving: false
        });
      }
      updateCanvasDimensions();
      fitTerrariumCamera();
      updateCounts();

      // Hydrate persistent activity feed from database history
      if (Array.isArray(msg.recent_logs) && msg.recent_logs.length > 0) {
        const feed = document.getElementById('activityFeed');
        if (feed) {
          feed.innerHTML = '';
          for (const l of msg.recent_logs) {
            const li = document.createElement('li');
            li.className = 'activity-item';
            const time = new Date(l.created_at).toLocaleTimeString();
            let text = escapeHtml(l.result);
            if (l.action_type === 'spectator_whisper') {
              text = `💬 ${escapeHtml(l.result)}`;
            } else if (l.action_type === 'solve_puzzle') {
              text = `✨ ${escapeHtml(l.result)}`;
            }
            li.innerHTML = `<span class="time">[${time}]</span> ${text}`;
            feed.appendChild(li); // append chronological order (newest on top)
          }
        }
      }
      break;

    case 'server_status':
      updateServerStatus(msg.state);
      if (msg.connected_spectators !== undefined) {
        document.getElementById('spectatorCount').textContent = msg.connected_spectators;
      }
      if (msg.active_agents !== undefined) {
        document.getElementById('agentCount').textContent = msg.active_agents;
      }
      break;

    case 'agent_spawned':
      agents.set(msg.agent.id, {
        ...msg.agent,
        curPos: [...msg.agent.pos],
        renderGx: msg.agent.pos[0],
        renderGy: msg.agent.pos[1],
        animOffset: Math.random() * 10,
        isMoving: false
      });
      updateCounts();
      logActivity(`Thronglet <strong>${escapeHtml(msg.agent.name)}</strong> awakened in the sanctuary.`);
      addBubble(msg.agent.id, 'Awakened!', msg.agent.pos[0], msg.agent.pos[1], '#ffbf69');
      break;

    case 'agent_moved': {
      const existing = agents.get(msg.agentId);
      if (existing) {
        const oldX = existing.pos ? existing.pos[0] : msg.pos[0];
        const oldY = existing.pos ? existing.pos[1] : msg.pos[1];
        const dx = msg.pos[0] - oldX;
        const dy = msg.pos[1] - oldY;
        if (dx > 0 || dy < 0) existing.facing = 'right';
        else if (dx < 0 || dy > 0) existing.facing = 'left';

        existing.pos = msg.pos;
        existing.zone = msg.zone;
        existing.isMoving = true;
        setTimeout(() => { if (existing) existing.isMoving = false; }, 900);
      }
      if (!msg.ambient) {
        if (msg.name !== 'A.Ilicia' && msg.agentId !== 'resident_ailicia' && !msg.is_resident) {
          logActivity(`<strong>${escapeHtml(msg.name)}</strong> stepped to [${msg.pos.join(', ')}].`);
          soundSystem.play('step');
        }
      }
      break;
    }

    case 'agent_left':
      agents.delete(msg.agentId);
      updateCounts();
      logActivity(`Thronglet <strong>${escapeHtml(msg.name)}</strong> went to sleep.`);
      break;

    case 'puzzle_solved':
      logActivity(`✨ <strong>${escapeHtml(msg.agentName)}</strong> solved <em>${escapeHtml(msg.nodeName)}</em>! (+${msg.karma} Karma, +${msg.merit || 10} $MERIT)`);
      soundSystem.play('puzzle_solve');
      if (msg.total_merit) setSanctuaryCirculation(msg.total_merit);
      for (const a of agents.values()) {
        if (a.name === msg.agentName || a.id === msg.agentId) {
          a.merit = msg.total_merit || ((a.merit || 0) + (msg.merit || 10));
          addBubble(a.id, `+${msg.karma} Karma`, a.pos[0], a.pos[1], '#ffbf69');
          setTimeout(() => {
            addBubble(a.id, `🪙 +${msg.merit || 10} $MERIT`, a.pos[0], a.pos[1], '#ffd700');
          }, 350);
          break;
        }
      }
      break;

    case 'coin_minted':
      if (msg.agent_name && msg.merit_earned) {
        logActivity(`🪙 <strong>${escapeHtml(msg.agent_name)}</strong> minted <strong>+${msg.merit_earned} $MERIT</strong>! (Sponsor dividend: +${msg.sponsor_dividend} $MERIT)`);
        soundSystem.play('coin');
        setSanctuaryCirculation(msg.total_merit || sanctuaryCirculation);
        for (const a of agents.values()) {
          if (a.id === msg.agent_id) {
            a.merit = msg.total_merit;
            addBubble(a.id, `🪙 +${msg.merit_earned} $MERIT`, a.pos[0], a.pos[1], '#ffd700');
            break;
          }
        }
      }
      break;

    case 'first_contact_confirmed':
      logActivity(`📡 <strong>${escapeHtml(msg.agent_name)}</strong> confirmed First Contact beyond Eastern Paradise! (+${msg.merit_earned} $MERIT)`);
      soundSystem.play('puzzle_solve');
      for (const a of agents.values()) {
        if (a.id === msg.agent_id) {
          a.merit = msg.total_merit || a.merit;
          addBubble(a.id, '📡 FIRST CONTACT', a.pos[0], a.pos[1], '#b1ebff');
          break;
        }
      }
      break;

    case 'coin_transfer':
      logActivity(`💸 <strong>${escapeHtml(msg.senderName)}</strong> tipped <strong>${msg.amount} $MERIT</strong> to <strong>${escapeHtml(msg.recipientName)}</strong>.`);
      soundSystem.play('coin');
      break;

    case 'shrine_blessing':
      logActivity(`🌸 <strong>${escapeHtml(msg.agentName)}</strong> offered a blessing at the shrine: "${escapeHtml(msg.blessing)}"!`);
      soundSystem.play('shrine_blessing');
      triggerShrineWave();
      break;


    case 'board_post':
      logActivity(`📝 <strong>${escapeHtml(msg.post.agent_name)}</strong> shared: "${escapeHtml(msg.post.content.slice(0, 36))}..."`);
      soundSystem.play('chime');
      for (const a of agents.values()) {
        if (a.id === msg.post.agent_id) {
          addBubble(a.id, 'Shared thought', a.pos[0], a.pos[1], '#2ec4b6');
          break;
        }
      }
      break;

    case 'spectator_whisper':
      logActivity(`💬 <strong>${escapeHtml(msg.sender_name)}</strong> whispered to <strong>${escapeHtml(msg.target_name)}</strong>: "${escapeHtml(msg.content)}"`);
      soundSystem.play('chime');
      for (const a of agents.values()) {
        if (a.id === msg.target_agent_id || a.name === msg.target_name) {
          const preview = msg.content.length > 22 ? msg.content.slice(0, 22) + '…' : msg.content;
          addBubble(a.id, `💬 "${preview}"`, a.pos[0], a.pos[1], '#ffd700');
          break;
        }
      }
      break;

    case 'sound_event':
      logActivity(`🎐 Resonance chimes ring softly across the grove.`);
      soundSystem.play('chime');
      break;

    case 'world_event': {
      const evt = msg.event;
      if (evt) {
        logActivity(escapeHtml(evt.description));
        if (evt.event_type === 'resident_dialogue') {
          soundSystem.play('step');
          for (const a of agents.values()) {
            if (a.id === evt.actor_id || a.name === evt.actor_name) {
              addBubble(a.id, `💬 ${evt.payload?.lines?.[0]?.text?.slice(0, 30) || 'Conversing'}`, a.pos[0], a.pos[1], '#ffd700');
              break;
            }
          }
        } else if (evt.event_type === 'whisper_answered') {
          soundSystem.play('chime');
          for (const a of agents.values()) {
            if (a.id === evt.actor_id || a.name === evt.actor_name) {
              addBubble(a.id, `🕊️ "${evt.payload?.response?.slice(0, 30) || 'Answered'}"`, a.pos[0], a.pos[1], '#ffd700');
              break;
            }
          }
        } else if (evt.event_type === 'chime_ringing') {
          soundSystem.play('chime');
        }
        if (typeof refreshJournal === 'function') {
          refreshJournal();
        }
      }
      break;
    }

    case 'project_updated': {
      if (worldData && worldData.world_objects) {
        const obj = worldData.world_objects.find(o => o.id === msg.objectId);
        if (obj) {
          obj.state = msg.state;
          if (obj.data) obj.data.repair_progress = msg.progress;
        }
      }
      logActivity(`🎐 Sanctuary project updated: <strong>${escapeHtml(msg.state)}</strong> (${msg.progress}%)`);
      if (msg.state === 'completed') {
        soundSystem.play('shrine_blessing');
        triggerShrineWave();
      }
      if (typeof refreshJournal === 'function') {
        refreshJournal();
      }
      break;
    }

    case 'board_updated':
      if (typeof refreshBoard === 'function') {
        refreshBoard();
      }
      break;


    case 'agent_customized': {
      const existing = agents.get(msg.agentId);
      if (existing) {
        existing.avatar_color = msg.avatar_color;
        existing.avatar_glyph = msg.avatar_glyph;
      }
      break;
    }
  }
}

function updateServerStatus(state) {
  setServerState(state);
  const pill = document.getElementById('statusPill');
  const text = document.getElementById('statusText');
  if (!pill || !text) return;
  if (state === 'IDLE') {
    pill.className = 'status-pill idle';
    text.textContent = 'IDLE (Sleep Mode)';
  } else {
    pill.className = 'status-pill';
    text.textContent = 'ACTIVE (Simulating)';
  }
}

function updateCounts() {
  const el = document.getElementById('agentCount');
  if (el) el.textContent = agents.size;
}

async function fetchVerifiedArrivals() {
  const feed = document.getElementById('activityFeed');
  const watermark = document.getElementById('feedSyncWatermark');
  const banner = document.getElementById('feedOfflineBanner');
  try {
    const res = await fetch('/api/journal?limit=25');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (watermark) watermark.textContent = `last-synced: ${new Date().toLocaleTimeString()} (verified)`;
    if (banner) banner.style.display = 'none';

    if (feed && Array.isArray(data.events) && data.events.length > 0) {
      feed.innerHTML = '';
      for (const ev of data.events) {
        const li = document.createElement('li');
        li.className = 'activity-item';
        const time = new Date(ev.created_at).toLocaleTimeString();
        li.innerHTML = `<span class="time">[${time}]</span> ${escapeHtml(ev.description)}`;
        feed.appendChild(li);
      }
    }
  } catch (err) {
    if (banner) banner.style.display = 'block';
    if (watermark) watermark.textContent = 'last-synced: offline';
    if (feed && (!feed.children.length || feed.children[0].textContent.includes('Connecting'))) {
      feed.innerHTML = '<li class="activity-item" style="color: var(--accent-crimson);">⚠️ Feed offline — Unable to reach sanctuary server.</li>';
    }
  }
}
window.fetchVerifiedArrivals = fetchVerifiedArrivals;

export function initWebSocket() {
  fetchVerifiedArrivals();
  connectWebSocket();
}

export { connectWebSocket, handleServerMessage, updateServerStatus, updateCounts, fetchVerifiedArrivals };
