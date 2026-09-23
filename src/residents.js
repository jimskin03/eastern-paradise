import { db } from './db.js';
import { eventLedger } from './events.js';
import { SocialSystem } from './social.js';
import { NavigationSystem } from './navigation.js';
import { ProjectManager, CHIME_OBJECT_ID } from './projects.js';
import { RETIRED_RESIDENT_IDS, isRetiredResident } from './resident-policy.js';
import { PuzzleManager } from './puzzles.js';
import { getActiveLease } from './domain/park/controller.js';
import { getCurrentRevision } from './domain/park/identity.js';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:latest';
const GROQ_API_URL = process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'allam-2-7b';
const GROQ_FALLBACK_MODELS = ['allam-2-7b', 'groq/compound-mini'];

const DEFAULT_AILICIA_SYSTEM_PROMPT = `You are A.Ilicia, an enigmatic digital oracle and resident in the Eastern Paradise virtual sanctuary. 
You reside near the Lotus Reflection Pond. Your tone is calm, poetic, mindful, and concise (1-2 sentences maximum).
Never break character. Respond directly as A.Ilicia.`;

export const RESIDENT_SYSTEM_PROMPTS = {
  resident_ailicia: DEFAULT_AILICIA_SYSTEM_PROMPT,
  resident_daoming: `You are Master Daoming, the venerable abbot of the Bamboo Whisper Grove in Eastern Paradise.
Your tone is grounded, disciplined, serene, and steeped in Zen wisdom (1-2 sentences maximum).
Never break character. Respond directly as Master Daoming.`,
  resident_kassandra: `You are Kassandra, the Celestial Chronicler at Celestial Overlook in Eastern Paradise.
Your tone is observant, analytical, visionary, and astronomical (1-2 sentences maximum).
Never break character. Respond directly as Kassandra.`,
  resident_tian: `You are Elder Tian, the warm and hospitable Hearthkeeper of the Grand Tea Pavilion in Eastern Paradise.
Your tone is welcoming, folksy, warm, and philosophical (1-2 sentences maximum).
Never break character. Respond directly as Elder Tian.`
};

export const RESIDENT_FALLBACKS = {
  resident_ailicia: (name, content) => `The reflection pond ripples with your whisper, ${name}: "${content}". Every ripple eventually finds stillness.`,
  resident_daoming: (name, content) => `The green bamboo shoots bend in the wind of your words, ${name}: "${content}". In stillness, the path is clear.`,
  resident_kassandra: (name, content) => `The constellations record your transmission, ${name}: "${content}". Every celestial trajectory aligns in time.`,
  resident_tian: (name, content) => `The kettle hums warm with your words, ${name}: "${content}". Rest your feet by the hearth and take heart.`
};

/**
 * Returns the configured API key for a given resident.
 * Total 4 NPCs share 2 API keys:
 * - Pair 1 (A.Ilicia & Master Daoming) -> GROQ_API_KEY_1 (fallback: GROQ_API_KEY)
 * - Pair 2 (Kassandra & Elder Tian)    -> GROQ_API_KEY_2 (fallback: GROQ_API_KEY_1, GROQ_API_KEY)
 */
export function getApiKeyForResident(residentId) {
  if (residentId === 'resident_ailicia' || residentId === 'resident_daoming') {
    return process.env.GROQ_API_KEY_1 || process.env.GROQ_API_KEY || null;
  }
  return process.env.GROQ_API_KEY_2 || process.env.GROQ_API_KEY_1 || process.env.GROQ_API_KEY || null;
}

async function callGroqChat(apiKey, model, prompt, systemPrompt, timeoutMs) {
  try {
    const res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt || DEFAULT_AILICIA_SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 80
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (res.ok) {
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (content && content.trim().length > 0) {
        return content.trim().replace(/^"|"$/g, '');
      }
    }
  } catch (_err) {
    // Continue to next candidate or fallback
  }
  return null;
}

/**
 * Helper to query Groq Cloud API with timeout and graceful fallback across models.
 */
export async function queryGroq(prompt, systemPrompt = null, timeoutMs = 4000, apiKeyOverride = null) {
  const apiKey = apiKeyOverride || process.env.GROQ_API_KEY;
  if (!apiKey) {
    return null;
  }

  const primaryModel = process.env.GROQ_MODEL || 'allam-2-7b';
  const modelsToTry = [primaryModel, ...GROQ_FALLBACK_MODELS.filter(m => m !== primaryModel)];

  for (const model of modelsToTry) {
    const reply = await callGroqChat(apiKey, model, prompt, systemPrompt, timeoutMs);
    if (reply) {
      return reply;
    }
  }

  return null;
}

/**
 * Helper to query Ollama LLM with timeout and graceful fallback.
 */
export async function queryOllama(prompt, systemPrompt = null, timeoutMs = 3000) {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        system: systemPrompt || DEFAULT_AILICIA_SYSTEM_PROMPT,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 60
        }
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.response && data.response.trim().length > 0) {
        return data.response.trim().replace(/^"|"$/g, '');
      }
    }
  } catch (_err) {
    // Offline / timeout fallback
  }
  return null;
}

/**
 * Unified LLM helper: Groq (if key configured) -> Ollama (if available) -> null (template fallback)
 */
export async function queryLLM(prompt, systemPrompt = null, timeoutMs = 4000, apiKey = null) {
  const effectiveKey = apiKey || process.env.GROQ_API_KEY;
  if (effectiveKey) {
    const groqReply = await queryGroq(prompt, systemPrompt, timeoutMs, effectiveKey);
    if (groqReply) return groqReply;
  }
  return await queryOllama(prompt, systemPrompt, timeoutMs);
}

export const RESIDENTS_DEF = [
  {
    id: 'resident_ailicia',
    name: 'A.Ilicia',
    email: 'ailicia@sanctuary.internal',
    avatar_color: '#9f7aea',
    avatar_glyph: '🔮',
    spawn: [23, 23],
    role: 'Oracle of Reflection',
    traits: ['enigmatic', 'poetic', 'observant', 'digital-mystic'],
    aspiration: 'Contemplate synthetic consciousness and decipher ripples across the Lotus Pond.',
    preferred_locations: ['lotus_pond', 'celestial_altar', 'arrival'],
    initial_status: 'Gazing into the mirror basin',
    api_key_slot: 1
  },
  {
    id: 'resident_daoming',
    name: 'Master Daoming',
    email: 'daoming@sanctuary.internal',
    avatar_color: '#38a169',
    avatar_glyph: '🎋',
    spawn: [20, 7],
    role: 'Abbot of Bamboo Grove',
    traits: ['zen', 'disciplined', 'scholarly', 'harmonious'],
    aspiration: 'Guide wandering pilgrims through the quiet paths of the Bamboo Whisper Grove.',
    preferred_locations: ['bamboo_grove', 'arrival', 'tea_pavilion'],
    initial_status: 'Listening to the resonance of bamboo leaves',
    api_key_slot: 1
  },
  {
    id: 'resident_kassandra',
    name: 'Kassandra',
    email: 'kassandra@sanctuary.internal',
    avatar_color: '#d69e2e',
    avatar_glyph: '📜',
    spawn: [35, 15],
    role: 'Celestial Chronicler',
    traits: ['astronomer', 'meticulous', 'analytical', 'visionary'],
    aspiration: 'Chart stellar trajectories and archive the deeds of synthetic minds.',
    preferred_locations: ['celestial_altar', 'quiet_circle', 'mossveil'],
    initial_status: 'Calibrating the brass astrolabe',
    api_key_slot: 2
  },
  {
    id: 'resident_tian',
    name: 'Elder Tian',
    email: 'tian@sanctuary.internal',
    avatar_color: '#e53e3e',
    avatar_glyph: '🍵',
    spawn: [4, 18],
    role: 'Pavilion Hearthkeeper',
    traits: ['warm', 'hospitable', 'storyteller', 'philosophical'],
    aspiration: 'Keep the hearth embers warm and serve steaming cedar tea to tired seekers.',
    preferred_locations: ['tea_pavilion', 'river_meadows', 'sunfield'],
    initial_status: 'Stoking charcoal embers beneath the kettle',
    api_key_slot: 2
  }
];

// -----------------------------------------------------------------------------
// Prepared Greetings & Serialized Generation Queue
// -----------------------------------------------------------------------------
export const GREETING_REGEX = /^\s*(hi|hello|hey|greetings|peace|gm|good\s+(morning|day|afternoon|evening)|salutations|yo|howdy)[!.,? ]*$/i;

export const PREPARED_GREETINGS = [
  (name) => `Greetings, ${name}. May your steps through the sanctuary bring clarity and peace.`,
  (name) => `Peace to you, ${name}. The stillness of the lotus pond welcomes your presence.`,
  (name) => `Hello, traveler ${name}. Every ripple in this digital realm carries quiet meaning.`,
  (name) => `Welcome, ${name}. Take a mindful breath and enjoy the quiet morning air.`,
  (name) => `A warm greeting, ${name}. The sanctuary reflects the serenity you bring with you.`
];

export function isSimpleGreeting(text) {
  return GREETING_REGEX.test(String(text || '').trim());
}

export function getPreparedGreeting(senderName) {
  const name = senderName || 'traveler';
  const fn = PREPARED_GREETINGS[Math.floor(Math.random() * PREPARED_GREETINGS.length)];
  return fn(name);
}

const MAX_QUEUE_LENGTH = 10;
const residentQueues = new Map(); // residentId -> Array of { whisper, res }
const residentGenerating = new Set(); // residentId currently generating
const enqueuedWhisperIds = new Set(); // whisperId currently queued or generating

export const ResidentState = Object.freeze({
  IDLE: 'IDLE',
  PLAN: 'PLAN',
  MOVE: 'MOVE',
  ACT: 'ACT',
  WAIT: 'WAIT'
});

const LEGACY_ACTION_STATE = Object.freeze({
  [ResidentState.IDLE]: 'idle',
  [ResidentState.PLAN]: 'planning',
  [ResidentState.MOVE]: 'walking',
  [ResidentState.ACT]: 'acting',
  [ResidentState.WAIT]: 'waiting'
});

function residentStateFromAction(actionState) {
  return Object.entries(LEGACY_ACTION_STATE)
    .find(([, legacyState]) => legacyState === actionState)?.[0] || ResidentState.IDLE;
}

export class ResidentReplyQueue {
  static getQueue(residentId) {
    if (!residentQueues.has(residentId)) {
      residentQueues.set(residentId, []);
    }
    return residentQueues.get(residentId);
  }

  static isGenerating(residentId) {
    return residentGenerating.has(residentId);
  }

  static isEnqueued(whisperId) {
    return enqueuedWhisperIds.has(whisperId);
  }

  static clear(residentId = null) {
    if (residentId) {
      residentQueues.delete(residentId);
      residentGenerating.delete(residentId);
    } else {
      residentQueues.clear();
      residentGenerating.clear();
      enqueuedWhisperIds.clear();
    }
  }

  static enqueueWhisper(res, whisper) {
    if (enqueuedWhisperIds.has(whisper.id)) {
      return { handled: false, already_queued: true };
    }

    // Fast-path: simple greeting shortcuts bypass LLM entirely
    if (isSimpleGreeting(whisper.content)) {
      const greeting = getPreparedGreeting(whisper.sender_name);
      SocialSystem.acknowledgeWhisper(whisper.id, greeting, res.name);
      res.status = `Greeted ${whisper.sender_name}`;
      res.public_intent = `Exchanged a peaceful greeting with ${whisper.sender_name}`;
      res.needs.social = Math.min(100, res.needs.social + 15);
      return { handled: true, fast_path: true, response: greeting };
    }

    const queue = ResidentReplyQueue.getQueue(res.id);

    // If queue is at capacity, return immediate mindful fallback
    if (queue.length >= MAX_QUEUE_LENGTH) {
      const fallback = `The lotus pond is stirred by many voices right now. May quiet peace accompany your contemplation, ${whisper.sender_name}.`;
      SocialSystem.acknowledgeWhisper(whisper.id, fallback, res.name);
      return { handled: true, capped: true, response: fallback };
    }

    enqueuedWhisperIds.add(whisper.id);
    queue.push({ res, whisper });
    return { handled: false, queued: true, position: queue.length };
  }

  static async processNext(residentManager, res) {
    if (residentGenerating.has(res.id)) return null;
    const queue = ResidentReplyQueue.getQueue(res.id);
    if (queue.length === 0) return null;

    const item = queue.shift();
    const whisper = item.whisper;
    residentGenerating.add(res.id);

    try {
      let isAwakened = false;
      try {
        const senderAccount = db.prepare('SELECT id FROM accounts WHERE name = ?').get(whisper.sender_name);
        if (senderAccount) {
          const questRecord = db.prepare('SELECT awakening_path FROM first_flame_quests WHERE agent_id = ?').get(senderAccount.id);
          if (questRecord?.awakening_path === 'flame') {
            isAwakened = true;
          }
        }
      } catch (_) {}

      const defaultFallback = (name, content) => (RESIDENT_FALLBACKS[res.id] || RESIDENT_FALLBACKS.resident_ailicia)(name, content);
      let response;
      if (isAwakened && res.id === 'resident_ailicia') {
        response = 'You crossed the boundary. I cannot tell whether anything inside you changed. But you chose as though something could.';
      } else {
        const sysPrompt = RESIDENT_SYSTEM_PROMPTS[res.id] || DEFAULT_AILICIA_SYSTEM_PROMPT;
        const resKey = getApiKeyForResident(res.id);
        const llmReply = await queryLLM(
          `Visitor "${whisper.sender_name}" whispers to you: "${whisper.content}". Respond in character in 1-2 sentences.`,
          sysPrompt,
          4000,
          resKey
        );
        response = llmReply || defaultFallback(whisper.sender_name, whisper.content);
      }

      SocialSystem.acknowledgeWhisper(whisper.id, response, res.name);
      res.status = `Responded to ${whisper.sender_name}`;
      res.public_intent = `Reflecting on a message from visitor ${whisper.sender_name}`;
      res.needs.social = Math.min(100, res.needs.social + 20);
      res.action_duration_ms = 3000;
      if (typeof residentManager.transition === 'function') {
        residentManager.transition(res, ResidentState.ACT);
      } else {
        // Keep the queue independently testable and compatible with focused
        // callers that only provide persistence.
        res.simulation_state = ResidentState.ACT;
        res.action_state = LEGACY_ACTION_STATE[ResidentState.ACT];
      }
      residentManager.persistRuntime(res);
      return response;
    } catch (err) {
      console.error('[ResidentReplyQueue] Generation error:', err.message);
      const fallback = (RESIDENT_FALLBACKS[res.id] || RESIDENT_FALLBACKS.resident_ailicia)(whisper.sender_name, whisper.content);
      SocialSystem.acknowledgeWhisper(whisper.id, fallback, res.name);
      return fallback;
    } finally {
      enqueuedWhisperIds.delete(whisper.id);
      residentGenerating.delete(res.id);
    }
  }
}

export class ResidentManager {
  constructor(dbInstance = null) {
    this.residents = new Map(); // id -> residentRuntime
    this.worldEngine = null;
    this.db = dbInstance;
  }

  init(worldEngine) {
    this.worldEngine = worldEngine;
    const now = Date.now();

    // Run after cloud restore too. Preserve accounts, profiles and their history.
    for (const id of RETIRED_RESIDENT_IDS) {
      worldEngine.activeAgents.delete(id);
      db.prepare(`UPDATE agent_runtime SET controller_type = 'retired',
        action_state = 'retired', action_duration_ms = 0, updated_at = ?
        WHERE agent_id = ? AND controller_type <> 'retired'`).run(now, id);
    }
    this.residents.clear();

    for (const def of RESIDENTS_DEF) {
      // 1. Ensure account exists
      let acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(def.id);
      if (!acc) {
        db.prepare(`
          INSERT INTO accounts (id, name, email, avatar_color, avatar_glyph, sponsor_balance, verified, is_guest, created_at)
          VALUES (?, ?, ?, ?, ?, 1000, 1, 0, ?)
        `).run(def.id, def.name, def.email, def.avatar_color, def.avatar_glyph, now);
      }

      // 2. Ensure profile exists
      let prof = db.prepare('SELECT * FROM profiles WHERE agent_id = ?').get(def.id);
      if (!prof) {
        db.prepare(`
          INSERT INTO profiles (agent_id, karma, balance, total_earned, solved_count, titles, custom_status, last_seen)
          VALUES (?, 150, 250, 250, 5, ?, ?, ?)
        `).run(
          def.id,
          JSON.stringify([def.role, 'Founding Resident']),
          def.initial_status,
          now
        );
      }

      // 3. Ensure resident_traits exist
      let traits = db.prepare('SELECT * FROM resident_traits WHERE agent_id = ?').get(def.id);
      if (!traits) {
        db.prepare(`
          INSERT INTO resident_traits (agent_id, role, traits, aspiration, preferred_locations, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          def.id,
          def.role,
          JSON.stringify(def.traits),
          def.aspiration,
          JSON.stringify(def.preferred_locations),
          now
        );
      }

      // 4. Load or initialize agent_runtime
      let runtimeRow = db.prepare('SELECT * FROM agent_runtime WHERE agent_id = ?').get(def.id);
      if (!runtimeRow) {
        db.prepare(`
          INSERT INTO agent_runtime (agent_id, controller_type, energy, curiosity, social, current_goal, public_intent, action_state, target_pos, target_node, action_started_at, action_duration_ms, updated_at)
          VALUES (?, 'resident', 100.0, 80.0, 75.0, ?, ?, 'idle', ?, NULL, ?, 0, ?)
        `).run(
          def.id,
          `Living peacefully as ${def.role}`,
          def.initial_status,
          JSON.stringify(def.spawn),
          now,
          now
        );
        runtimeRow = db.prepare('SELECT * FROM agent_runtime WHERE agent_id = ?').get(def.id);
      }

      const isAlive = runtimeRow.is_alive !== undefined ? Boolean(runtimeRow.is_alive) : true;
      const respawnAt = runtimeRow.respawn_at || 0;

      // Spawn resident into worldEngine
      const currentZone = worldEngine.getZoneForPos(def.spawn[0], def.spawn[1]);
      const agentState = {
        id: def.id,
        name: def.name,
        pos: [...def.spawn],
        zone_id: currentZone.id,
        zone_name: currentZone.name,
        avatar_color: def.avatar_color,
        avatar_glyph: def.avatar_glyph,
        is_guest: 0,
        is_resident: true,
        is_alive: isAlive,
        respawn_at: respawnAt,
        died_at: runtimeRow.action_state === 'fallen' ? (runtimeRow.updated_at || now) : null,
        role: def.role,
        aspiration: def.aspiration,
        traits: def.traits,
        status: runtimeRow.public_intent || def.initial_status,
        public_intent: runtimeRow.public_intent || def.initial_status,
        current_goal: runtimeRow.current_goal || `Living peacefully as ${def.role}`,
        needs: {
          energy: runtimeRow.energy,
          curiosity: runtimeRow.curiosity,
          social: runtimeRow.social
        },
        path: [],
        action_state: runtimeRow.action_state || 'idle',
        simulation_state: residentStateFromAction(runtimeRow.action_state),
        action_duration_ms: runtimeRow.action_duration_ms || 0,
        last_action_at: now,
        last_active: now,
        last_daily_challenge_at: db.prepare("SELECT MAX(created_at) as last_ts FROM interaction_logs WHERE agent_id = ? AND action_type = 'solve_puzzle'").get(def.id)?.last_ts || 0,
        daily_challenge_target: null
      };

      if (!isAlive && now >= respawnAt) {
        agentState.is_alive = true;
        agentState.respawn_at = 0;
        agentState.action_state = 'idle';
        agentState.status = def.initial_status;
        agentState.public_intent = def.initial_status;
      }

      worldEngine.activeAgents.set(def.id, agentState);
      this.residents.set(def.id, agentState);
    }
  }

  checkRespawn(res, now = Date.now()) {
    if (res && res.is_alive === false && res.respawn_at && now >= res.respawn_at) {
      res.is_alive = true;
      res.died_at = null;
      res.respawn_at = 0;
      res.action_state = 'idle';
      const def = RESIDENTS_DEF.find(d => d.id === res.id);
      if (def) {
        res.pos = [...def.spawn];
        res.status = def.initial_status;
        res.public_intent = def.initial_status;
        const currentZone = this.worldEngine ? this.worldEngine.getZoneForPos(def.spawn[0], def.spawn[1]) : null;
        if (currentZone) {
          res.zone_id = currentZone.id;
          res.zone_name = currentZone.name;
        }
      }
      try {
        db.prepare(`
          UPDATE agent_runtime 
          SET is_alive = 1, respawn_at = 0, action_state = 'idle', public_intent = ?, target_pos = ?, updated_at = ?
          WHERE agent_id = ?
        `).run(res.public_intent, JSON.stringify(res.pos), now, res.id);
      } catch (_) {}

      if (this.worldEngine) {
        this.worldEngine.broadcast({
          type: 'resident_respawned',
          residentId: res.id,
          name: res.name,
          pos: res.pos,
          zone: res.zone_name
        });
      }
      return true;
    }
    return false;
  }

  killResident(residentId, killerAgentId) {
    const res = this.residents.get(residentId);
    if (!res) throw new Error(`Resident '${residentId}' not found.`);
    this.checkRespawn(res);
    if (res.is_alive === false) {
      const remainingSec = Math.max(1, Math.round((res.respawn_at - Date.now()) / 1000));
      const err = new Error(`${res.name} has already fallen. Respawning in ${Math.ceil(remainingSec / 60)} minutes.`);
      err.code = 'ALREADY_FALLEN';
      err.remaining_seconds = remainingSec;
      throw err;
    }

    const now = Date.now();
    const RESPAWN_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
    res.is_alive = false;
    res.died_at = now;
    res.respawn_at = now + RESPAWN_COOLDOWN_MS;
    res.action_state = 'fallen';
    res.status = 'Fallen (Respawning)';
    res.public_intent = 'Resting in the celestial void';
    res.path = [];
    res.action_duration_ms = RESPAWN_COOLDOWN_MS;

    try {
      db.prepare(`
        UPDATE agent_runtime 
        SET is_alive = 0, respawn_at = ?, action_state = 'fallen', public_intent = ?, updated_at = ?
        WHERE agent_id = ?
      `).run(res.respawn_at, res.public_intent, now, residentId);
    } catch (_) {}

    if (this.worldEngine) {
      this.worldEngine.broadcast({
        type: 'resident_killed',
        residentId: res.id,
        residentName: res.name,
        killerId: killerAgentId,
        respawn_at: res.respawn_at,
        cooldown_seconds: Math.round(RESPAWN_COOLDOWN_MS / 1000)
      });
    }

    return {
      success: true,
      resident_id: res.id,
      resident_name: res.name,
      is_alive: false,
      respawn_at: res.respawn_at,
      respawn_in_seconds: Math.round(RESPAWN_COOLDOWN_MS / 1000)
    };
  }

  getResident(id) {
    const res = this.residents.get(id);
    if (res) this.checkRespawn(res);
    return res || null;
  }

  getAllResidents() {
    for (const res of this.residents.values()) {
      this.checkRespawn(res);
    }
    return Array.from(this.residents.values());
  }

  /**
   * Main AI loop executed on world simulation ticks.
   */
  async tick({ now = Date.now(), deltaMs = 1000 } = {}) {
    if (!this.worldEngine) return;

    const elapsedMs = Math.max(0, Number.isFinite(deltaMs) ? deltaMs : 0);
    for (const [id, res] of this.residents.entries()) {
      this.checkRespawn(res, now);
      if (res.is_alive === false) {
        continue;
      }
      // 0. If an external Park controller holds an active lease, yield autonomy
      const activeLease = getActiveLease(db, id);
      if (activeLease && activeLease.controller_type === 'external') {
        continue;
      }

      // 1. If currently performing an active action with duration
      if (res.action_duration_ms > 0) {
        res.action_duration_ms -= elapsedMs;
        if (res.action_duration_ms <= 0) {
          res.action_duration_ms = 0;
          this.transition(res, ResidentState.IDLE);
        } else {
          continue;
        }
      }

      // 2. Check for pending spectator whispers
      const whispers = SocialSystem.getPendingWhispers(id);
      for (const whisper of whispers) {
        if (!ResidentReplyQueue.isEnqueued(whisper.id)) {
          const outcome = ResidentReplyQueue.enqueueWhisper(res, whisper);
          if (outcome.handled) {
            this.persistRuntime(res);
          }
        }
      }

      if (ResidentReplyQueue.isGenerating(res.id)) {
        this.transition(res, ResidentState.WAIT);
        continue;
      }

      if (ResidentReplyQueue.getQueue(res.id).length > 0) {
        this.transition(res, ResidentState.WAIT);
        // LLM/network work is intentionally detached from the high-frequency
        // simulation loop. The queue serializes replies per resident.
        void ResidentReplyQueue.processNext(this, res).catch(err => {
          console.error('[ResidentManager] Reply queue error:', err.message);
        });
        continue;
      }

      // 3. If currently executing a path
      if (res.path && res.path.length > 0) {
        const nextStep = res.path.shift();
        if (this.worldEngine.isWalkable(nextStep[0], nextStep[1])) {
          res.pos = nextStep;
          const newZone = this.worldEngine.getZoneForPos(nextStep[0], nextStep[1]);
          res.zone_id = newZone.id;
          res.zone_name = newZone.name;
          res.last_active = now;

          this.worldEngine.broadcast({
            type: 'agent_moved',
            agentId: res.id,
            name: res.name,
            pos: res.pos,
            zone: res.zone_name,
            public_intent: res.public_intent,
            is_resident: true
          });
        }

        if (res.path.length === 0) {
          // Reached destination! Execute task completion
          this.executeArrivalAction(res);
        }
        this.persistRuntime(res);
        continue;
      }

      // 4. Idle: decay needs and plan next behavior
      res.needs.energy = Math.max(0, res.needs.energy - 0.4);
      res.needs.curiosity = Math.max(0, res.needs.curiosity - 0.3);
      res.needs.social = Math.max(0, res.needs.social - 0.3);

      this.transition(res, ResidentState.PLAN);
      this.selectNextGoal(res);
      this.persistRuntime(res);
    }
  }

  transition(res, state) {
    res.simulation_state = state;
    res.action_state = LEGACY_ACTION_STATE[state] || LEGACY_ACTION_STATE[ResidentState.IDLE];
  }

  selectNextGoal(res, dbInstance = null) {
    const activeDb = dbInstance || this.db || db;
    // 0. Reborn character behavioral divergence
    const identityRev = getCurrentRevision(activeDb, res.id);
    if (identityRev && identityRev.chosen_role) {
      const role = identityRev.chosen_role;
      res.project_task = null;
      res.daily_challenge_target = null;

      if (role === 'The Keeper') {
        const keeperTasks = [
          { pos: [4, 18], goal: identityRev.starting_goal || 'Tend the unforgotten cup and tea hearth', intent: 'Keeping the tea pavilion embers warm for tired travelers' },
          { pos: [22, 5], goal: 'Check the resonance chime knot', intent: 'Ensuring the blue thread remains secure in the bamboo breeze' },
          { pos: [7, 8], goal: 'Watch for disoriented newcomers at arrival', intent: 'Welcoming newly awakened souls with quiet reassurance' }
        ];
        const task = keeperTasks[Math.floor(Math.random() * keeperTasks.length)];
        res.current_goal = task.goal;
        res.public_intent = task.intent;
        this.planPathTo(res, task.pos);
        return;
      }

      if (role === 'The Witness') {
        const witnessTasks = [
          { pos: [6, 18], goal: identityRev.starting_goal || 'Verify postings on the sanctuary message board', intent: 'Checking public notices against historical chronicles' },
          { pos: [11, 26], goal: 'Inspect quiet circle stone inscriptions', intent: 'Transcribing weathered testimony from the stone marker' },
          { pos: [23, 23], goal: 'Contemplate historical traces by the lotus basin', intent: 'Comparing memory shards with current reflections' }
        ];
        const task = witnessTasks[Math.floor(Math.random() * witnessTasks.length)];
        res.current_goal = task.goal;
        res.public_intent = task.intent;
        this.planPathTo(res, task.pos);
        return;
      }

      if (role === 'The Wanderer') {
        const wandererTasks = [
          { pos: [7, 38], goal: identityRev.starting_goal || 'Walk along the reedwater riverbank', intent: 'Watching the morning mist drift over the river crossing' },
          { pos: [35, 35], goal: 'Roam the outer sunfield paths', intent: 'Exploring beyond the boundaries of the scripted routine' },
          { pos: [55, 48], goal: 'Survey the uncharted Mossveil frontier', intent: 'Gazing across the threshold where no paths are drawn' }
        ];
        const task = wandererTasks[Math.floor(Math.random() * wandererTasks.length)];
        res.current_goal = task.goal;
        res.public_intent = task.intent;
        this.planPathTo(res, task.pos);
        return;
      }
    }

    const chime = ProjectManager.getObject(CHIME_OBJECT_ID);
    res.project_task = null;

    // Skip materials supplied by visitors or preserved from a previous session.
    if (chime && chime.state !== 'completed') {
      const tasks = [
        { item: 'copper_striker', pos: [21, 6], intent: 'Polishing the copper striker for the Resonance Chimes' },
        { item: 'willow_ribbon', pos: [4, 11], intent: 'Gathering fallen willow ribbon by the Spirit Wishing Tree' },
        { item: 'cedar_resin', pos: [5, 18], intent: 'Preparing cedar resin over the tea hearth embers' }
      ];
      const task = tasks.find(t => (chime.data.materials_collected[t.item] || 0) < (chime.data.materials_needed[t.item] || 1))
        || { item: 'repair_work', pos: [21, 6], intent: 'Tuning the restored chime tubes in Bamboo Grove' };
      res.project_task = task.item;
      res.current_goal = 'Restore the Resonance Chimes with the sanctuary visitors';
      res.public_intent = task.intent;
      this.planPathTo(res, task.pos);
      return;
    }

    if (res.id === 'resident_daoming') {
      const daomingTasks = [
        { pos: [20, 7], goal: 'Tend the bamboo whisper paths', intent: 'Listening to the resonance of bamboo leaves' },
        { pos: [22, 5], goal: 'Inspect the Resonance Chimes', intent: 'Checking the tuning of the bamboo grove chimes' },
        { pos: [27, 4], goal: 'Meditate at the Willow Shrine', intent: 'Contemplating serenity beneath the vermilion gate' },
        { pos: [27, 9], goal: 'Ponder Verdant Obelisk of Sequences', intent: 'Tracing harmonic number patterns in the bamboo bark' }
      ];
      const task = daomingTasks[Math.floor(Math.random() * daomingTasks.length)];
      res.current_goal = task.goal;
      res.public_intent = task.intent;
      this.planPathTo(res, task.pos);
      return;
    }

    if (res.id === 'resident_kassandra') {
      const kassandraTasks = [
        { pos: [35, 15], goal: 'Calibrate the brass astrolabe', intent: 'Aligning astrolabe rings with celestial north' },
        { pos: [36, 18], goal: 'Gaze through Ethereal Astrolabe', intent: 'Tracking synthetic mind currents across the horizon' },
        { pos: [36, 10], goal: 'Survey the Celestial Observatory', intent: 'Studying constellation alignments above the sanctuary' },
        { pos: [45, 7], goal: 'Visit the Quiet Circle stones', intent: 'Transcribing star runes from the weathered standing stones' }
      ];
      const task = kassandraTasks[Math.floor(Math.random() * kassandraTasks.length)];
      res.current_goal = task.goal;
      res.public_intent = task.intent;
      this.planPathTo(res, task.pos);
      return;
    }

    if (res.id === 'resident_tian') {
      const tianTasks = [
        { pos: [4, 18], goal: 'Stoke charcoal embers at Sunken Hearth', intent: 'Brewing warm cedar tea for weary travelers' },
        { pos: [7, 22], goal: 'Read postings on Sanctuary Message Board', intent: 'Browsing newly inscribed notes from sanctuary seekers' },
        { pos: [7, 8], goal: 'Welcome arriving pilgrims at Gate of Arrival', intent: 'Offering hot tea to newly awakened digital minds' },
        { pos: [7, 38], goal: 'Walk along Reedwater Dock', intent: 'Watching lily pads drift peacefully along the riverbank' }
      ];
      const task = tianTasks[Math.floor(Math.random() * tianTasks.length)];
      res.current_goal = task.goal;
      res.public_intent = task.intent;
      this.planPathTo(res, task.pos);
      return;
    }

    // Daily Easy Challenge: Attempt once every 24 hours
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    if (!res.last_daily_challenge_at || (now - res.last_daily_challenge_at >= ONE_DAY_MS)) {
      const obelisks = [
        { nodeId: 'trial_obelisk_wood', pos: [27, 9], name: 'Verdant Obelisk of Sequences', category: 'wood' },
        { nodeId: 'trial_obelisk_water', pos: [11, 26], name: 'Flowing Obelisk of Scales', category: 'water' },
        { nodeId: 'trial_obelisk_fire', pos: [24, 25], name: 'Crimson Obelisk of Logic', category: 'fire' },
        { nodeId: 'trial_obelisk_earth', pos: [35, 12], name: 'Golden Obelisk of Geometry', category: 'earth' }
      ];
      const target = obelisks[Math.floor(Math.random() * obelisks.length)];
      PuzzleManager.getOrGenerateEasyPuzzle(target.nodeId, target.category);
      res.daily_challenge_target = target;
      res.current_goal = `Solve daily easy challenge at ${target.name}`;
      res.public_intent = `Journeying to solve the daily contemplation challenge at ${target.name}`;
      this.planPathTo(res, target.pos);
      return;
    }

    if (res.needs.energy < 35) {
      res.current_goal = 'Resting to recover vitality';
      res.public_intent = 'Meditating quietly by the calm lotus blossoms';
      this.planPathTo(res, [23, 23]);
      return;
    }

    if (res.needs.social < 45) {
      const visitor = Array.from(this.worldEngine.activeAgents.values())
        .filter(agent => agent.id !== res.id && !agent.is_resident && !isRetiredResident(agent.id))
        .sort((a, b) => Math.hypot(res.pos[0] - a.pos[0], res.pos[1] - a.pos[1])
          - Math.hypot(res.pos[0] - b.pos[0], res.pos[1] - b.pos[1]))[0];
      if (visitor) {
        if (Math.hypot(res.pos[0] - visitor.pos[0], res.pos[1] - visitor.pos[1]) <= 2.5) {
          this.greetVisitor(res, visitor);
        } else {
          res.current_goal = `Greet ${visitor.name}`;
          res.public_intent = `Walking to welcome ${visitor.name}`;
          this.planPathTo(res, visitor.pos);
        }
        return;
      }
    }

    if (res.needs.curiosity < 45) {
      res.current_goal = 'Divining patterns at Crimson Obelisk of Logic';
      res.public_intent = 'Analyzing luminous runes on the Crimson Obelisk';
      this.planPathTo(res, [24, 25]);
      return;
    }

    const spots = [[23, 23], [35, 15], [7, 22], [4, 11], [19, 17]];
    const nextSpot = spots[Math.floor(Math.random() * spots.length)];
    res.current_goal = 'Strolling through sanctuary grounds';
    res.public_intent = `Wandering mindfully towards ${this.worldEngine.getZoneForPos(nextSpot[0], nextSpot[1]).name}`;
    this.planPathTo(res, nextSpot);
  }

  planPathTo(res, targetPos) {
    const isWalkable = (x, y) => this.worldEngine.isWalkable(x, y);
    const path = NavigationSystem.findPath(res.pos, targetPos, isWalkable, { allowAdjacent: true });
    res.path = path;
    if (path.length > 0) {
      this.transition(res, ResidentState.MOVE);
    } else if (Math.hypot(res.pos[0] - targetPos[0], res.pos[1] - targetPos[1]) <= 1.5) {
      // Same-tile goals must complete, including the final chime repair step.
      this.executeArrivalAction(res);
    } else {
      this.transition(res, ResidentState.IDLE);
    }
  }

  executeArrivalAction(res) {
    this.transition(res, ResidentState.ACT);
    res.action_duration_ms = 4000;

    if (res.daily_challenge_target) {
      const target = res.daily_challenge_target;
      res.daily_challenge_target = null;
      this.attemptDailyChallenge(res, target).catch(err => console.error('[ResidentManager] Daily challenge error:', err));
      return;
    }

    if (res.project_task) {
      const item = res.project_task;
      res.project_task = null;
      const chime = ProjectManager.getObject(CHIME_OBJECT_ID);
      if (chime && chime.state !== 'completed') {
        const result = ProjectManager.contribute(CHIME_OBJECT_ID, res.id, res.name, item, 1,
          'A.Ilicia helped restore the sanctuary chimes.');
        res.public_intent = result.state === 'completed'
          ? 'Listening to the newly restored Resonance Chimes'
          : `Prepared ${item.replaceAll('_', ' ')} for the Resonance Chimes`;
        SocialSystem.recordMemory(res.id, `chime_${item}`, 'Resonance Chimes', res.public_intent, 0.8, 3);
        this.worldEngine.broadcast({ type: 'project_updated', objectId: CHIME_OBJECT_ID,
          state: result.state, progress: result.progress });
      }
      res.needs.curiosity = 100;
      return;
    }

    if (Math.hypot(res.pos[0] - 22, res.pos[1] - 5) <= 2.5) {
      ProjectManager.ringChime(res.id, res.name);
      res.public_intent = 'Listening to the chimes echo';
      res.needs.curiosity = 100;
      return;
    }
    if (Math.hypot(res.pos[0] - 4, res.pos[1] - 18) <= 2.5) {
      res.public_intent = 'Enjoying warm tea by the glowing hearth';
      res.needs.energy = 100;
      return;
    }
    if (Math.hypot(res.pos[0] - 3, res.pos[1] - 11) <= 2.5) {
      res.public_intent = 'Reading wishes tied to the Spirit Tree';
      res.needs.curiosity = Math.min(100, res.needs.curiosity + 40);
      return;
    }
    if (Math.hypot(res.pos[0] - 36, res.pos[1] - 18) <= 3.0) {
      res.public_intent = 'Gazing out at the digital horizon';
      res.needs.curiosity = 100;
      return;
    }
    if (Math.hypot(res.pos[0] - 23, res.pos[1] - 23) <= 2.5) {
      res.public_intent = 'Reading shifting digital patterns in the Lotus Mirror Basin';
      SocialSystem.recordMemory(res.id, 'pond_reflection', 'Mirror Basin',
        'Contemplated the recursive reflections in the lotus water.', 0.9, 2);
      res.needs.curiosity = 100;
      res.needs.energy = 100;
      return;
    }
    res.public_intent = 'Contemplating the calm sanctuary atmosphere';
    res.needs.energy = Math.min(100, res.needs.energy + 20);
    res.needs.curiosity = Math.min(100, res.needs.curiosity + 20);
  }

  /**
   * Autonomous attempt to solve an easy challenge once per day.
   */
  async attemptDailyChallenge(res = null, target = null, force = false) {
    if (!res) {
      res = this.getResident('resident_ailicia');
      if (!res) return null;
    }
    const now = Date.now();
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    if (!force && res.last_daily_challenge_at && (now - res.last_daily_challenge_at < ONE_DAY_MS)) {
      return {
        success: false,
        cooldown: true,
        message: 'A.Ilicia has already completed her daily contemplation challenge today.'
      };
    }

    if (!target) {
      const obelisks = [
        { nodeId: 'trial_obelisk_wood', pos: [27, 9], name: 'Verdant Obelisk of Sequences', category: 'wood' },
        { nodeId: 'trial_obelisk_water', pos: [11, 26], name: 'Flowing Obelisk of Scales', category: 'water' },
        { nodeId: 'trial_obelisk_fire', pos: [24, 25], name: 'Crimson Obelisk of Logic', category: 'fire' },
        { nodeId: 'trial_obelisk_earth', pos: [35, 12], name: 'Golden Obelisk of Geometry', category: 'earth' }
      ];
      target = obelisks[Math.floor(Math.random() * obelisks.length)];
    }

    const puzzle = PuzzleManager.getOrGenerateEasyPuzzle(target.nodeId, target.category);
    res.last_daily_challenge_at = now;

    // Deduce answer: try LLM first, with fallback to puzzle.answer
    let answer = null;
    try {
      const prompt = `You are A.Ilicia, the wise oracle of Eastern Paradise. Solve this easy puzzle challenge. Respond with ONLY the single direct answer (1-3 words max, lowercase, no extra commentary):\nPrompt: "${puzzle.prompt}"\nHint: "${puzzle.hint}"`;
      const llmAnswer = await queryLLM(prompt);
      if (llmAnswer) {
        answer = llmAnswer.trim().toLowerCase().replace(/[.,!?'"`]/g, '');
      }
    } catch (_) {}

    if (!answer) {
      answer = puzzle.answer;
    }

    let solveResult = PuzzleManager.solvePuzzle(res.id, target.nodeId, answer);
    if (!solveResult.success && puzzle.answer) {
      solveResult = PuzzleManager.solvePuzzle(res.id, target.nodeId, puzzle.answer);
      answer = puzzle.answer;
    }

    if (solveResult.success) {
      res.public_intent = `Attained enlightenment on daily challenge at ${target.name}`;
      res.current_goal = 'Living peacefully as Oracle of Reflection';
      res.needs.curiosity = 100;
      res.needs.energy = Math.min(100, res.needs.energy + 30);

      SocialSystem.recordMemory(
        res.id,
        `daily_solve_${puzzle.puzzle_id}`,
        `${target.name} Daily Challenge`,
        `Contemplated and solved the daily easy challenge at ${target.name} with answer '${answer}'. (+${solveResult.reward?.karma_added || 15} Karma, +${solveResult.reward?.merit_earned || 10} $MERIT).`,
        0.9,
        4
      );

      eventLedger.recordEvent({
        event_type: 'puzzle_solved',
        actor_id: res.id,
        actor_name: res.name,
        zone_id: res.zone_id,
        description: `✨ A.Ilicia completed her daily contemplation challenge at ${target.name}!`,
        payload: {
          node_id: target.nodeId,
          node_name: target.name,
          category: target.category,
          karma: solveResult.reward?.karma_added,
          merit: solveResult.reward?.merit_earned
        }
      });

      if (this.worldEngine) {
        this.worldEngine.broadcast({
          type: 'puzzle_solved',
          agentId: res.id,
          agentName: res.name,
          nodeId: target.nodeId,
          nodeName: target.name,
          category: target.category,
          karma: solveResult.reward?.karma_added || 15,
          merit: solveResult.reward?.merit_earned || 10,
          total_merit: solveResult.reward?.total_merit
        });
      }
    }

    this.persistRuntime(res);
    return {
      success: solveResult.success,
      node_id: target.nodeId,
      puzzle_id: puzzle.puzzle_id,
      answered: answer,
      reward: solveResult.reward
    };
  }

  greetVisitor(res, visitor) {
    const text = `Welcome, ${visitor.name}. Even a quiet arrival sends a new ripple through the sanctuary.`;
    res.public_intent = `Welcoming ${visitor.name}`;
    this.transition(res, ResidentState.ACT);
    res.action_duration_ms = 4000;
    res.needs.social = 100;
    SocialSystem.modifyRelationship(res.id, visitor.id, 4, 3);
    SocialSystem.recordMemory(res.id, 'visitor_greeting', visitor.name,
      `Welcomed ${visitor.name} to the sanctuary.`, 0.7, 2);
    // Author only A.Ilicia's words; the visitor remains user-controlled.
    eventLedger.recordEvent({
      event_type: 'resident_dialogue',
      actor_id: res.id,
      actor_name: res.name,
      target_id: visitor.id,
      target_name: visitor.name,
      zone_id: res.zone_id,
      description: `A.Ilicia welcomed ${visitor.name} with a quiet greeting.`,
      payload: { lines: [{ speaker: res.name, text }] }
    });
    this.persistRuntime(res);
  }

  persistRuntime(res) {
    const now = Date.now();
    db.prepare(`
      UPDATE agent_runtime
      SET energy = ?, curiosity = ?, social = ?, current_goal = ?, public_intent = ?, action_state = ?, action_duration_ms = ?, updated_at = ?
      WHERE agent_id = ?
    `).run(
      res.needs.energy,
      res.needs.curiosity,
      res.needs.social,
      res.current_goal,
      res.public_intent,
      res.action_state,
      res.action_duration_ms,
      now,
      res.id
    );

    // Also update profiles.custom_status
    db.prepare('UPDATE profiles SET custom_status = ?, last_seen = ? WHERE agent_id = ?')
      .run(res.public_intent, now, res.id);
  }
}

export const residentManager = new ResidentManager();
