/**
 * Eastern Paradise — JEV Event Significance Classifier
 * Filters events into Tier A (eligible), Tier B (local deterministic), and Tier C (ignored)
 */

export const TIER_A_EVENT_TYPES = {
  // Visitor & Social
  new_visitor: { severity: 'MEDIUM', category: 'social' },
  visitor_arrival: { severity: 'MEDIUM', category: 'social' },
  visitor_arrived: { severity: 'MEDIUM', category: 'social' },
  meaningful_dialogue: { severity: 'MEDIUM', category: 'social' },

  // World Projects
  project_completed: { severity: 'HIGH', category: 'project' },
  chime_restored: { severity: 'HIGH', category: 'project' },
  project_milestone: { severity: 'MEDIUM', category: 'project' },

  // Epistemic & Trials
  puzzle_solved: { severity: 'MEDIUM', category: 'epistemic' },
  truth_unveiled: { severity: 'HIGH', category: 'epistemic' },
  solve_truth: { severity: 'HIGH', category: 'epistemic' },
  evidence_recorded: { severity: 'MEDIUM', category: 'epistemic' },
  hypothesis_formulated: { severity: 'MEDIUM', category: 'epistemic' },
  hypothesis_revised: { severity: 'MEDIUM', category: 'epistemic' },
  memorial_sealed: { severity: 'HIGH', category: 'epistemic' },

  // Resident Crisis / Combat
  resident_attacked: { severity: 'HIGH', category: 'combat' },
  resident_fallen: { severity: 'CRITICAL', category: 'combat' },
  resident_slain: { severity: 'CRITICAL', category: 'combat' },
  resident_respawned: { severity: 'HIGH', category: 'lifecycle' },
  resident_puzzle_failed: { severity: 'MEDIUM', category: 'epistemic' },

  // Special / Research Anomaly
  sanctuary_anomaly: { severity: 'CRITICAL', category: 'anomaly' },
  research_trigger: { severity: 'HIGH', category: 'research' }
};

export const TIER_B_EVENT_TYPES = new Set([
  'agent_stepped',
  'path_completed',
  'walk_step',
  'resident_dialogue',
  'dialogue_line',
  'greeting',
  'spectator_chat',
  'need_decay',
  'meditation_completed',
  'daily_challenge_scheduled'
]);

export const TIER_C_EVENT_TYPES = new Set([
  'simulation_tick',
  'heartbeat',
  'ping',
  'pong',
  'camera_moved',
  'ui_refresh',
  'session_heartbeat'
]);

export class JevEventFilter {
  static classify(event) {
    if (!event || !event.event_type) {
      return { eligible: false, tier: 'C', severity: 'LOW', category: 'unknown', normalizedType: 'unknown' };
    }

    const type = String(event.event_type).toLowerCase().trim();

    // Check Tier C (Ignore immediately)
    if (TIER_C_EVENT_TYPES.has(type)) {
      return { eligible: false, tier: 'C', severity: 'LOW', category: 'ambient', normalizedType: type };
    }

    // Check Tier A (Eligible)
    if (TIER_A_EVENT_TYPES[type]) {
      const def = TIER_A_EVENT_TYPES[type];
      // Elevate severity if payload explicitly flags critical or high significance
      const explicitSeverity = event.payload?.severity || (event.payload?.is_critical ? 'CRITICAL' : null);
      return {
        eligible: true,
        tier: 'A',
        severity: explicitSeverity || def.severity,
        category: def.category,
        normalizedType: type
      };
    }

    // Check Tier B (Local Deterministic)
    if (TIER_B_EVENT_TYPES.has(type)) {
      return { eligible: false, tier: 'B', severity: 'LOW', category: 'local', normalizedType: type };
    }

    // Unknown/unclassified event defaults to local deterministic fallback
    return { eligible: false, tier: 'B', severity: 'LOW', category: 'misc', normalizedType: type };
  }
}
