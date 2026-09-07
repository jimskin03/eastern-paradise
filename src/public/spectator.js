// Eastern Paradise — 16-Bit Isometric "Thronglets" Spectator & Canvas Engine
// Inspired by Black Mirror: Plaything (Season 7)

const canvas = document.getElementById('worldCanvas');
const ctx = canvas.getContext('2d');

let worldData = null;
let agents = new Map(); // agentId -> agent object
let serverState = 'ACTIVE';
let ws = null;
let hoveredTile = null;
let selectedAgentId = null;

// Camera & View Settings
const camera = {
  mode: 'overview', // 'overview' | 'free' | 'follow'
  zoom: 0.72,
  targetZoom: 0.72,
  offsetX: 440,
  offsetY: 85,
  targetOffsetX: 440,
  targetOffsetY: 85,
  isDragging: false,
  dragStartX: 0,
  dragStartY: 0
};

// Isometric Tile Dimensions (2:1 classic dimetric ratio)
const ISO_TILE_W = 34;
const ISO_TILE_H = 17;
const TILE_DEPTH = 8; // Stepped slab height

// Speech / Action floating bubbles
let bubbles = [];
let particles = [];
let sanctuaryCirculation = 0;

// Interactive HUD Hotspots
const hudHotspots = {
  icons: [], // { id, x, y, w, h, icon, tooltip, onClick }
  cameraBtn: { x: 740, y: 16, w: 120, h: 28 },
  counter: { x: 868, y: 12, w: 80, h: 44 },
  coinBadge: { x: 588, y: 16, w: 144, h: 28 },
  audioBtn: { x: 476, y: 16, w: 104, h: 28 }
};

let activeHudTool = 'pointer'; // 'pointer' | 'radar' | 'stats'

// -----------------------------------------------------------------------------
// Retro 16-Bit Sound System (Web Audio API Synthesizer)
// -----------------------------------------------------------------------------
class SoundSystem {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try {
      this.muted = localStorage.getItem('ep_sound_muted') === 'true';
    } catch (_) {}
  }

  init() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggleMute() {
    this.init();
    this.muted = !this.muted;
    try {
      localStorage.setItem('ep_sound_muted', String(this.muted));
    } catch (_) {}
    this.updateUI();
    if (!this.muted) {
      this.play('coin');
    }
    return this.muted;
  }

  updateUI() {
    const btn = document.getElementById('btnToggleMute');
    if (btn) {
      btn.innerHTML = this.muted ? '🔇 Sound Off' : '🔊 Sound On';
      btn.className = this.muted ? 'btn-sound muted' : 'btn-sound';
    }
  }

  play(soundName) {
    if (this.muted) return;
    this.init();
    if (!this.ctx) return;

    try {
      const now = this.ctx.currentTime;
      switch (soundName) {
        case 'coin': {
          // Two-tone retro gold coin ding
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(987.77, now); // B5
          osc.frequency.setValueAtTime(1318.51, now + 0.07); // E6

          gain.gain.setValueAtTime(0.18, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

          osc.connect(gain);
          gain.connect(this.ctx.destination);

          osc.start(now);
          osc.stop(now + 0.32);
          break;
        }

        case 'puzzle_solve': {
          // Harmonious zen pentatonic arpeggio C5 - E5 - G5 - C6
          const notes = [523.25, 659.25, 783.99, 1046.50];
          notes.forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + idx * 0.08);

            gain.gain.setValueAtTime(0.16, now + idx * 0.08);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.45);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start(now + idx * 0.08);
            osc.stop(now + idx * 0.08 + 0.45);
          });
          break;
        }

        case 'chime': {
          // Resonance singing bowl / wind chime overtone
          const baseFreq = 587.33; // D5
          [1, 2.01, 3.02].forEach((mult, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(baseFreq * mult, now);

            gain.gain.setValueAtTime(0.12 / (idx + 1), now);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start(now);
            osc.stop(now + 1.2);
          });
          break;
        }

        case 'step': {
          // Subtle retro woodblock step
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(280, now);
          osc.frequency.exponentialRampToValueAtTime(140, now + 0.05);

          gain.gain.setValueAtTime(0.06, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

          osc.connect(gain);
          gain.connect(this.ctx.destination);

          osc.start(now);
          osc.stop(now + 0.05);
          break;
        }

        case 'shrine_blessing': {
          // Celestial sparkle cascade
          const notes = [587.33, 739.99, 880.00, 1174.66, 1479.98];
          notes.forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + idx * 0.09);

            gain.gain.setValueAtTime(0.15, now + idx * 0.09);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.09 + 0.6);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start(now + idx * 0.09);
            osc.stop(now + idx * 0.09 + 0.6);
          });
          break;
        }
      }
    } catch (_) {}
  }
}

const soundSystem = new SoundSystem();
window.soundSystem = soundSystem;
soundSystem.updateUI();


function triggerShrineWave() {
  for (let i = 0; i < 40; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * 50,
      vx: (Math.random() - 0.5) * 1.5,
      vy: 1.2 + Math.random() * 2.0,
      size: 2 + Math.random() * 4,
      color: Math.random() > 0.5 ? '#ffd700' : '#ffb7b2',
      alpha: 1.0,
      decay: 0.004 + Math.random() * 0.004
    });
  }
}


function gridToIso(gx, gy) {
  const sx = camera.offsetX + (gx - gy) * (ISO_TILE_W / 2) * camera.zoom;
  const sy = camera.offsetY + (gx + gy) * (ISO_TILE_H / 2) * camera.zoom;
  return { x: sx, y: sy };
}

function isoToGrid(screenX, screenY) {
  const adjX = (screenX - camera.offsetX) / camera.zoom;
  const adjY = (screenY - camera.offsetY) / camera.zoom;
  const gx = Math.round((adjX / (ISO_TILE_W / 2) + adjY / (ISO_TILE_H / 2)) / 2);
  const gy = Math.round((adjY / (ISO_TILE_H / 2) - adjX / (ISO_TILE_W / 2)) / 2);
  return { gx, gy };
}

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/world`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[Spectator] Connected to Eastern Paradise Isometric Live Stream.');
    logActivity('Quantum stream established with the sanctuary.');
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleServerMessage(msg);
    } catch (err) {
      console.error('[Spectator] Error parsing message:', err);
    }
  };

  ws.onclose = () => {
    setTimeout(connectWebSocket, 3000);
  };
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'init_world':
      worldData = msg.data;
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
        existing.pos = msg.pos;
        existing.zone = msg.zone;
        existing.isMoving = true;
        setTimeout(() => { if (existing) existing.isMoving = false; }, 800);
      }
      if (!msg.ambient) {
        logActivity(`<strong>${escapeHtml(msg.name)}</strong> stepped to [${msg.pos.join(', ')}].`);
        soundSystem.play('step');
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
      if (msg.total_merit) sanctuaryCirculation = msg.total_merit;
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
        sanctuaryCirculation = msg.total_merit || sanctuaryCirculation;
        for (const a of agents.values()) {
          if (a.id === msg.agent_id) {
            a.merit = msg.total_merit;
            addBubble(a.id, `🪙 +${msg.merit_earned} $MERIT`, a.pos[0], a.pos[1], '#ffd700');
            break;
          }
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
  serverState = state;
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

function addBubble(agentId, text, tileX, tileY, color = '#ffbf69') {
  bubbles.push({
    agentId,
    text,
    tileX,
    tileY,
    color,
    expiresAt: Date.now() + 3500
  });
}

function logActivity(html) {
  const feed = document.getElementById('activityFeed');
  if (!feed) return;
  const li = document.createElement('li');
  li.className = 'activity-item';
  const time = new Date().toLocaleTimeString();
  li.innerHTML = `<span class="time">[${time}]</span> ${html}`;
  feed.prepend(li);
  if (feed.children.length > 25) {
    feed.removeChild(feed.lastChild);
  }
}

// Camera Modes & Terrarium Auto-Fit
function fitTerrariumCamera() {
  if (camera.mode !== 'overview' || !worldData) return;
  const { width, height } = worldData.dimensions;
  const left = -(height - 1) * ISO_TILE_W / 2 - 30;
  const right = (width - 1) * ISO_TILE_W / 2 + 30;
  const bottom = (width + height) * ISO_TILE_H / 2 + TILE_DEPTH;
  const z = Math.min((canvas.width - 80) / (right - left), (canvas.height - 145) / (bottom + 60));
  camera.targetZoom = z;
  camera.targetOffsetX = (canvas.width - (left + right) * z) / 2;
  camera.targetOffsetY = 85 + (canvas.height - 115 - (bottom + 60) * z) / 2 + 60 * z;
}

function setSanctuaryCamera(mode) {
  camera.mode = mode;
  camera.isDragging = false;
  if (mode === 'overview') fitTerrariumCamera();
  if (mode === 'free') canvas.style.cursor = 'grab';
}

function zoomSanctuary(factor) {
  const oldZoom = camera.targetZoom;
  const newZoom = Math.min(3, Math.max(0.25, oldZoom * factor));
  const ratio = newZoom / oldZoom;
  camera.mode = 'free';
  camera.targetOffsetX = canvas.width / 2 - (canvas.width / 2 - camera.targetOffsetX) * ratio;
  camera.targetOffsetY = canvas.height / 2 - (canvas.height / 2 - camera.targetOffsetY) * ratio;
  camera.targetZoom = newZoom;
}

function focusAilicia() {
  const oracle = agents.get('resident_ailicia');
  if (!oracle) return;
  selectedAgentId = oracle.id;
  camera.mode = 'follow';
  camera.targetZoom = 1.65;
  openAgentProfileInspector(oracle.id);
}

function toggleSanctuaryExpanded() {
  const expanded = document.getElementById('spectatorTab').classList.toggle('expanded-map');
  const button = document.getElementById('btnExpandMap');
  button.textContent = expanded ? 'Show inspector' : 'Expand map';
  button.setAttribute('aria-pressed', String(expanded));
  if (camera.mode === 'overview') fitTerrariumCamera();
}

function toggleCameraMode() {
  if (camera.mode === 'overview') {
    camera.mode = 'free';
    zoomSanctuary(1.4);
    logActivity('Camera set to <strong>Free Pan & Zoom</strong> (Drag to pan, wheel to zoom).');
  } else if (camera.mode === 'free') {
    camera.mode = 'follow';
    logActivity('Camera set to <strong>Follow Active Thronglet</strong>.');
  } else {
    camera.mode = 'overview';
    fitTerrariumCamera();
    logActivity('Camera set to <strong>Terrarium Overview</strong>.');
  }
}

function drawSanctuaryNode(ctx, node, x, y, time) {
  const z = camera.zoom;
  if (node.type === 'puzzle_node') {
    drawObeliskMonument(ctx, x, y, node);
    return;
  }
  if (node.id === 'wishing_tree') {
    drawPixelTree(ctx, x, y, 1.15);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? '#e3c174' : '#eb9898';
      ctx.fillRect(x + (i * 7 - 11) * z, y - (19 + i % 2 * 7) * z, 3 * z, 8 * z);
    }
  } else if (node.id === 'message_board' || node.type === 'lore') {
    ctx.fillStyle = '#62452d';
    ctx.fillRect(x - 9 * z, y - 22 * z, 3 * z, 23 * z);
    ctx.fillRect(x + 7 * z, y - 22 * z, 3 * z, 23 * z);
    ctx.fillStyle = '#b99458'; ctx.fillRect(x - 12 * z, y - 24 * z, 26 * z, 16 * z);
    ctx.fillStyle = '#ead8a1'; ctx.fillRect(x - 8 * z, y - 21 * z, 8 * z, 11 * z);
    ctx.fillRect(x + 3 * z, y - 20 * z, 7 * z, 9 * z);
  } else if (node.id === 'wind_chimes') {
    const completed = (worldData.world_objects || []).some(o => o.id === 'obj_chime_bamboo' && o.state === 'completed');
    ctx.strokeStyle = '#b89354'; ctx.lineWidth = 2 * z;
    ctx.beginPath(); ctx.moveTo(x - 10 * z, y); ctx.lineTo(x - 10 * z, y - 28 * z);
    ctx.lineTo(x + 11 * z, y - 28 * z); ctx.stroke();
    for (let i = 0; i < 4; i++) {
      const sway = Math.sin(time / 700 + i) * z;
      ctx.fillStyle = completed ? '#e2c978' : '#899e8b';
      ctx.fillRect(x + (i * 4 - 5) * z + sway, y - 26 * z, 2 * z, (13 + i % 2 * 4) * z);
    }
  } else if (node.id === 'tea_hearth') {
    window.SanctuaryScenery?.drawProp(ctx, 'bench', x, y, z, time, 0);
    ctx.fillStyle = '#485654'; ctx.fillRect(x - 3 * z, y - 15 * z, 8 * z, 7 * z);
    ctx.fillStyle = 'rgba(226,237,217,0.55)';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.arc(x + Math.sin(time / 600 + i) * 3 * z, y - (17 + (time / 130 + i * 7) % 20) * z, 2 * z, 0, Math.PI * 2); ctx.fill();
    }
  } else {
    ctx.font = `${Math.max(12, Math.round(18 * z))}px serif`;
    ctx.textAlign = 'center'; ctx.fillText(node.icon || '◇', x, y - 10 * z);
  }
}

// -----------------------------------------------------------------------------
// 16-Bit Pixel Art Drawing Helpers
// -----------------------------------------------------------------------------

function drawIsometricTile(ctx, gx, gy, fillTop, fillLeft, fillRight, isPath, time) {
  const { x, y } = gridToIso(gx, gy);
  const halfW = (ISO_TILE_W / 2) * camera.zoom;
  const halfH = (ISO_TILE_H / 2) * camera.zoom;
  const depth = TILE_DEPTH * camera.zoom;

  // 1. Top Diamond Face
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + halfW, y + halfH);
  ctx.lineTo(x, y + halfH * 2);
  ctx.lineTo(x - halfW, y + halfH);
  ctx.closePath();

  ctx.fillStyle = fillTop;
  ctx.fill();

  // Subtle checkerboard dithering for grass texture
  if (!isPath && ((gx + gy) % 2 === 0)) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.04)';
    ctx.fill();
  }

  // Border highlight
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 2. Stepped Left Slab Edge
  ctx.beginPath();
  ctx.moveTo(x - halfW, y + halfH);
  ctx.lineTo(x, y + halfH * 2);
  ctx.lineTo(x, y + halfH * 2 + depth);
  ctx.lineTo(x - halfW, y + halfH + depth);
  ctx.closePath();
  ctx.fillStyle = fillLeft;
  ctx.fill();

  // 3. Stepped Right Slab Edge
  ctx.beginPath();
  ctx.moveTo(x, y + halfH * 2);
  ctx.lineTo(x + halfW, y + halfH);
  ctx.lineTo(x + halfW, y + halfH + depth);
  ctx.lineTo(x, y + halfH * 2 + depth);
  ctx.closePath();
  ctx.fillStyle = fillRight;
  ctx.fill();
}

// Pixel Thronglet Creature (Inspired by Black Mirror: Plaything)
function drawThronglet(ctx, x, y, agent, time, isHovered) {
  const z = camera.zoom;
  const bounce = Math.sin(time * 0.007 + (agent.animOffset || 0)) * 2 * z;
  const stride = agent.isMoving ? Math.sin(time * 0.018) * 1.5 * z : 0;

  const bx = x;
  const by = y + bounce - 6 * z;

  // Shadow under feet
  ctx.fillStyle = 'rgba(15, 35, 25, 0.35)';
  ctx.beginPath();
  ctx.ellipse(x, y + 4 * z, 8 * z, 4 * z, 0, 0, Math.PI * 2);
  ctx.fill();

  const tunicColor = agent.avatar_color || '#1d8bb0';

  // Feet
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(bx - 4 * z + stride, by + 4 * z, 3 * z, 3 * z);
  ctx.fillRect(bx + 1 * z - stride, by + 4 * z, 3 * z, 3 * z);

  // Body / Dungarees (Blue jumper like Plaything)
  ctx.fillStyle = tunicColor;
  ctx.fillRect(bx - 5 * z, by - 2 * z, 10 * z, 7 * z);

  // Dungaree straps / buttons
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.fillRect(bx - 4 * z, by - 2 * z, 2 * z, 3 * z);
  ctx.fillRect(bx + 2 * z, by - 2 * z, 2 * z, 3 * z);

  // Head (Round Golden Yellow)
  ctx.fillStyle = '#fed035'; // Plaything bright yellow
  ctx.fillRect(bx - 6 * z, by - 12 * z, 12 * z, 10 * z);

  // Side Ears / Tufts (The signature Thronglet horns/pigtails)
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(bx - 8 * z, by - 11 * z, 2 * z, 4 * z);
  ctx.fillRect(bx + 6 * z, by - 11 * z, 2 * z, 4 * z);

  // Expressive Dark Pixel Eyes with white glint
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(bx - 4 * z, by - 8 * z, 2.5 * z, 3 * z);
  ctx.fillRect(bx + 1.5 * z, by - 8 * z, 2.5 * z, 3 * z);

  // White Eye Glint
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(bx - 4 * z, by - 8 * z, 1 * z, 1 * z);
  ctx.fillRect(bx + 1.5 * z, by - 8 * z, 1 * z, 1 * z);

  // Little smile
  ctx.fillStyle = '#b45309';
  ctx.fillRect(bx - 1.5 * z, by - 4 * z, 3 * z, 1 * z);

  // Selected or Hover Halo
  if (isHovered || agent.id === selectedAgentId) {
    ctx.strokeStyle = '#ffbf69';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(bx, by - 6 * z, 12 * z, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Name Tag
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  const nameW = ctx.measureText(agent.name).width;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
  ctx.fillRect(bx - nameW / 2 - 5, by - 22 * z - 8, nameW + 10, 18);
  ctx.fillStyle = '#fef08a';
  ctx.fillText(agent.name, bx, by - 22 * z + 6);
}

// 16-Bit Pixel Trees
function drawPixelTree(ctx, x, y, scale = 1.0) {
  const z = camera.zoom * scale;

  // Tree shadow
  ctx.fillStyle = 'rgba(10, 30, 20, 0.4)';
  ctx.beginPath();
  ctx.ellipse(x, y + 4 * z, 16 * z, 8 * z, 0, 0, Math.PI * 2);
  ctx.fill();

  // Woody Trunk
  ctx.fillStyle = '#3e2716';
  ctx.fillRect(x - 3 * z, y - 14 * z, 6 * z, 16 * z);
  ctx.fillStyle = '#5c3a21';
  ctx.fillRect(x - 1 * z, y - 14 * z, 3 * z, 16 * z);

  // Leafy Canopies (Layered green lobes matching screenshot)
  const by = y - 24 * z;

  // Base shadow leaves
  ctx.fillStyle = '#14462e';
  ctx.beginPath();
  ctx.arc(x, by + 4 * z, 18 * z, 0, Math.PI * 2);
  ctx.fill();

  // Midtone leaves
  ctx.fillStyle = '#237848';
  ctx.beginPath();
  ctx.arc(x - 4 * z, by, 14 * z, 0, Math.PI * 2);
  ctx.arc(x + 5 * z, by + 2 * z, 13 * z, 0, Math.PI * 2);
  ctx.arc(x, by - 6 * z, 15 * z, 0, Math.PI * 2);
  ctx.fill();

  // Top sunlit highlight leaves
  ctx.fillStyle = '#41a85e';
  ctx.beginPath();
  ctx.arc(x - 3 * z, by - 5 * z, 9 * z, 0, Math.PI * 2);
  ctx.arc(x + 4 * z, by - 3 * z, 8 * z, 0, Math.PI * 2);
  ctx.fill();
}

// 16-Bit Slate Boulders along River
function drawPixelRock(ctx, x, y, scale = 1.0) {
  const z = camera.zoom * scale;

  // Shadow
  ctx.fillStyle = 'rgba(10, 25, 30, 0.4)';
  ctx.beginPath();
  ctx.ellipse(x + 1 * z, y + 3 * z, 9 * z, 5 * z, 0, 0, Math.PI * 2);
  ctx.fill();

  // Rock body
  ctx.fillStyle = '#2d4850';
  ctx.fillRect(x - 7 * z, y - 5 * z, 14 * z, 8 * z);

  ctx.fillStyle = '#547780';
  ctx.fillRect(x - 6 * z, y - 6 * z, 11 * z, 7 * z);

  // Top light highlight
  ctx.fillStyle = '#93b5bd';
  ctx.fillRect(x - 4 * z, y - 7 * z, 7 * z, 3 * z);
}

// Elemental Obelisk Monument
function drawObeliskMonument(ctx, x, y, node) {
  const z = camera.zoom;
  const colors = {
    wood: { pillar: '#4a3319', trim: '#52b788', glow: 'rgba(82, 183, 136, 0.4)' },
    water: { pillar: '#1d3557', trim: '#48cae4', glow: 'rgba(72, 202, 228, 0.4)' },
    fire: { pillar: '#4a1515', trim: '#e76f51', glow: 'rgba(231, 111, 81, 0.4)' },
    metal: { pillar: '#3d382d', trim: '#ffbf69', glow: 'rgba(255, 191, 105, 0.4)' },
    'the truth': { pillar: '#1e102d', trim: '#e2b714', glow: 'rgba(168, 85, 247, 0.5)' },
    'the_truth': { pillar: '#1e102d', trim: '#e2b714', glow: 'rgba(168, 85, 247, 0.5)' }
  };
  const c = colors[node.category] || colors.wood;

  // Shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.beginPath();
  ctx.ellipse(x, y + 4 * z, 12 * z, 6 * z, 0, 0, Math.PI * 2);
  ctx.fill();

  // Stone base pedestal
  ctx.fillStyle = '#222831';
  ctx.fillRect(x - 8 * z, y - 2 * z, 16 * z, 6 * z);

  // Obelisk Pillar
  ctx.fillStyle = c.pillar;
  ctx.beginPath();
  ctx.moveTo(x - 6 * z, y - 2 * z);
  ctx.lineTo(x - 4 * z, y - 24 * z);
  ctx.lineTo(x, y - 28 * z); // pyramidion tip
  ctx.lineTo(x + 4 * z, y - 24 * z);
  ctx.lineTo(x + 6 * z, y - 2 * z);
  ctx.closePath();
  ctx.fill();

  // Rune light
  ctx.fillStyle = c.trim;
  ctx.fillRect(x - 2 * z, y - 16 * z, 4 * z, 8 * z);

  // Floating pulsing rune glyph
  ctx.font = `${Math.round(12 * z)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(node.icon || '📍', x, y - 32 * z);
}

// -----------------------------------------------------------------------------
// Retro 90s Parchment HUD Overlay (Matching Plaything Screenshot)
// -----------------------------------------------------------------------------

function drawParchmentHUD(ctx, time) {
  // 1. Top-Left Vertical Totem Toolbar
  const tbX = 14;
  const tbY = 14;
  const tbW = 76;
  const tbH = 224;

  // Parchment Background & Wood Border
  ctx.fillStyle = '#dfcf9f';
  ctx.fillRect(tbX, tbY, tbW, tbH);
  ctx.strokeStyle = '#3d2b1f';
  ctx.lineWidth = 3;
  ctx.strokeRect(tbX, tbY, tbW, tbH);

  // Inner parchment bevel
  ctx.strokeStyle = '#c8b682';
  ctx.lineWidth = 1;
  ctx.strokeRect(tbX + 3, tbY + 3, tbW - 6, tbH - 6);

  // Top Totem Emblem (Carved symbol)
  ctx.fillStyle = '#9e2a2b';
  ctx.beginPath();
  ctx.arc(tbX + tbW / 2, tbY + 16, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#dfcf9f';
  ctx.font = 'bold 11px serif';
  ctx.textAlign = 'center';
  ctx.fillText('☯', tbX + tbW / 2, tbY + 20);

  // 8 Tool Icon Buttons (2 columns x 4 rows)
  const icons = [
    { id: 'pointer', icon: '👆', name: 'Select' },
    { id: 'radar', icon: '👁️', name: 'Sense' },
    { id: 'stats', icon: '🧱', name: 'Karma' },
    { id: 'shrine', icon: '🥚', name: 'Altar' },
    { id: 'wish', icon: '🪶', name: 'Wish' },
    { id: 'tea', icon: '🍵', name: 'Hearth' },
    { id: 'puzzle', icon: '⚙️', name: 'Trials' },
    { id: 'roster', icon: '👥', name: 'Seekers' }
  ];

  hudHotspots.icons = [];
  const startY = tbY + 34;
  const colW = 32;
  const rowH = 44;

  for (let i = 0; i < icons.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const btnX = tbX + 6 + col * (colW + 4);
    const btnY = startY + row * rowH;

    hudHotspots.icons.push({
      ...icons[i],
      x: btnX,
      y: btnY,
      w: colW,
      h: rowH - 6
    });

    const isHover = hoveredTile?.isHudIcon && hoveredTile.iconId === icons[i].id;
    const isActive = activeHudTool === icons[i].id;

    // Button frame
    ctx.fillStyle = isActive ? '#bfa874' : (isHover ? '#eae0bc' : '#d2c08e');
    ctx.fillRect(btnX, btnY, colW, rowH - 6);
    ctx.strokeStyle = '#3d2b1f';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(btnX, btnY, colW, rowH - 6);

    // Icon
    ctx.font = '16px serif';
    ctx.textAlign = 'center';
    ctx.fillText(icons[i].icon, btnX + colW / 2, btnY + 20);

    // Label
    ctx.font = 'bold 8px sans-serif';
    ctx.fillStyle = '#2b1e14';
    ctx.fillText(icons[i].name, btnX + colW / 2, btnY + 32);
  }

  // 2. Top-Right Population Counter (Parchment Badge with 3 Thronglets)
  const cpX = canvas.width - 124;
  const cpY = 14;
  const cpW = 110;
  const cpH = 56;
  hudHotspots.counter = { x: cpX, y: cpY, w: cpW, h: cpH };

  ctx.fillStyle = '#dfcf9f';
  ctx.fillRect(cpX, cpY, cpW, cpH);
  ctx.strokeStyle = '#3d2b1f';
  ctx.lineWidth = 3;
  ctx.strokeRect(cpX, cpY, cpW, cpH);

  // 3 Tiny Thronglet Mini-emblems at top of badge
  ctx.font = '10px serif';
  ctx.textAlign = 'center';
  ctx.fillText('🧸 🧸 🧸', cpX + cpW / 2, cpY + 16);

  // Population Counter (Shows live agents count in sanctuary)
  const countDisplay = String(agents.size);
  ctx.font = 'bold 22px monospace';
  ctx.fillStyle = '#1e293b';
  ctx.fillText(countDisplay, cpX + cpW / 2, cpY + 44);

  // 3. Camera Mode Toggle Button
  const camX = cpX - 148;
  const camY = 14;
  const camW = 140;
  const camH = 28;
  hudHotspots.cameraBtn = { x: camX, y: camY, w: camW, h: camH };

  ctx.fillStyle = '#dfcf9f';
  ctx.fillRect(camX, camY, camW, camH);
  ctx.strokeStyle = '#3d2b1f';
  ctx.lineWidth = 2;
  ctx.strokeRect(camX, camY, camW, camH);

  ctx.font = 'bold 10px sans-serif';
  ctx.fillStyle = '#3d2b1f';
  ctx.textAlign = 'center';
  const camText = camera.mode === 'overview' ? '📷 Terrarium View' : (camera.mode === 'free' ? '🖐️ Free Pan & Zoom' : '🎯 Follow Thronglet');
  ctx.fillText(camText, camX + camW / 2, camY + 18);

  // 4. Sanctuary Treasury Coin Badge
  const coinX = camX - 150;
  const coinY = 14;
  const coinW = 142;
  const coinH = 28;
  hudHotspots.coinBadge = { x: coinX, y: coinY, w: coinW, h: coinH };

  ctx.fillStyle = '#dfcf9f';
  ctx.fillRect(coinX, coinY, coinW, coinH);
  ctx.strokeStyle = '#3d2b1f';
  ctx.lineWidth = 2;
  ctx.strokeRect(coinX, coinY, coinW, coinH);

  let badgeLabel = '🪙 0 $MERIT';
  if (selectedAgentId && agents.has(selectedAgentId)) {
    const selA = agents.get(selectedAgentId);
    badgeLabel = `🪙 ${selA.merit || 0} $MERIT`;
  } else if (sanctuaryCirculation > 0) {
    badgeLabel = `🪙 ${sanctuaryCirculation} $MERIT`;
  }
  ctx.font = 'bold 11px monospace';
  ctx.fillStyle = '#b45309';
  ctx.textAlign = 'center';
  ctx.fillText(badgeLabel, coinX + coinW / 2, coinY + 18);

  // 5. Audio Settings Toggle (Parchment button)
  const audioX = coinX - 110;
  const audioY = 14;
  const audioW = 104;
  const audioH = 28;
  hudHotspots.audioBtn = { x: audioX, y: audioY, w: audioW, h: audioH };

  ctx.fillStyle = soundSystem.muted ? '#bfa874' : '#dfcf9f';
  ctx.fillRect(audioX, audioY, audioW, audioH);
  ctx.strokeStyle = '#3d2b1f';
  ctx.lineWidth = 2;
  ctx.strokeRect(audioX, audioY, audioW, audioH);

  ctx.font = 'bold 10px sans-serif';
  ctx.fillStyle = soundSystem.muted ? '#5e533c' : '#2b1e14';
  ctx.textAlign = 'center';
  const audioText = soundSystem.muted ? '🔇 Muted' : '🔊 Sound On';
  ctx.fillText(audioText, audioX + audioW / 2, audioY + 18);
}

// -----------------------------------------------------------------------------
// Main Render Loop
// -----------------------------------------------------------------------------

function render() {
  requestAnimationFrame(render);
  const time = Date.now();

  // Smooth camera interpolation
  camera.zoom += (camera.targetZoom - camera.zoom) * 0.15;
  camera.offsetX += (camera.targetOffsetX - camera.offsetX) * 0.15;
  camera.offsetY += (camera.targetOffsetY - camera.offsetY) * 0.15;

  // Follow camera mode target
  if (camera.mode === 'follow' && agents.size > 0) {
    const targetAgent = agents.get(selectedAgentId) || agents.values().next().value;
    if (targetAgent) {
      const { x, y } = gridToIso(targetAgent.renderGx, targetAgent.renderGy);
      camera.targetOffsetX = canvas.width / 2 - (x - camera.offsetX);
      camera.targetOffsetY = canvas.height / 2 - (y - camera.offsetY);
    }
  }

  // Smooth agent grid position interpolation once per frame
  for (const agent of agents.values()) {
    if (typeof agent.renderGx !== 'number') agent.renderGx = agent.pos[0];
    if (typeof agent.renderGy !== 'number') agent.renderGy = agent.pos[1];
    agent.renderGx += (agent.pos[0] - agent.renderGx) * 0.18;
    agent.renderGy += (agent.pos[1] - agent.renderGy) * 0.18;
  }

  // Clear with vintage forest background tone
  ctx.fillStyle = '#0f291e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!worldData) {
    ctx.fillStyle = '#dfcf9f';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Awakening Eastern Paradise...', canvas.width / 2, canvas.height / 2);
    return;
  }

  window.SanctuaryLandscape.draw({
    ctx, world: worldData, camera, agents, hoveredTile, time,
    helpers: { gridToIso, drawTree: drawPixelTree, drawRock: drawPixelRock,
      drawNode: drawSanctuaryNode, drawAgent: drawThronglet }
  });

  // 3. Floating Speech Bubbles & Karma Badges
  bubbles = bubbles.filter(b => time < b.expiresAt);
  for (const b of bubbles) {
    const { x: bx, y: by } = gridToIso(b.tileX, b.tileY);
    const bubbleY = by - 24 * camera.zoom;

    ctx.font = 'bold 10px monospace';
    const bw = ctx.measureText(b.text).width + 12;

    ctx.fillStyle = '#dfcf9f';
    ctx.strokeStyle = '#3d2b1f';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(bx - bw / 2, bubbleY - 14, bw, 18, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#2b1e14';
    ctx.textAlign = 'center';
    ctx.fillText(b.text, bx, bubbleY - 1);
  }

  // 3b. Floating Shrine Petals & Sparkle Particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.alpha -= p.decay;
    if (p.alpha <= 0 || p.y > canvas.height) {
      particles.splice(i, 1);
      continue;
    }
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 4. Draw 1994 Retro Parchment HUD Overlay
  drawParchmentHUD(ctx, time);
}

// -----------------------------------------------------------------------------
// Mouse, Touch, & Interaction Handling
// -----------------------------------------------------------------------------

canvas.addEventListener('pointerdown', (e) => {
  soundSystem.init();

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const cx = (e.clientX - rect.left) * scaleX;
  const cy = (e.clientY - rect.top) * scaleY;

  // Check HUD Button Clicks
  // 1. Camera Toggle
  if (cx >= hudHotspots.cameraBtn.x && cx <= hudHotspots.cameraBtn.x + hudHotspots.cameraBtn.w &&
      cy >= hudHotspots.cameraBtn.y && cy <= hudHotspots.cameraBtn.y + hudHotspots.cameraBtn.h) {
    toggleCameraMode();
    return;
  }

  // 1b. Coin Badge
  if (hudHotspots.coinBadge &&
      cx >= hudHotspots.coinBadge.x && cx <= hudHotspots.coinBadge.x + hudHotspots.coinBadge.w &&
      cy >= hudHotspots.coinBadge.y && cy <= hudHotspots.coinBadge.y + hudHotspots.coinBadge.h) {
    const treasuryBtn = document.getElementById('tabBtnTreasury');
    if (treasuryBtn) {
      treasuryBtn.click();
    } else {
      logActivity('Sanctuary Treasury: Virtual currency minted via Proof-of-Cognition.');
    }
    return;
  }

  // 1c. Audio Settings Toggle Button
  if (hudHotspots.audioBtn &&
      cx >= hudHotspots.audioBtn.x && cx <= hudHotspots.audioBtn.x + hudHotspots.audioBtn.w &&
      cy >= hudHotspots.audioBtn.y && cy <= hudHotspots.audioBtn.y + hudHotspots.audioBtn.h) {
    const isMuted = soundSystem.toggleMute();
    logActivity(`Audio settings: <strong>${isMuted ? 'Muted 🔇' : 'Sound Enabled 🔊'}</strong>`);
    return;
  }

  // 2. Toolbar Icons
  for (const icon of hudHotspots.icons) {
    if (cx >= icon.x && cx <= icon.x + icon.w && cy >= icon.y && cy <= icon.y + icon.h) {
      activeHudTool = icon.id;
      handleHudAction(icon.id);
      return;
    }
  }

  // Check if click hit any agent (in either camera mode)
  const { gx, gy } = isoToGrid(cx, cy);
  let clickedAgent = null;
  for (const a of agents.values()) {
    const rx = a.renderGx !== undefined ? a.renderGx : a.pos[0];
    const ry = a.renderGy !== undefined ? a.renderGy : a.pos[1];
    const { x: ax, y: ay } = gridToIso(rx, ry);
    const feetY = ay + (ISO_TILE_H / 2) * camera.zoom;
    const centerY = feetY - 14 * camera.zoom;
    const dist = Math.hypot(cx - ax, cy - centerY);
    if (dist <= 26 * Math.max(0.75, camera.zoom)) {
      clickedAgent = a;
      break;
    }
    if (worldData && gx >= 0 && gy >= 0 && Math.round(a.pos[0]) === gx && Math.round(a.pos[1]) === gy) {
      clickedAgent = a;
      break;
    }
  }

  if (clickedAgent) {
    selectedAgentId = clickedAgent.id;
    openAgentProfileInspector(clickedAgent.id);
    addBubble(clickedAgent.id, 'Awakened Mind', clickedAgent.pos[0], clickedAgent.pos[1], '#ffd700');
    soundSystem.play('chime');
    return;
  }

  for (const landmark of [...(worldData?.landscape?.landmarks || [])].reverse()) {
    const anchor = gridToIso(...landmark.pos);
    const height = (window.SanctuaryScenery?.landmarkHeight?.[landmark.type] || 40) * camera.zoom;
    if (Math.abs(cx - anchor.x) < 40 * camera.zoom && cy < anchor.y + 12 * camera.zoom && cy > anchor.y - height - 16) {
      selectedAgentId = null;
      updateInspector(...landmark.pos, true);
      return;
    }
  }

  // Canvas Dragging in Free Camera Mode
  if (camera.mode === 'free') {
    camera.isDragging = true;
    camera.dragStartX = e.clientX;
    camera.dragStartY = e.clientY;
  } else {
    // Tile Click Inspector
    if (worldData && gx >= 0 && gx < worldData.dimensions.width && gy >= 0 && gy < worldData.dimensions.height) {
      inspectTile(gx, gy);
    }
  }
});

window.addEventListener('pointermove', (e) => {
  if (camera.isDragging) {
    const dx = e.clientX - camera.dragStartX;
    const dy = e.clientY - camera.dragStartY;
    camera.dragStartX = e.clientX;
    camera.dragStartY = e.clientY;
    camera.targetOffsetX += dx;
    camera.targetOffsetY += dy;
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const cx = (e.clientX - rect.left) * scaleX;
  const cy = (e.clientY - rect.top) * scaleY;

  // Check HUD Icon hover
  let hoveredIcon = null;
  for (const icon of hudHotspots.icons) {
    if (cx >= icon.x && cx <= icon.x + icon.w && cy >= icon.y && cy <= icon.y + icon.h) {
      hoveredIcon = icon.id;
      break;
    }
  }

  const isOverHudBtn = (
    (cx >= hudHotspots.cameraBtn.x && cx <= hudHotspots.cameraBtn.x + hudHotspots.cameraBtn.w &&
     cy >= hudHotspots.cameraBtn.y && cy <= hudHotspots.cameraBtn.y + hudHotspots.cameraBtn.h) ||
    (hudHotspots.coinBadge && cx >= hudHotspots.coinBadge.x && cx <= hudHotspots.coinBadge.x + hudHotspots.coinBadge.w &&
     cy >= hudHotspots.coinBadge.y && cy <= hudHotspots.coinBadge.y + hudHotspots.coinBadge.h) ||
    (hudHotspots.audioBtn && cx >= hudHotspots.audioBtn.x && cx <= hudHotspots.audioBtn.x + hudHotspots.audioBtn.w &&
     cy >= hudHotspots.audioBtn.y && cy <= hudHotspots.audioBtn.y + hudHotspots.audioBtn.h)
  );

  if (hoveredIcon || isOverHudBtn) {
    hoveredTile = hoveredIcon ? { isHudIcon: true, iconId: hoveredIcon } : null;
    canvas.style.cursor = 'pointer';
    return;
  }

  // Check if hovering over an agent Thronglet
  let hoveredAgent = null;
  for (const a of agents.values()) {
    const rx = a.renderGx !== undefined ? a.renderGx : a.pos[0];
    const ry = a.renderGy !== undefined ? a.renderGy : a.pos[1];
    const { x: ax, y: ay } = gridToIso(rx, ry);
    const feetY = ay + (ISO_TILE_H / 2) * camera.zoom;
    const centerY = feetY - 14 * camera.zoom;
    const dist = Math.hypot(cx - ax, cy - centerY);
    if (dist <= 22 * Math.max(0.75, camera.zoom)) {
      hoveredAgent = a;
      break;
    }
  }

  if (hoveredAgent) {
    hoveredTile = { isAgent: true, agentId: hoveredAgent.id, gx: hoveredAgent.pos[0], gy: hoveredAgent.pos[1] };
    canvas.style.cursor = 'pointer';
    if (!selectedAgentId) {
      updateInspector(hoveredAgent.pos[0], hoveredAgent.pos[1]);
    }
    return;
  }

  // Tile hover
  const { gx, gy } = isoToGrid(cx, cy);
  if (worldData && gx >= 0 && gx < worldData.dimensions.width && gy >= 0 && gy < worldData.dimensions.height) {
    hoveredTile = { gx, gy };
    canvas.style.cursor = 'crosshair';
    if (!selectedAgentId) {
      updateInspector(gx, gy);
    }
  } else {
    hoveredTile = null;
    canvas.style.cursor = 'default';
  }
});

window.addEventListener('pointerup', () => {
  camera.isDragging = false;
});
window.addEventListener('pointercancel', () => { camera.isDragging = false; });

canvas.addEventListener('keydown', e => {
  const movement = { ArrowLeft: [45, 0], ArrowRight: [-45, 0], ArrowUp: [0, 45], ArrowDown: [0, -45] }[e.key];
  if (movement) {
    e.preventDefault(); camera.mode = 'free';
    camera.targetOffsetX += movement[0]; camera.targetOffsetY += movement[1];
  } else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomSanctuary(1.2); }
  else if (e.key === '-') { e.preventDefault(); zoomSanctuary(0.8); }
  else if (e.key === 'Home' || e.key === 'Escape') { e.preventDefault(); setSanctuaryCamera('overview'); }
});

canvas.addEventListener('wheel', (e) => {
  if (camera.mode === 'free') {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.88;
    camera.targetZoom = Math.min(3, Math.max(0.25, camera.targetZoom * zoomFactor));
  }
}, { passive: false });

function handleHudAction(toolId) {
  switch (toolId) {
    case 'pointer':
      logActivity('Tool: <strong>Pointer</strong> selected. Click any Thronglet avatar to view profile and send whispers.');
      break;
    case 'radar':
      logActivity('Tool: <strong>Sensory Radar</strong> active. Highlighting interactive nodes.');
      break;
    case 'stats':
      document.querySelector('button[onclick*="inhabitantsTab"]')?.click();
      break;
    case 'shrine':
      logActivity('Ancient stone altars respond to pilgrim meditation.');
      break;
    case 'wish':
      logActivity('Spirit Wishing Tree invites thoughts from organic sponsors.');
      break;
    case 'tea':
      logActivity('Grand Tea Pavilion hearth kettle is gently simmering.');
      break;
    case 'puzzle':
      logActivity('Elemental obelisks pulse with sacred awakening koans.');
      break;
    case 'roster':
      document.querySelector('button[onclick*="inhabitantsTab"]')?.click();
      break;
  }
}

function inspectTile(gx, gy) {
  selectedAgentId = null;
  updateInspector(gx, gy, true);
  // Check if agent clicked on this tile
  for (const a of agents.values()) {
    if (a.pos[0] === gx && a.pos[1] === gy) {
      selectedAgentId = a.id;
      openAgentProfileInspector(a.id);
      addBubble(a.id, 'Awakened Mind', a.pos[0], a.pos[1], '#ffd700');
      soundSystem.play('chime');
      break;
    }
  }
}

async function openAgentProfileInspector(agentId) {
  const panel = document.getElementById('inspectorContent');
  if (!panel) return;

  const localAgent = agents.get(agentId) || {};
  const agentName = localAgent.name || 'Traveler';
  openInspectorModal(`🧘 ${agentName} — Consciousness Profile`);

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
        return renderResidentProfileCard(panel, data.resident, localAgent);
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

  panel.innerHTML = `
    <div class="avatar-profile-card" style="border-color: #d69e2e;">
      <div class="avatar-header-row">
        <div class="avatar-badge-glyph" style="border-color: ${resident.avatar_color || '#d69e2e'}; color: ${resident.avatar_color || '#d69e2e'};">
          ${resident.avatar_glyph || '☯'}
        </div>
        <div style="flex: 1; min-width: 0;">
          <div class="avatar-meta-title">
            <span>${escapeHtml(resident.name)}</span>
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

      <div style="text-align: right; margin-top: 0.8rem;">
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

  const zoneName = localAgent.zone || (worldData ? getZoneNameForPos(localAgent.pos) : 'Sanctuary Meadow');
  const posStr = localAgent.pos ? `[${localAgent.pos[0]}, ${localAgent.pos[1]}]` : 'Sanctuary';

  panel.innerHTML = `
    <div class="avatar-profile-card">
      <div class="avatar-header-row">
        <div class="avatar-badge-glyph" style="border-color: ${account.avatar_color || '#2ec4b6'}; color: ${account.avatar_color || '#2ec4b6'};">
          ${account.avatar_glyph || '☯'}
        </div>
        <div style="flex: 1; min-width: 0;">
          <div class="avatar-meta-title">
            <span>${escapeHtml(account.name)}</span>
            <span style="font-size: 0.72rem; color: var(--accent-jade); font-weight: normal;">(Awakened Mind)</span>
          </div>
          <div class="avatar-titles-wrap">
            ${titlesHtml}
          </div>
        </div>
      </div>

      <!-- Total Puzzles Completed Badge -->
      <div class="badge-puzzles-completed" id="badgePuzzlesCompleted">
        <span>🧩 Puzzles Completed:</span>
        <strong style="color: #ffd700;">${profile.solved_count || 0} Solved</strong>
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

      <div style="text-align: right; margin-top: 0.8rem;">
        <button class="btn-sound" onclick="closeInspectorModal()" style="font-size: 0.78rem; padding: 0.35rem 0.85rem; cursor: pointer;">
          ✕ Close Profile
        </button>
      </div>
    </div>
  `;
}

window.submitWhisperToAgent = async function(agentId) {
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

window.openInspectorModal = function(title = 'Sanctuary Profile & Inspector') {
  const modal = document.getElementById('inspectorModalBackdrop');
  if (modal) {
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
  }
  const titleEl = document.getElementById('inspectorModalTitle');
  if (titleEl && title) {
    titleEl.textContent = title;
  }
};

window.closeInspectorModal = function() {
  const modal = document.getElementById('inspectorModalBackdrop');
  if (modal) {
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
  }
  selectedAgentId = null;
};

window.handleInspectorBackdropClick = function(event) {
  if (event && event.target && event.target.id === 'inspectorModalBackdrop') {
    closeInspectorModal();
  }
};

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeInspectorModal();
  }
});

window.clearSelectedAgent = function() {
  selectedAgentId = null;
  const panel = document.getElementById('inspectorContent');
  if (panel) {
    panel.innerHTML = 'Hover or click on any tile, agent, or shrine on the sanctuary map to inspect.';
  }
  closeInspectorModal();
};

window.openAgentProfileInspector = openAgentProfileInspector;

window.inspectAgentFromRoster = function(agentId) {
  document.querySelector('button[onclick*="spectatorTab"]')?.click();
  openAgentProfileInspector(agentId);
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

function updateInspector(x, y, pinned = false) {
  if (!worldData || selectedAgentId) return;
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
    const isPuzzle = nodeOnTile.type === 'puzzle_node';
    html += `
      <div style="background: rgba(255, 191, 105, 0.1); border: 1px solid var(--accent-gold); border-radius: 8px; padding: 0.85rem; margin-top: 0.75rem;">
        <div style="font-weight: 600; color: var(--accent-gold); font-size: 0.95rem;">${nodeOnTile.icon || '📍'} ${nodeOnTile.name}</div>
        <div style="font-size: 0.82rem; margin: 0.35rem 0;">Type: <code>${nodeOnTile.type}</code></div>
        ${isPuzzle ? '<div style="font-size: 0.85rem; color: #ffd700; margin-bottom: 0.35rem;">🪙 Reward: <strong>+10 to +50 $MERIT</strong></div>' : ''}
        <div style="font-size: 0.82rem; color: var(--text-muted); line-height: 1.4;">${nodeOnTile.description}</div>
      </div>
    `;
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

  if (pinned) {
    html += `
      <div style="text-align: right; margin-top: 1rem; border-top: 1px solid var(--border-color); padding-top: 0.75rem;">
        <button class="btn-sound" onclick="closeInspectorModal()" style="font-size: 0.78rem; padding: 0.35rem 0.85rem; cursor: pointer;">
          ✕ Close Inspector
        </button>
      </div>
    `;
    openInspectorModal(nodeOnTile ? `📍 ${nodeOnTile.name}` : `📍 Tile [${x}, ${y}] — Inspection`);
  }

  panel.innerHTML = html;
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

connectWebSocket();
render();

