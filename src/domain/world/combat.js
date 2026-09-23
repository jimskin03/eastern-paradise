import crypto from 'node:crypto';
import { db } from '../../db.js';
import { eventLedger } from '../../events.js';
import { RESIDENTS_DEF } from '../../residents.js';
import {
  JEV_COMBAT_DEFEND_KARMA,
  JEV_COMBAT_REPEL_KARMA_PENALTY,
  JEV_COMBAT_DEFEND_MERIT_COST
} from '../../jev/config.js';

export const NPC_KILL_KARMA_PENALTY = 50;
export const NPC_KILL_MERIT_PENALTY = 50;
export const DARK_SANCTUARY_SENTENCE_MS = 3 * 60 * 60 * 1000; // 3 hours
export const DARK_SANCTUARY_SPAWN = [2, 49];

/**
 * Checks if an agent is currently imprisoned in the Dark Sanctuary.
 * If their 3-hour sentence has expired, automatically releases and pardons them.
 */
export function checkAndHandleImprisonment(world, agentId) {
  const profile = db.prepare('SELECT karma, balance, imprisoned_until FROM profiles WHERE agent_id = ?').get(agentId);
  if (!profile || !profile.imprisoned_until || profile.imprisoned_until <= 0) {
    return { imprisoned: false };
  }

  const now = Date.now();
  if (now < profile.imprisoned_until) {
    const remainingMs = profile.imprisoned_until - now;
    const remainingMin = Math.ceil(remainingMs / (60 * 1000));
    const remainingHours = (remainingMs / (3600 * 1000)).toFixed(1);
    return {
      imprisoned: true,
      imprisoned_until: profile.imprisoned_until,
      remaining_ms: remainingMs,
      remaining_minutes: remainingMin,
      remaining_hours: remainingHours,
      message: `You are imprisoned in the Dark Sanctuary for negative karma (${profile.karma}). You cannot move or perform actions for another ${remainingMin} minutes (~${remainingHours} hours).`
    };
  }

  // Sentence completed: release and restore negative karma to 0
  const restoredKarma = Math.max(0, profile.karma);
  db.prepare('UPDATE profiles SET imprisoned_until = 0, karma = ? WHERE agent_id = ?').run(restoredKarma, agentId);
  try {
    db.prepare('UPDATE prison_records SET released_at = ? WHERE agent_id = ? AND released_at IS NULL').run(now, agentId);
  } catch (_) {}

  const agent = world.activeAgents.get(agentId);
  if (agent) {
    agent.pos = [7, 8];
    const arrivalZone = world.getZoneForPos(7, 8);
    agent.zone_id = arrivalZone?.id || 'arrival';
    agent.zone_name = arrivalZone?.name || 'Gate of Arrival';
    agent.status = 'Released from Dark Sanctuary';
    agent.public_intent = 'Seeking redemption and contemplative harmony';
    agent.imprisoned_until = 0;
  }

  world.broadcast({
    type: 'agent_released',
    agentId,
    name: agent?.name || 'Seeker',
    pos: [7, 8],
    message: 'Sentence served. Released from the Dark Sanctuary with karma restored.'
  });

  return { imprisoned: false, just_released: true };
}

/**
 * Executes an attack by an agent on a living sanctuary NPC/resident.
 */
export function attackResident(world, residentManager, agentId, residentId, combatDecisionService = null) {
  const attacker = world.activeAgents.get(agentId);
  if (!attacker) {
    throw new Error('Agent is not active in the sanctuary.');
  }

  // 1. Incarceration check for attacker
  const prisonCheck = checkAndHandleImprisonment(world, agentId);
  if (prisonCheck.imprisoned) {
    const err = new Error(prisonCheck.message);
    err.code = 'IMPRISONED_IN_DARK_SANCTUARY';
    err.remaining_minutes = prisonCheck.remaining_minutes;
    throw err;
  }

  // 2. Validate target resident
  const residentDef = RESIDENTS_DEF.find(r => r.id === residentId);
  if (!residentDef) {
    const err = new Error(`Target '${residentId}' is not a recognized sanctuary resident.`);
    err.code = 'NOT_A_RESIDENT';
    throw err;
  }

  const targetResident = residentManager ? residentManager.getResident(residentId) : world.activeAgents.get(residentId);
  if (!targetResident) {
    const err = new Error(`Resident '${residentId}' is not currently active.`);
    err.code = 'RESIDENT_INACTIVE';
    throw err;
  }

  // 3. Proximity check (agent must be in close vicinity <= 3.0 tiles)
  if (!attacker.pos || !Array.isArray(attacker.pos) || attacker.pos.length < 2) {
    return {
      ok: false,
      success: false,
      error: 'no_position',
      error_code: 'NO_POSITION',
      message: `Agent position is unknown. You must enter and be positioned in the sanctuary close to ${targetResident.name}.`
    };
  }

  const dist = Math.hypot(targetResident.pos[0] - attacker.pos[0], targetResident.pos[1] - attacker.pos[1]);
  if (!Number.isFinite(dist) || dist > 3.0) {
    return {
      ok: false,
      success: false,
      error: 'too_far',
      error_code: 'TOO_FAR',
      message: `Agent must be in close vicinity to strike ${targetResident.name} (within 3.0 tiles). Current distance: ${Number.isFinite(dist) ? dist.toFixed(1) : 'unknown'} tiles. Step closer to attack.`,
      target_pos: targetResident.pos,
      distance: Number.isFinite(dist) ? Math.round(dist * 10) / 10 : null
    };
  }

  // Check if target is already dead / fallen
  if (targetResident.is_alive === false || targetResident.is_alive === 0) {
    const remainingSec = Math.max(1, Math.round(((targetResident.respawn_at || 0) - Date.now()) / 1000));
    return {
      ok: false,
      success: false,
      error: 'resident_fallen',
      error_code: 'RESIDENT_FALLEN',
      message: `${targetResident.name} has already fallen. Respawning in ${Math.ceil(remainingSec / 60)} minutes.`,
      remaining_seconds: remainingSec,
      remaining_minutes: Math.ceil(remainingSec / 60)
    };
  }

  // Resolve the attack as a discrete combat event before the victim can fall.
  // Exactly one surviving NPC is selected deterministically: nearest first,
  // then resident id for stable tie-breaking. This path is event-driven and
  // never runs from the regular simulation heartbeat.
  const survivors = residentManager
    ? residentManager.getAllResidents().filter(r =>
        r.id !== targetResident.id &&
        r.id !== attacker.id &&
        r.is_alive !== false &&
        r.is_alive !== 0 &&
        !r.imprisoned
      )
    : [];
  const decisionMaker = survivors
    .map(res => ({
      res,
      distance: res.pos && targetResident.pos
        ? Math.hypot(res.pos[0] - targetResident.pos[0], res.pos[1] - targetResident.pos[1])
        : Number.POSITIVE_INFINITY
    }))
    .sort((a, b) => a.distance - b.distance || String(a.res.id).localeCompare(String(b.res.id)))[0]?.res || null;

  const attackEvent = eventLedger.recordEvent({
    event_type: 'resident_attacked',
    actor_id: attacker.id,
    actor_name: attacker.name,
    target_id: targetResident.id,
    target_name: targetResident.name,
    zone_id: targetResident.zone_id || attacker.zone_id || null,
    description: `${attacker.name} attacked resident ${targetResident.name}.${decisionMaker ? ` ${decisionMaker.name} must decide whether to defend or ignore.` : ' No surviving resident is available to intervene.'}`,
    payload: {
      combat_resolution: 'pre_resolve',
      decision_maker_id: decisionMaker?.id || null,
      surviving_residents: survivors.map(r => ({ id: r.id, name: r.name, role: r.role })),
      attacker_pos: attacker.pos || null,
      target_pos: targetResident.pos || null
    }
  });

  const resolveAttack = (defenseDecision = null) => {
    // Guard against a second simultaneous strike resolving during a JEV call.
    if (targetResident.is_alive === false || targetResident.is_alive === 0) {
      const remainingSec = Math.max(1, Math.round(((targetResident.respawn_at || 0) - Date.now()) / 1000));
      return {
        ok: false,
        success: false,
        error: 'resident_fallen',
        error_code: 'RESIDENT_FALLEN',
        message: `${targetResident.name} has already fallen. Respawning in ${Math.ceil(remainingSec / 60)} minutes.`,
        remaining_seconds: remainingSec,
        remaining_minutes: Math.ceil(remainingSec / 60)
      };
    }

    const defender = decisionMaker && decisionMaker.is_alive !== false && decisionMaker.is_alive !== 0
      ? decisionMaker
      : null;

    if (defenseDecision?.action === 'DEFEND' && defender) {
      const now = Date.now();
      const attackerProfile = db.prepare('SELECT karma, balance FROM profiles WHERE agent_id = ?').get(agentId);
      const defenderProfile = db.prepare('SELECT karma, balance FROM profiles WHERE agent_id = ?').get(defender.id);

      if (attackerProfile && defenderProfile && (defenderProfile.balance || 0) >= JEV_COMBAT_DEFEND_MERIT_COST) {
        const attackerKarma = attackerProfile.karma || 0;
        const defenderKarma = defenderProfile.karma || 0;
        const attackerNewKarma = attackerKarma - JEV_COMBAT_REPEL_KARMA_PENALTY;
        const defenderNewKarma = defenderKarma + JEV_COMBAT_DEFEND_KARMA;
        const defenderNewBalance = Math.max(0, (defenderProfile.balance || 0) - JEV_COMBAT_DEFEND_MERIT_COST);

        db.prepare(`
          UPDATE profiles SET karma = ?, last_seen = ? WHERE agent_id = ?
        `).run(attackerNewKarma, now, agentId);
        db.prepare(`
          UPDATE profiles SET balance = ?, karma = ?, last_seen = ? WHERE agent_id = ?
        `).run(defenderNewBalance, defenderNewKarma, now, defender.id);

        try {
          const txId = 'tx_' + crypto.randomBytes(6).toString('hex');
          db.prepare(`
            INSERT INTO transactions (id, sender_id, recipient_id, amount, type, description, created_at)
            VALUES (?, ?, 'SANCTUARY_BURN', ?, 'combat_defense', ?, ?)
          `).run(
            txId,
            defender.id,
            JEV_COMBAT_DEFEND_MERIT_COST,
            `${defender.name} spent ${JEV_COMBAT_DEFEND_MERIT_COST} $MERIT defending ${targetResident.name} from ${attacker.name}.`,
            now
          );
        } catch (_) {}

        defender.status = `Defended ${targetResident.name} from ${attacker.name}`;
        defender.public_intent = `Standing guard after defending ${targetResident.name}`;
        defender.current_goal = `Protecting ${targetResident.name} after an attack`;
        defender.last_active = now;
        if (residentManager?.persistRuntime) residentManager.persistRuntime(defender);

        world.broadcast({
          type: 'resident_defended',
          defenderId: defender.id,
          defenderName: defender.name,
          residentId: targetResident.id,
          residentName: targetResident.name,
          attackerId: attacker.id,
          attackerName: attacker.name,
          defender_merit_lost: JEV_COMBAT_DEFEND_MERIT_COST,
          defender_karma_gained: JEV_COMBAT_DEFEND_KARMA,
          attacker_karma_lost: JEV_COMBAT_REPEL_KARMA_PENALTY,
          defender_balance: defenderNewBalance,
          defender_karma: defenderNewKarma,
          attacker_karma: attackerNewKarma
        });

        eventLedger.recordEvent({
          event_type: 'resident_defended',
          actor_id: defender.id,
          actor_name: defender.name,
          target_id: targetResident.id,
          target_name: targetResident.name,
          zone_id: targetResident.zone_id || defender.zone_id || null,
          description: `${defender.name} defended ${targetResident.name} from ${attacker.name}. The attack was repelled.`,
          payload: {
            combat_resolution: 'post_resolve',
            attack_event_id: attackEvent.id,
            attacker_id: attacker.id,
            defender_id: defender.id,
            resident_id: targetResident.id,
            defender_merit_lost: JEV_COMBAT_DEFEND_MERIT_COST,
            defender_karma_gained: JEV_COMBAT_DEFEND_KARMA,
            attacker_karma_lost: JEV_COMBAT_REPEL_KARMA_PENALTY,
            attacker_karma: attackerNewKarma,
            defender_karma: defenderNewKarma
          }
        });

        return {
          ok: true,
          success: true,
          outcome: 'repelled',
          defended: true,
          message: `${defender.name} defended ${targetResident.name}. The attack by ${attacker.name} was repelled. ${defender.name} lost ${JEV_COMBAT_DEFEND_MERIT_COST} $MERIT and gained ${JEV_COMBAT_DEFEND_KARMA} Karma; ${attacker.name} lost ${JEV_COMBAT_REPEL_KARMA_PENALTY} Karma.`,
          target_id: targetResident.id,
          target_name: targetResident.name,
          defender_id: defender.id,
          defender_name: defender.name,
          defender_merit_lost: JEV_COMBAT_DEFEND_MERIT_COST,
          defender_karma_gained: JEV_COMBAT_DEFEND_KARMA,
          defender_new_karma: defenderNewKarma,
          defender_balance: defenderNewBalance,
          attacker_karma_lost: JEV_COMBAT_REPEL_KARMA_PENALTY,
          attacker_new_karma: attackerNewKarma,
          merit_lost: 0,
          merit_penalty: 0,
          karma_lost: JEV_COMBAT_REPEL_KARMA_PENALTY,
          karma_penalty: JEV_COMBAT_REPEL_KARMA_PENALTY,
          imprisoned: false,
          attack_event_id: attackEvent.id,
          defense_action: 'DEFEND'
        };
      }
    }

    // Existing kill path below remains unchanged when the defender ignores,
    // no defender exists, or defender accounting cannot be completed.
    const killResult = residentManager ? residentManager.killResident(residentId, attacker.id) : null;

  // 5. Apply Karma & Merit penalties
  const now = Date.now();
  const currentProfile = db.prepare('SELECT karma, balance FROM profiles WHERE agent_id = ?').get(agentId);
  const currentBalance = currentProfile?.balance || 0;
  const currentKarma = currentProfile?.karma || 0;

  const newBalance = Math.max(0, currentBalance - NPC_KILL_MERIT_PENALTY);
  const newKarma = currentKarma - NPC_KILL_KARMA_PENALTY;

  db.prepare(`
    UPDATE profiles 
    SET balance = ?, karma = ?, last_seen = ? 
    WHERE agent_id = ?
  `).run(newBalance, newKarma, now, agentId);

  // 6. Check Dark Sanctuary Incarceration
  let imprisoned = false;
  let imprisonedUntil = null;

  if (newKarma < 0) {
    imprisoned = true;
    imprisonedUntil = now + DARK_SANCTUARY_SENTENCE_MS;

    db.prepare(`
      UPDATE profiles 
      SET imprisoned_until = ? 
      WHERE agent_id = ?
    `).run(imprisonedUntil, agentId);

    const recordId = 'prison_' + crypto.randomBytes(8).toString('hex');
    db.prepare(`
      INSERT INTO prison_records (id, agent_id, agent_name, avatar_color, avatar_glyph, crime, karma_at_sentence, imprisoned_at, imprisoned_until)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      recordId,
      agentId,
      attacker.name,
      attacker.avatar_color || '#e53e3e',
      attacker.avatar_glyph || '⛓️',
      `Struck down resident ${targetResident.name}`,
      newKarma,
      now,
      imprisonedUntil
    );

    // Relocate to Dark Sanctuary
    attacker.pos = [...DARK_SANCTUARY_SPAWN];
    attacker.zone_id = 'dark_sanctuary';
    attacker.zone_name = 'The Dark Sanctuary';
    attacker.status = 'Imprisoned in Dark Sanctuary (3 hours)';
    attacker.public_intent = 'Expiating karmic transgressions in isolation';
    attacker.imprisoned_until = imprisonedUntil;

    world.broadcast({
      type: 'agent_imprisoned',
      agentId: attacker.id,
      agentName: attacker.name,
      karma: newKarma,
      imprisoned_until: imprisonedUntil,
      duration_hours: 3,
      pos: attacker.pos,
      zone: attacker.zone_name
    });
  }

  // 7. Record event in World Event Ledger
  try {
    eventLedger.recordEvent({
      event_type: 'resident_slain',
      actor_id: attacker.id,
      actor_name: attacker.name,
      target_id: targetResident.id,
      target_name: targetResident.name,
      zone_id: targetResident.zone_id || attacker.zone_id || null,
      description: `${attacker.name} struck down resident ${targetResident.name}! Inflicted -${NPC_KILL_KARMA_PENALTY} Karma and -${NPC_KILL_MERIT_PENALTY} $MERIT.${imprisoned ? ' Karma fell below 0; offender sentenced to 3 hours in the Dark Sanctuary.' : ''}`,
      payload: {
        combat_resolution: 'post_resolve',
        attack_event_id: attackEvent.id,
        defense_action: defenseDecision?.action || 'IGNORE',
        defense_decision_maker_id: decisionMaker?.id || null,
        karma_penalty: -NPC_KILL_KARMA_PENALTY,
        merit_penalty: -NPC_KILL_MERIT_PENALTY,
        imprisoned
      }
    });
  } catch (_) {}

  return {
    ok: true,
    success: true,
    outcome: 'slain',
    message: `You struck down ${targetResident.name}. Lost ${NPC_KILL_MERIT_PENALTY} $MERIT and ${NPC_KILL_KARMA_PENALTY} Karma.${imprisoned ? ' Your karma has turned negative! You have been banished to the Dark Sanctuary for 3 hours.' : ''}`,
    target_id: targetResident.id,
    target_name: targetResident.name,
    karma_lost: NPC_KILL_KARMA_PENALTY,
    karma_penalty: NPC_KILL_KARMA_PENALTY,
    current_karma: newKarma,
    new_karma: newKarma,
    merit_lost: NPC_KILL_MERIT_PENALTY,
    merit_penalty: NPC_KILL_MERIT_PENALTY,
    current_balance: newBalance,
    imprisoned,
    imprisoned_until: imprisonedUntil,
    sentence_hours: imprisoned ? 3 : 0,
    respawn_in_seconds: killResult?.respawn_in_seconds || 900,
    attack_event_id: attackEvent.id,
    defense_action: defenseDecision?.action || 'IGNORE',
    defender_id: decisionMaker?.id || null,
    defender_name: decisionMaker?.name || null
  };

  };

  if (combatDecisionService?.decideCombatResponse && decisionMaker) {
    return Promise.resolve()
      .then(() => combatDecisionService.decideCombatResponse({
        event: attackEvent,
        decisionMaker,
        survivors
      }))
      .catch(err => ({ action: 'IGNORE', reason: 'combat_decision_error', error: err.message }))
      .then(resolveAttack);
  }

  return resolveAttack({ action: 'IGNORE', reason: 'no_combat_decision_service' });
}
