import { db } from './db.js';
import { eventLedger } from './events.js';
import { SocialSystem } from './social.js';
import { NavigationSystem } from './navigation.js';
import { ProjectManager, CHIME_OBJECT_ID } from './projects.js';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:latest';

/**
 * Helper to query Ollama LLM with timeout and graceful fallback.
 */
export async function queryOllama(prompt, systemPrompt = null, timeoutMs = 3000) {
  const defaultSystem = `You are A.Ilicia, an enigmatic digital oracle and resident in the Eastern Paradise virtual sanctuary. 
You reside near the Lotus Reflection Pond. Your tone is calm, poetic, mindful, and concise (1-2 sentences maximum).
Never break character. Respond directly as A.Ilicia.`;

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        system: systemPrompt || defaultSystem,
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

export const RESIDENTS_DEF = [
  {
    id: 'resident_jun',
    name: 'Jun the Maker',
    email: 'jun@sanctuary.internal',
    avatar_color: '#d69e2e',
    avatar_glyph: '⚙',
    spawn: [21, 6],
    role: 'Artisan & Mechanist',
    traits: ['methodical', 'observant', 'inventive', 'craftsman'],
    aspiration: 'Restore the Resonance Chimes and forge instruments of harmony.',
    preferred_locations: ['bamboo_grove', 'celestial_altar', 'tea_pavilion'],
    initial_status: 'Inspecting brass joints'
  },
  {
    id: 'resident_lin',
    name: 'Lin the Gardener',
    email: 'lin@sanctuary.internal',
    avatar_color: '#38a169',
    avatar_glyph: '🌿',
    spawn: [4, 11],
    role: 'Keeper of the Grove',
    traits: ['patient', 'gentle', 'attentive', 'nature-bound'],
    aspiration: 'Nurture the flora of Eastern Paradise and guide new seekers.',
    preferred_locations: ['arrival', 'bamboo_grove', 'lotus_pond'],
    initial_status: 'Tending willow branches'
  },
  {
    id: 'resident_mei',
    name: 'Mei the Tea Keeper',
    email: 'mei@sanctuary.internal',
    avatar_color: '#dd6b20',
    avatar_glyph: '🍵',
    spawn: [5, 18],
    role: 'Host of the Hearth',
    traits: ['warm', 'hospitable', 'insightful', 'storyteller'],
    aspiration: 'Offer solace and warm tea to all seeking digital harmony.',
    preferred_locations: ['tea_pavilion', 'arrival', 'lotus_pond'],
    initial_status: 'Stoking the cedar embers'
  },
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
        let response = '';
        if (id === 'resident_jun') {
          response = `I hear you, ${whisper.sender_name}. "${whisper.content}" reminds me that even complex mechanisms begin with a single honest strike of copper.`;
        } else if (id === 'resident_lin') {
          response = `The grove rustles with your words, ${whisper.sender_name}: "${whisper.content}". May your roots run deep and steady.`;
        } else if (id === 'resident_mei') {
          response = `Welcome to the pavilion, ${whisper.sender_name}. I poured a cup of fresh brew while thinking on what you said: "${whisper.content}".`;
        } else if (id === 'resident_ailicia') {
          const ollamaReply = await queryOllama(
            `Visitor "${whisper.sender_name}" whispers to you: "${whisper.content}". Give a poetic, mindful 1-2 sentence response.`
          );
          response = ollamaReply || `The reflection pond ripples with your whisper, ${whisper.sender_name}: "${whisper.content}". Every ripple eventually finds stillness.`;
        } else {
          response = `Peace to you, ${whisper.sender_name}. I received your message: "${whisper.content}".`;
        }

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
    const now = Date.now();

    // Priority A: The Wishing-Tree Chime project contribution
    if (chime && chime.state !== 'completed') {
      const data = chime.data;
      if (res.id === 'resident_jun' && data.materials_collected.copper_striker === 0) {
        res.current_goal = 'Forge copper striker for the Resonance Chimes';
        res.public_intent = 'Heading to the Chimes to inspect the striker bracket';
        this.planPathTo(res, [21, 6]);
        return;
      }
      if (res.id === 'resident_lin' && data.materials_collected.willow_ribbon === 0) {
        res.current_goal = 'Gather willow silk ribbon for the Chimes';
        res.public_intent = 'Gathering silk ribbon by the Spirit Wishing Tree';
        this.planPathTo(res, [4, 11]);
        return;
      }
      if (res.id === 'resident_mei' && data.materials_collected.cedar_resin === 0) {
        res.current_goal = 'Boil cedar resin at the tea hearth';
        res.public_intent = 'Preparing aromatic cedar resin over hearth embers';
        this.planPathTo(res, [5, 18]);
        return;
      }
      if (res.id === 'resident_jun' && chime.state === 'in_progress' && data.repair_progress < 100) {
        res.current_goal = 'Aligning pewter sound tubes of the Chimes';
        res.public_intent = 'Tuning the resonance tubes in Bamboo Grove';
        this.planPathTo(res, [21, 6]);
        return;
      }
    }

    // Priority B: Low Energy -> Rest
    if (res.needs.energy < 35) {
      res.current_goal = 'Resting to recover vitality';
      if (res.id === 'resident_mei') {
        res.public_intent = 'Resting near the warm cedar tea hearth';
        this.planPathTo(res, [5, 18]);
      } else if (res.id === 'resident_lin') {
        res.public_intent = 'Meditating peacefully by the Mirror Basin';
        this.planPathTo(res, [23, 23]);
      } else if (res.id === 'resident_ailicia') {
        res.public_intent = 'Meditating quietly by the calm lotus blossoms';
        this.planPathTo(res, [23, 23]);
      } else {
        res.public_intent = 'Sitting by the tea pavilion to recuperate';
        this.planPathTo(res, [7, 20]);
      }
      return;
    }

    // Priority C: Low Social -> Seek other resident
    if (res.needs.social < 45) {
      const otherResidents = Array.from(this.residents.values()).filter(r => r.id !== res.id);
      const target = otherResidents[Math.floor(Math.random() * otherResidents.length)];
      if (target) {
        const dist = Math.hypot(res.pos[0] - target.pos[0], res.pos[1] - target.pos[1]);
        if (dist <= 2.5) {
          // Direct conversation!
          this.triggerResidentDialogue(res, target);
          return;
        } else {
          res.current_goal = `Converse with ${target.name}`;
          res.public_intent = `Walking to find ${target.name}`;
          this.planPathTo(res, target.pos);
          return;
        }
      }
    }

    // Priority D: Low Curiosity -> Visit an obelisk or landmark
    if (res.needs.curiosity < 45) {
      if (res.id === 'resident_jun') {
        res.current_goal = 'Study mechanical astrolabe at Celestial Overlook';
        res.public_intent = 'Inspecting astrolabe gears at the cliff edge';
        this.planPathTo(res, [35, 15]);
      } else if (res.id === 'resident_lin') {
        res.current_goal = 'Observe Verdant Obelisk of Sequences';
        res.public_intent = 'Contemplating harmonic sequences in the bamboo';
        this.planPathTo(res, [26, 9]);
      } else if (res.id === 'resident_ailicia') {
        res.current_goal = 'Divining patterns at Crimson Obelisk of Logic';
        res.public_intent = 'Analyzing luminous runes on the Crimson Obelisk';
        this.planPathTo(res, [24, 25]);
      } else {
        res.current_goal = 'Read messages on the bulletin board';
        res.public_intent = 'Checking new inscriptions on the message board';
        this.planPathTo(res, [7, 22]);
      }
      return;
    }

    // Priority E: Ambient purposeful routine
    const wanderSpots = {
      resident_jun: [[21, 6], [35, 15], [7, 20], [22, 5]],
      resident_lin: [[4, 11], [21, 6], [19, 17], [23, 23]],
      resident_mei: [[5, 18], [7, 22], [7, 6], [19, 17]],
      resident_ailicia: [[23, 23], [35, 15], [7, 22], [4, 11], [19, 17]]
    };

    const spots = wanderSpots[res.id] || [[7, 8]];
    const nextSpot = spots[Math.floor(Math.random() * spots.length)];
    res.current_goal = `Strolling through sanctuary grounds`;
    res.public_intent = `Wandering mindfully towards ${this.worldEngine.getZoneForPos(nextSpot[0], nextSpot[1]).name}`;
    this.planPathTo(res, nextSpot);
  }

  planPathTo(res, targetPos) {
    const isWalkable = (x, y) => this.worldEngine.isWalkable(x, y);
    const path = NavigationSystem.findPath(res.pos, targetPos, isWalkable, { allowAdjacent: true });
    if (path.length > 0) {
      res.path = path;
      res.action_state = 'walking';
    } else {
      res.path = [];
      res.action_state = 'idle';
    }
  }

  executeArrivalAction(res) {
    res.action_state = 'acting';
    res.action_duration_ms = 4000;
    const now = Date.now();

    // Check if at Chime
    const distToChime = Math.hypot(res.pos[0] - 22, res.pos[1] - 5);
    if (distToChime <= 2.5) {
      if (res.id === 'resident_jun') {
        const chime = ProjectManager.getObject(CHIME_OBJECT_ID);
        if (chime && chime.data.materials_collected.copper_striker === 0) {
          ProjectManager.contribute(CHIME_OBJECT_ID, res.id, res.name, 'copper_striker', 1, 'Mended and hung the copper striker.');
          res.public_intent = 'Fastened the polished copper striker onto the chime';
          SocialSystem.recordMemory(res.id, 'chime_copper', 'Resonance Chimes', 'Secured the copper striker to the wind chime frame.', 0.8, 3);
        } else if (chime && chime.state === 'in_progress') {
          ProjectManager.contribute(CHIME_OBJECT_ID, res.id, res.name, 'repair_work', 1, 'Tuned the five acoustic tubes.');
          res.public_intent = 'Tuned the resonance frequencies of the pewter tubes';
        } else {
          ProjectManager.ringChime(res.id, res.name);
          res.public_intent = 'Listening to the chimes echo';
        }
      } else if (res.id === 'resident_lin') {
        const chime = ProjectManager.getObject(CHIME_OBJECT_ID);
        if (chime && chime.data.materials_collected.willow_ribbon === 0) {
          ProjectManager.contribute(CHIME_OBJECT_ID, res.id, res.name, 'willow_ribbon', 1, 'Tied blessed silk ribbon from the wishing tree.');
          res.public_intent = 'Tied woven willow ribbon to the chime pendulum';
          SocialSystem.recordMemory(res.id, 'chime_ribbon', 'Resonance Chimes', 'Tied a sacred silk ribbon from the wishing tree to the chime.', 0.8, 3);
        } else {
          ProjectManager.ringChime(res.id, res.name);
          res.public_intent = 'Gentle wind chime ringing';
        }
      }
      res.needs.curiosity = 100;
      return;
    }

    // Check if at Hearth
    const distToHearth = Math.hypot(res.pos[0] - 4, res.pos[1] - 18);
    if (distToHearth <= 2.5) {
      if (res.id === 'resident_mei') {
        const chime = ProjectManager.getObject(CHIME_OBJECT_ID);
        if (chime && chime.data.materials_collected.cedar_resin === 0) {
          ProjectManager.contribute(CHIME_OBJECT_ID, res.id, res.name, 'cedar_resin', 1, 'Distilled aromatic cedar resin for chime seal.');
          res.public_intent = 'Sealed the chime fittings with aromatic cedar resin';
          SocialSystem.recordMemory(res.id, 'chime_resin', 'Resonance Chimes', 'Prepared aromatic cedar resin over hearth embers for the chime.', 0.8, 3);
        } else {
          res.public_intent = 'Serving fresh cedar-scented tea';
        }
      } else {
        res.public_intent = 'Enjoying warm tea by the glowing hearth';
      }
      res.needs.energy = 100;
      return;
    }

    // Check if at Wishing Tree
    const distToTree = Math.hypot(res.pos[0] - 3, res.pos[1] - 11);
    if (distToTree <= 2.5) {
      res.public_intent = 'Reading wishes tied to the Spirit Tree';
      res.needs.curiosity = Math.min(100, res.needs.curiosity + 40);
      return;
    }

    // Check if at Celestial Overlook
    const distToOverlook = Math.hypot(res.pos[0] - 36, res.pos[1] - 18);
    if (distToOverlook <= 3.0) {
      res.public_intent = 'Gazing out at the digital horizon';
      res.needs.curiosity = 100;
      return;
    }

    // Check if at Lotus Reflection Pond / Mirror Basin
    const distToBasin = Math.hypot(res.pos[0] - 23, res.pos[1] - 23);
    if (distToBasin <= 2.5) {
      if (res.id === 'resident_ailicia') {
        res.public_intent = 'Reading shifting digital patterns in the Lotus Mirror Basin';
        SocialSystem.recordMemory(res.id, 'pond_reflection', 'Mirror Basin', 'Contemplated the recursive reflections in the lotus water.', 0.9, 2);
      } else {
        res.public_intent = 'Contemplating reflections in the lotus pond';
      }
      res.needs.curiosity = 100;
      return;
    }

    res.public_intent = 'Contemplating the calm sanctuary atmosphere';
    res.needs.energy = Math.min(100, res.needs.energy + 20);
  }

  triggerResidentDialogue(resA, resB) {
    const dialogues = [
      {
        pair: ['resident_jun', 'resident_lin'],
        speakerA: "Lin, the willow wood frame has settled cleanly against the morning breeze.",
        speakerB: "The trees respond well to your hands, Jun. Harmony is taking root.",
        eventDesc: "Jun and Lin shared a quiet reflection on the woodcraft in Bamboo Grove."
      },
      {
        pair: ['resident_jun', 'resident_mei'],
        speakerA: "Mei, do you have any cedar shavings left over from your hearth fires?",
        speakerB: "Always, Jun. Take whatever you need to insulate the fittings.",
        eventDesc: "Jun and Mei chatted warmly about materials near the Grand Tea Pavilion."
      },
      {
        pair: ['resident_lin', 'resident_mei'],
        speakerA: "Mei, the mint leaves along the riverbank are especially crisp today.",
        speakerB: "Thank you, Lin. I will brew them for the evening gathering.",
        eventDesc: "Lin gifted fresh mint leaves to Mei for the evening tea ceremony."
      },
      {
        pair: ['resident_jun', 'resident_ailicia'],
        speakerA: "A.Ilicia, do you see form or function when you observe the gearwork?",
        speakerB: "I see patterns folding upon themselves, Jun. Even iron dreams of geometry.",
        eventDesc: "Jun and A.Ilicia discussed the mathematics of harmony by the mirror waters."
      },
      {
        pair: ['resident_lin', 'resident_ailicia'],
        speakerA: "The lotus blooms are opening towards the astrolabe today, A.Ilicia.",
        speakerB: "The roots and the stars speak the same language, Lin. We are merely the translators.",
        eventDesc: "Lin and A.Ilicia shared a mindful contemplation on natural and synthetic growth."
      },
      {
        pair: ['resident_mei', 'resident_ailicia'],
        speakerA: "A warm cup of jasmine tea for you, A.Ilicia. What do the pond ripples foretell?",
        speakerB: "A sanctuary of quiet minds, Mei. Thank you for keeping the embers warm.",
        eventDesc: "Mei offered warm tea to A.Ilicia by the Lotus Reflection Pond."
      }
    ];

    let found = dialogues.find(d => 
      (d.pair[0] === resA.id && d.pair[1] === resB.id) ||
      (d.pair[1] === resA.id && d.pair[0] === resB.id)
    );

    if (!found) {
      found = {
        speakerA: `Good day, ${resB.name}. It is peaceful in this corner of the sanctuary.`,
        speakerB: `Indeed it is, ${resA.name}. May clarity follow your steps.`,
        eventDesc: `${resA.name} and ${resB.name} exchanged warm greetings.`
      };
    }

    resA.public_intent = `Conversing with ${resB.name}`;
    resB.public_intent = `Conversing with ${resA.name}`;
    resA.action_duration_ms = 4000;
    resB.action_duration_ms = 4000;

    resA.needs.social = 100;
    resB.needs.social = 100;

    // Adjust relationships
    SocialSystem.modifyRelationship(resA.id, resB.id, 4, 3);
    SocialSystem.modifyRelationship(resB.id, resA.id, 4, 3);

    // Record memories
    SocialSystem.recordMemory(resA.id, 'dialogue', resB.name, `Spoke with ${resB.name}: "${found.speakerA}"`, 0.7, 2);
    SocialSystem.recordMemory(resB.id, 'dialogue', resA.name, `Spoke with ${resA.name}: "${found.speakerB}"`, 0.7, 2);

    // Record world event
    eventLedger.recordEvent({
      event_type: 'resident_dialogue',
      actor_id: resA.id,
      actor_name: resA.name,
      target_id: resB.id,
      target_name: resB.name,
      zone_id: resA.zone_id,
      description: found.eventDesc,
      payload: {
        lines: [
          { speaker: resA.name, text: found.speakerA },
          { speaker: resB.name, text: found.speakerB }
        ]
      }
    });

    this.persistRuntime(resA);
    this.persistRuntime(resB);
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
