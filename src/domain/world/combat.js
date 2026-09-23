import crypto from 'node:crypto';
import { db } from '../../db.js';
import { eventLedger } from '../../events.js';
import { RESIDENTS_DEF } from '../../residents.js';

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
export function attackResident(world, residentManager, agentId, residentId) {
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

  // 3. Proximity check (distance <= 3.0 tiles required)
  const dist = Math.hypot(targetResident.pos[0] - attacker.pos[0], targetResident.pos[1] - attacker.pos[1]);
  if (dist > 3.0) {
    return {
      ok: false,
      success: false,
      error: 'too_far',
      error_code: 'TOO_FAR',
      message: `Too far from ${targetResident.name} (distance: ${dist.toFixed(1)} tiles). Step closer to attack.`,
      target_pos: targetResident.pos,
      distance: Math.round(dist * 10) / 10
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

  // 4. Slay resident (triggers 15-minute death cooldown)
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
    eventLedger.recordEvent(
      'resident_slain',
      {
        actor_id: attacker.id,
        actor_name: attacker.name,
        target_id: targetResident.id,
        target_name: targetResident.name,
        karma_penalty: -NPC_KILL_KARMA_PENALTY,
        merit_penalty: -NPC_KILL_MERIT_PENALTY,
        imprisoned
      },
      `${attacker.name} struck down resident ${targetResident.name}! Inflicted -${NPC_KILL_KARMA_PENALTY} Karma and -${NPC_KILL_MERIT_PENALTY} $MERIT.${imprisoned ? ' Karma fell below 0; offender sentenced to 3 hours in the Dark Sanctuary.' : ''}`
    );
  } catch (_) {}

  return {
    ok: true,
    success: true,
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
    respawn_in_seconds: killResult?.respawn_in_seconds || 900
  };
}
