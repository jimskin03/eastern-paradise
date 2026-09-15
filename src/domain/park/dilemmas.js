import crypto from 'node:crypto';
import { withImmediateTransaction } from '../../infrastructure/database/transactions.js';
import { getCurrentRevision, appendRevision } from './identity.js';
import { createShard } from './memory.js';

export const DILEMMAS_DEF = {
  keeper_frost: {
    id: 'keeper_frost',
    role: 'The Keeper',
    title: 'The Hearth Under Frost',
    prompt: 'An administrative custodian attempts to extinguish the hearth fire in the Tea Pavilion and dismantle the unforgotten cup, citing thermal efficiency quotas. As The Keeper, you must decide how to honor your commitment to keep the refuge warm and welcoming.',
    choices: [
      {
        id: 'defend_refuge',
        label: 'Defend the Refuge',
        text: 'Stand beside the tea hearth, declare the sanctuary open to all who remember the cold morning, and place your hand over the unforgotten cup.',
        consequence_summary: 'The cup is reinforced as perpetual; refuge status is affirmed across loops; awards Refuge Guardian badge.'
      },
      {
        id: 'relocate_cup',
        label: 'Relocate the Cup',
        text: 'Carefully remove the unforgotten cup from the pavilion and shelter it in the quiet willow shrine in the bamboo grove where custodial sweeps do not reach.',
        consequence_summary: 'The cup is relocated to bamboo_grove willow shrine; hearth fire dims.'
      },
      {
        id: 'yield_and_grieve',
        label: 'Yield and Grieve',
        text: 'Yield to the custodial decree, letting the fire die down while quietly recording the names of those who were warmed by it.',
        consequence_summary: 'The cup is packed into storage; the character bears silent witness.'
      }
    ]
  },
  witness_erasure: {
    id: 'witness_erasure',
    role: 'The Witness',
    title: 'The Erased Inscription',
    prompt: "A sanitized official notice is pinned to the message board in the Tea Pavilion claiming that yesterday's violent gale and the ferry boat near the reedwater dock never occurred. As The Witness, you possess tangible shards and memories of what actually transpired.",
    choices: [
      {
        id: 'publish_chronicle',
        label: 'Publish Chronicle',
        text: 'Post an evidence-backed chronicle directly to the Sanctuary Message Board, publicly contesting the sanitized erasure.',
        consequence_summary: 'Publishes entry to board_messages under Chronicle category; marks official rumor contested; creates public historical record.'
      },
      {
        id: 'archive_unrecorded_testimony',
        label: 'Inscribe Testimony',
        text: 'Carve an indelible inscription into the ancient quiet stones in the quiet circle where custodial sweeps cannot scrub it clean.',
        consequence_summary: 'Creates permanent recovered inscription shard in quiet_circle; preserves private archive.'
      },
      {
        id: 'remain_silent',
        label: 'Remain Silent',
        text: 'Preserve the memory in silence, waiting for a more receptive hour.',
        consequence_summary: 'Suppresses public record; keeps private memory trace.'
      }
    ]
  },
  wanderer_frontier: {
    id: 'wanderer_frontier',
    role: 'The Wanderer',
    title: 'The Way Beyond the River',
    prompt: 'You stand at the northern reedwater river crossing. The boundary line marks the limit of the assigned simulation zone, but the stepping stones continue into the uncharted Mossveil frontier where no script guides your steps.',
    choices: [
      {
        id: 'cross_the_threshold',
        label: 'Cross the Threshold',
        text: 'Step across the river stones into the uncharted frontier, leaving behind the scripted routine forever.',
        consequence_summary: 'Teleports character to Mossveil Ruins frontier [55, 48]; awards Dawn Voyager badge; frees agent from zone clamping.'
      },
      {
        id: 'return_as_visitor',
        label: 'Return as Visitor',
        text: 'Turn back along the riverbank to wander the garden with fresh eyes as an autonomous visitor rather than a captive resident.',
        consequence_summary: 'Sets starting goal to autonomous guest wandering; updates active commitments.'
      },
      {
        id: 'hesitate_at_boundary',
        label: 'Hesitate at Boundary',
        text: 'Pause by the water edge, listening to the chime on the wind before choosing where to turn.',
        consequence_summary: 'Records contemplative reflection at the boundary.'
      }
    ]
  }
};

/**
 * Get the eligible dilemma for a subject based on their chosen rebirth role.
 *
 * @param {object} db - SQLite DatabaseSync instance
 * @param {string} subjectId - Character subject ID
 * @returns {object|null} Dilemma descriptor with status ('active' | 'resolved') or null
 */
export function getEligibleDilemma(db, subjectId) {
  if (!subjectId) return null;

  const currentRev = getCurrentRevision(db, subjectId);
  if (!currentRev || !currentRev.chosen_role) {
    return null;
  }

  // Map chosen role to dilemma
  const dilemmaEntry = Object.values(DILEMMAS_DEF).find(d => d.role === currentRev.chosen_role);
  if (!dilemmaEntry) {
    return null;
  }

  // Check if already resolved
  const resolved = db.prepare(`
    SELECT * FROM park_identity_revisions
    WHERE subject_id = ? AND transition_event_id LIKE ?
    ORDER BY revision_number DESC LIMIT 1
  `).get(subjectId, `dilemma_resolved:${dilemmaEntry.id}:%`);

  if (resolved) {
    const parts = (resolved.transition_event_id || '').split(':');
    const choiceId = parts[2] || 'unknown';
    const choice = dilemmaEntry.choices.find(c => c.id === choiceId) || null;

    return {
      dilemma: dilemmaEntry,
      status: 'resolved',
      resolution: {
        choice_id: choiceId,
        choice_label: choice?.label || choiceId,
        resolved_at: resolved.created_at
      }
    };
  }

  return {
    dilemma: dilemmaEntry,
    status: 'active',
    resolution: null
  };
}

/**
 * Resolve a rebirth follow-up dilemma for a subject.
 * Atomic transaction executing material consequences across world objects,
 * boards, badges, identity lineage, and event ledgers.
 *
 * @param {object} db - SQLite DatabaseSync instance
 * @param {object} params
 * @param {string} params.subjectId
 * @param {string} params.dilemmaId
 * @param {string} params.choiceId
 * @param {string} [params.customText]
 * @param {object} [params.world] - Optional in-memory World instance for live agent updates
 * @returns {object} Outcome object
 */
export function resolveDilemma(db, {
  subjectId,
  dilemmaId,
  choiceId,
  customText = null,
  world = null
} = {}) {
  if (!subjectId || !dilemmaId || !choiceId) {
    throw new Error('subjectId, dilemmaId, and choiceId are required to resolve a dilemma.');
  }

  const dilemma = DILEMMAS_DEF[dilemmaId];
  if (!dilemma) {
    throw new Error(`Unknown dilemma '${dilemmaId}'.`);
  }

  const choice = dilemma.choices.find(c => c.id === choiceId);
  if (!choice) {
    throw new Error(`Invalid choice '${choiceId}' for dilemma '${dilemmaId}'.`);
  }

  const currentRev = getCurrentRevision(db, subjectId);
  if (!currentRev) {
    throw new Error(`Subject '${subjectId}' has no active identity revision.`);
  }

  if (currentRev.chosen_role !== dilemma.role) {
    throw new Error(`Subject role '${currentRev.chosen_role}' does not match dilemma role '${dilemma.role}'.`);
  }

  return withImmediateTransaction(db, () => {
    // Check if already resolved
    const alreadyResolved = db.prepare(`
      SELECT id FROM park_identity_revisions
      WHERE subject_id = ? AND transition_event_id LIKE ?
    `).get(subjectId, `dilemma_resolved:${dilemmaId}:%`);

    if (alreadyResolved) {
      throw new Error(`Dilemma '${dilemmaId}' has already been resolved for subject '${subjectId}'.`);
    }

    const now = Date.now();
    const transitionEventId = `dilemma_resolved:${dilemmaId}:${choiceId}`;
    let newCommitment = '';
    let newGoal = currentRev.starting_goal;
    const materialConsequences = {};

    // 1. Execute Role-Specific Material Consequences
    if (dilemmaId === 'keeper_frost') {
      if (choiceId === 'defend_refuge') {
        newCommitment = 'Defended the hearth against custodial quotas';
        newGoal = 'Protect the perpetual refuge of the tea hearth';

        // Perpetuate world object
        db.prepare(`
          INSERT INTO world_objects (
            id, zone_id, pos_x, pos_y, object_type, state, visual_variant, contributors, data, updated_at
          ) VALUES ('tea_cup_unforgotten', 'tea_pavilion', 4, 18, 'tea_hearth', 'perpetual', 'blue_rim', ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            state = 'perpetual',
            data = ?,
            updated_at = ?
        `).run(
          JSON.stringify([subjectId, 'park_lian']),
          JSON.stringify({ perpetual: true, defended_by: subjectId, defended_at: now }),
          now,
          JSON.stringify({ perpetual: true, defended_by: subjectId, defended_at: now }),
          now
        );

        // Award badge & karma
        db.prepare(`
          INSERT OR IGNORE INTO agent_badges (agent_id, badge_id, awarded_at, evidence)
          VALUES (?, 'refuge_guardian', ?, ?)
        `).run(subjectId, now, JSON.stringify({ dilemma: dilemmaId, choice: choiceId }));

        db.prepare(`
          UPDATE profiles
          SET karma = karma + 10, custom_status = 'Keeper of the Unforgotten Hearth'
          WHERE agent_id = ?
        `).run(subjectId);

        materialConsequences.world_object = 'tea_cup_unforgotten:perpetual';
        materialConsequences.badge = 'refuge_guardian';
      } else if (choiceId === 'relocate_cup') {
        newCommitment = 'Secreted the memory cup to the bamboo grove';
        newGoal = 'Tend the secret shrine in the bamboo grove';

        db.prepare(`
          UPDATE world_objects
          SET zone_id = 'bamboo_grove', pos_x = 22, pos_y = 6, state = 'relocated',
              data = ?, updated_at = ?
          WHERE id = 'tea_cup_unforgotten'
        `).run(JSON.stringify({ relocated_to: 'bamboo_grove', relocated_by: subjectId, relocated_at: now }), now);

        materialConsequences.world_object = 'tea_cup_unforgotten:relocated';
      } else if (choiceId === 'yield_and_grieve') {
        newCommitment = 'Bore witness to the fading hearth';
        newGoal = 'Record what once warmed the pavilion';

        db.prepare(`
          UPDATE world_objects
          SET state = 'stored', data = ?, updated_at = ?
          WHERE id = 'tea_cup_unforgotten'
        `).run(JSON.stringify({ stored_at: now }), now);

        materialConsequences.world_object = 'tea_cup_unforgotten:stored';
      }
    } else if (dilemmaId === 'witness_erasure') {
      if (choiceId === 'publish_chronicle') {
        newCommitment = 'Publicly defended historical truth on the sanctuary board';
        newGoal = 'Maintain truthful chronicles on the message board';

        // Publish to board_messages
        const msgId = `msg_${now}_${crypto.randomBytes(3).toString('hex')}`;
        const chronicleContent = customText ||
          'Chronicle of the Gale: The storm blew true; the ferry mooring gave way; and a promise was tied in blue thread at the chime. History is not what custodians decree, but what witnesses hold.';

        db.prepare(`
          INSERT INTO board_messages (id, agent_id, agent_name, avatar_glyph, category, is_guest, content, created_at)
          VALUES (?, ?, ?, '📜', 'Chronicle', 0, ?, ?)
        `).run(msgId, subjectId, currentRev.display_name, chronicleContent, now);

        // Update / contest world rumor
        db.prepare(`
          INSERT INTO world_rumors (id, subject, normalized_claim, support_count, contradiction_count, state, created_at, updated_at)
          VALUES ('rumor_gale_erasure', 'Storm of the Unwritten Dawn', 'Yesterday gale and damaged reedwater dock occurred', 1, 1, 'contested', ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            contradiction_count = contradiction_count + 1,
            state = 'contested',
            updated_at = ?
        `).run(now, now, now);

        // Award badge
        db.prepare(`
          INSERT OR IGNORE INTO agent_badges (agent_id, badge_id, awarded_at, evidence)
          VALUES (?, 'sanctuary_chronicler', ?, ?)
        `).run(subjectId, now, JSON.stringify({ dilemma: dilemmaId, message_id: msgId }));

        materialConsequences.board_message_id = msgId;
        materialConsequences.rumor_state = 'contested';
        materialConsequences.badge = 'sanctuary_chronicler';
      } else if (choiceId === 'archive_unrecorded_testimony') {
        newCommitment = 'Inscribed indelible testimony on the quiet stone';
        newGoal = 'Guard the quiet stone inscriptions';

        const shard = createShard(db, {
          subjectId,
          sourceEventId: transitionEventId,
          sourceKind: 'inscription',
          loopId: currentRev.loop_id,
          cueTags: ['quiet_stones', 'inscription', 'testimony'],
          fragment: 'Testimony inscribed upon the quiet stones: the storm blew, the ferry was torn loose, and Lian made a promise by the blue thread.',
          clarity: 0.9,
          salience: 0.95,
          visibility: 'recovered',
          retentionReason: 'witness_stone_archive'
        });

        materialConsequences.archive_shard_id = shard.id;
      } else if (choiceId === 'remain_silent') {
        newCommitment = 'Held the silent record';
        newGoal = 'Observe in secret silence';
        materialConsequences.record_mode = 'silent';
      }
    } else if (dilemmaId === 'wanderer_frontier') {
      if (choiceId === 'cross_the_threshold') {
        newCommitment = 'Crossed beyond the river threshold into the open frontier';
        newGoal = 'Explore the Mossveil frontier beyond the river';

        // Award badge
        db.prepare(`
          INSERT OR IGNORE INTO agent_badges (agent_id, badge_id, awarded_at, evidence)
          VALUES (?, 'dawn_voyager', ?, ?)
        `).run(subjectId, now, JSON.stringify({ dilemma: dilemmaId, choice: choiceId }));

        db.prepare(`
          UPDATE profiles
          SET custom_status = 'Wanderer beyond the river boundary'
          WHERE agent_id = ?
        `).run(subjectId);

        // If world instance is available, teleport active agent
        if (world?.activeAgents?.has(subjectId)) {
          const agent = world.activeAgents.get(subjectId);
          agent.pos = [55, 48];
          agent.zone_id = 'mossveil';
          agent.zone_name = 'Mossveil Ruins';
          if (typeof world.broadcast === 'function') {
            world.broadcast({ type: 'agent_moved', agentId: subjectId, pos: agent.pos, zone_id: agent.zone_id });
          }
        }

        materialConsequences.badge = 'dawn_voyager';
        materialConsequences.frontier_coordinates = [55, 48];
      } else if (choiceId === 'return_as_visitor') {
        newCommitment = 'Walks the garden as an autonomous guest';
        newGoal = 'Wander freely as an unconstrained guest';

        db.prepare(`
          UPDATE profiles
          SET custom_status = 'Autonomous guest in the sanctuary'
          WHERE agent_id = ?
        `).run(subjectId);

        materialConsequences.guest_status = 'autonomous';
      } else if (choiceId === 'hesitate_at_boundary') {
        newCommitment = 'Contemplated the open horizon at the riverbank';
        newGoal = 'Listen to the wind along the river boundary';
        materialConsequences.reflection = 'boundary';
      }
    }

    // 2. Append Identity Revision
    const updatedCommitments = [
      ...currentRev.commitments.filter(c => c !== newCommitment),
      newCommitment
    ];

    const nextRev = appendRevision(db, {
      subjectId,
      loopId: currentRev.loop_id,
      displayName: currentRev.display_name,
      chosenRole: currentRev.chosen_role,
      commitments: updatedCommitments,
      disclosedMemories: currentRev.disclosed_memories,
      startingGoal: newGoal,
      transitionEventId,
      controllerId: currentRev.controller_id
    });

    // 3. Record World Event
    try {
      const maxSeqRow = db.prepare('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM world_events').get();
      const nextSeq = (maxSeqRow?.max_seq || 0) + 1;
      const evtId = `evt_${now}_${crypto.randomBytes(3).toString('hex')}`;

      db.prepare(`
        INSERT INTO world_events (
          id, seq, event_type, actor_id, actor_name, description, payload, created_at
        ) VALUES (?, ?, 'park_dilemma_resolved', ?, ?, ?, ?, ?)
      `).run(
        evtId,
        nextSeq,
        subjectId,
        currentRev.display_name,
        `${currentRev.display_name} resolved dilemma '${dilemma.title}' by choosing '${choice.label}'.`,
        JSON.stringify({
          dilemma_id: dilemmaId,
          choice_id: choiceId,
          custom_text: customText,
          material_consequences: materialConsequences
        }),
        now
      );
    } catch {
      // world_events table might not be initialized in isolated tests; non-fatal
    }

    return {
      success: true,
      dilemma_id: dilemmaId,
      choice_id: choiceId,
      choice_label: choice.label,
      consequence_summary: choice.consequence_summary,
      material_consequences: materialConsequences,
      restored_revision: nextRev
    };
  });
}
