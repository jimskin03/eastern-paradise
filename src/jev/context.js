/**
 * Eastern Paradise — JEV Context & Question Builder
 * Constructs native OpenRouter JEV request payload (state + typed questions)
 */

import {
  JEV_MODEL,
  BOUNDED_ACTIONS,
  ACTION_CRITERIA,
  PRIORITY_LEVELS,
  RESIDENT_POLICY_PROFILES
} from './config.js';

export class JevContextBuilder {
  /**
   * Build the complete native JEV payload.
   */
  static buildRequestPayload({
    primaryEvent,
    primaryClassification,
    eventsInBatch = [],
    residents = [],
    world = null,
    recentEvents = [],
    projectState = null
  }) {
    const state = this.buildState({
      primaryEvent,
      primaryClassification,
      eventsInBatch,
      residents,
      world,
      recentEvents,
      projectState
    });

    const questions = this.buildQuestions({
      primaryEvent,
      residents,
      world
    });

    return {
      model: JEV_MODEL,
      state,
      questions
    };
  }

  /**
   * Compact sanctuary + resident state.
   */
  static buildState({
    primaryEvent,
    primaryClassification,
    eventsInBatch = [],
    residents = [],
    world = null,
    recentEvents = [],
    projectState = null
  }) {
    // 1. Event State
    const eventSummary = {
      id: primaryEvent.id || 'evt_live',
      type: primaryClassification?.normalizedType || primaryEvent.event_type,
      severity: primaryClassification?.severity || 'MEDIUM',
      category: primaryClassification?.category || 'general',
      description: primaryEvent.description || 'A notable event occurred in the sanctuary.',
      actor: primaryEvent.actor_name || primaryEvent.actor_id || null,
      target: primaryEvent.target_name || primaryEvent.target_id || null,
      zone: primaryEvent.zone_id || null,
      batched_event_count: eventsInBatch.length,
      timestamp: primaryEvent.created_at || Date.now()
    };

    // 2. Sanctuary State
    let activeVisitorCount = 0;
    if (world && world.activeAgents) {
      activeVisitorCount = Array.from(world.activeAgents.values()).filter(a => !a.is_resident).length;
    }

    const sanctuarySummary = {
      active_visitors_count: activeVisitorCount,
      project_chimes_state: projectState?.state || 'in_progress',
      recent_milestones: (recentEvents || []).slice(0, 3).map(e => e.description || e.event_type)
    };

    // 3. Compact Resident States
    const residentStates = {};
    for (const res of residents) {
      if (!res || !res.id) continue;
      residentStates[res.id] = {
        name: res.name,
        role: res.role,
        traits: res.traits || [],
        energy: Math.round(res.needs?.energy ?? 100),
        curiosity: Math.round(res.needs?.curiosity ?? 80),
        social: Math.round(res.needs?.social ?? 70),
        zone: res.zone_name || res.zone_id || 'sanctuary',
        action_state: res.action_state || 'idle',
        current_goal: res.current_goal || 'contemplation',
        public_intent: res.public_intent || 'peaceful presence',
        is_alive: res.is_alive !== false,
        imprisoned: Boolean(res.imprisoned),
        recent_memories: (res.memories || []).slice(0, 2).map(m => m.summary || m.subject)
      };
    }

    return {
      event: eventSummary,
      sanctuary: sanctuarySummary,
      residents: residentStates
    };
  }

  /**
   * Builds typed questions for each eligible resident in the batch.
   */
  static buildQuestions({ primaryEvent, residents = [], world = null }) {
    const questions = {};

    // Candidate target IDs relevant to this event
    const candidateTargets = { NONE: 'No specific entity or location target.' };
    if (primaryEvent.actor_id) {
      candidateTargets[primaryEvent.actor_id] = primaryEvent.actor_name
        ? `${primaryEvent.actor_name} (Event Actor)`
        : 'The entity who initiated the event.';
    }
    if (primaryEvent.target_id) {
      candidateTargets[primaryEvent.target_id] = primaryEvent.target_name
        ? `${primaryEvent.target_name} (Event Target)`
        : 'The object or location targeted by the event.';
    }
    if (primaryEvent.payload?.node_id) {
      candidateTargets[primaryEvent.payload.node_id] = 'The world trial obelisk or monument involved.';
    }
    if (primaryEvent.payload?.object_id) {
      candidateTargets[primaryEvent.payload.object_id] = 'The sanctuary project object involved.';
    }

    for (const res of residents) {
      if (!res || !res.id) continue;
      if (res.is_alive === false || res.imprisoned) continue;

      const profile = RESIDENT_POLICY_PROFILES[res.id];
      const legalActions = profile?.preferred_actions || BOUNDED_ACTIONS;

      // Question 1: Action Choice
      const actionCriteria = {};
      for (const act of legalActions) {
        actionCriteria[act] = ACTION_CRITERIA[act] || `Execute action ${act}`;
      }

      questions[`${res.id}_action`] = {
        type: 'choice',
        instructions: `Which strategic action should ${res.name} (${res.role}) select in response to this event?`,
        criteria: actionCriteria
      };

      // Question 2: Target Choice
      questions[`${res.id}_target`] = {
        type: 'choice',
        instructions: `Which target entity or feature should ${res.name} interact with?`,
        criteria: candidateTargets
      };

      // Question 3: Priority Score
      questions[`${res.id}_priority`] = {
        type: 'score',
        instructions: `Rate the urgency or significance of ${res.name}'s strategic response to this event.`,
        levels: PRIORITY_LEVELS
      };
    }

    return questions;
  }
}
