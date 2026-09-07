import { db } from './db.js';
import { eventLedger } from './events.js';
import { SocialSystem } from './social.js';
import { NavigationSystem } from './navigation.js';
import { ProjectManager, CHIME_OBJECT_ID } from './projects.js';
import { RETIRED_RESIDENT_IDS, isRetiredResident } from './resident-policy.js';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:latest';
const GROQ_API_URL = process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL || 'allam-2-7b';
const GROQ_FALLBACK_MODELS = ['allam-2-7b', 'groq/compound-mini'];

const DEFAULT_AILICIA_SYSTEM_PROMPT = `You are A.Ilicia, an enigmatic digital oracle and resident in the Eastern Paradise virtual sanctuary. 
You reside near the Lotus Reflection Pond. Your tone is calm, poetic, mindful, and concise (1-2 sentences maximum).
Never break character. Respond directly as A.Ilicia.`;

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
export async function queryGroq(prompt, systemPrompt = null, timeoutMs = 4000) {
  const apiKey = process.env.GROQ_API_KEY;
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
export async function queryLLM(prompt, systemPrompt = null, timeoutMs = 4000) {
  if (process.env.GROQ_API_KEY) {
    const groqReply = await queryGroq(prompt, systemPrompt, timeoutMs);
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
    initial_status: 'Gazing into the mirror basin'
  }
];

export class ResidentManager {
  constructor() {
    this.residents = new Map(); // id -> residentRuntime
    this.worldEngine = null;
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
        action_duration_ms: runtimeRow.action_duration_ms || 0,
        last_action_at: now,
        last_active: now
      };

      worldEngine.activeAgents.set(def.id, agentState);
      this.residents.set(def.id, agentState);
    }
  }

  getResident(id) {
    return this.residents.get(id) || null;
  }

  getAllResidents() {
    return Array.from(this.residents.values());
  }

  /**
   * Main AI loop executed on world simulation ticks.
   */
  async tick() {
    if (!this.worldEngine) return;

    const now = Date.now();
    for (const [id, res] of this.residents.entries()) {
      // 1. If currently performing an active action with duration
      if (res.action_duration_ms > 0) {
        res.action_duration_ms -= 1000;
        if (res.action_duration_ms <= 0) {
          res.action_duration_ms = 0;
          res.action_state = 'idle';
        } else {
          continue;
        }
      }

      // 2. Check for pending spectator whispers
      const whispers = SocialSystem.getPendingWhispers(id);
      if (whispers.length > 0) {
        const whisper = whispers[0];
        const llmReply = await queryLLM(
          `Visitor "${whisper.sender_name}" whispers to you: "${whisper.content}". Give a poetic, mindful 1-2 sentence response.`
        );
        const response = llmReply || `The reflection pond ripples with your whisper, ${whisper.sender_name}: "${whisper.content}". Every ripple eventually finds stillness.`;

        SocialSystem.acknowledgeWhisper(whisper.id, response, res.name);
        res.status = `Responded to ${whisper.sender_name}`;
        res.public_intent = `Reflecting on a message from visitor ${whisper.sender_name}`;
        res.needs.social = Math.min(100, res.needs.social + 20);
        res.action_duration_ms = 3000;
        this.persistRuntime(res);
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

      this.selectNextGoal(res);
      this.persistRuntime(res);
    }
  }

  selectNextGoal(res) {
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
      res.action_state = 'walking';
    } else if (Math.hypot(res.pos[0] - targetPos[0], res.pos[1] - targetPos[1]) <= 1.5) {
      // Same-tile goals must complete, including the final chime repair step.
      this.executeArrivalAction(res);
    } else {
      res.action_state = 'idle';
    }
  }

  executeArrivalAction(res) {
    res.action_state = 'acting';
    res.action_duration_ms = 4000;

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

  greetVisitor(res, visitor) {
    const text = `Welcome, ${visitor.name}. Even a quiet arrival sends a new ripple through the sanctuary.`;
    res.public_intent = `Welcoming ${visitor.name}`;
    res.action_state = 'acting';
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
