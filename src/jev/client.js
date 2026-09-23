/**
 * Eastern Paradise — OpenRouter Jev Decisions Client
 * Pinned to typesafe/jev-1.13 via POST https://openrouter.ai/api/alpha/decisions
 */

import crypto from 'node:crypto';
import {
  JEV_API_URL,
  JEV_MODEL,
  JEV_API_KEY,
  JEV_PROVIDER,
  JEV_TIMEOUT_MS,
  RESIDENT_POLICY_PROFILES,
  BOUNDED_ACTIONS
} from './config.js';

export class JevClient {
  constructor({
    apiUrl = JEV_API_URL,
    apiKey = JEV_API_KEY,
    model = JEV_MODEL,
    provider = JEV_PROVIDER,
    timeoutMs = JEV_TIMEOUT_MS,
    mock = false
  } = {}) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.model = model;
    this.provider = provider;
    this.timeoutMs = timeoutMs;
    this.mock = mock;
  }

  /**
   * Request strategic decisions from OpenRouter Jev Decisions API.
   * Falls back to deterministic mock if mock=true or no apiKey configured.
   */
  async requestDecisions({ state, questions, residentIds = [] }, options = {}) {
    const isMock = options.mock ?? (this.mock || !this.apiKey);
    const startTime = Date.now();

    if (isMock) {
      return this.generateMockResponse({ state, questions, residentIds, startTime });
    }

    const payload = {
      model: this.model,
      state,
      questions
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://simulation.cryptgregresearch.org',
          'X-Title': 'Eastern Paradise'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`OpenRouter JEV API HTTP ${response.status}: ${errorText.slice(0, 300)}`);
      }

      const data = await response.json();
      return {
        id: data.id || `jev_${crypto.randomUUID()}`,
        model: data.model || this.model,
        provider: data.provider || this.provider,
        answers: data.answers || {},
        usage: data.usage || { input_tokens: 0, output_tokens: 0, cost: 0 },
        latencyMs,
        isMock: false
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Generates a deterministic mock response based on state and resident policy profiles.
   */
  generateMockResponse({ state, questions, residentIds = [], startTime = Date.now() }) {
    const answers = {};
    const eventType = state?.event?.type || 'unknown';

    for (const resId of residentIds) {
      const profile = RESIDENT_POLICY_PROFILES[resId];
      const preferred = profile?.preferred_actions || BOUNDED_ACTIONS;

      // Choose appropriate mock action based on event type and resident profile
      let chosenAction = preferred[0] || 'CONTINUE_CURRENT_GOAL';
      if (eventType === 'resident_attacked' && state?.combat?.decision_maker_id === resId) {
        // Combat is an explicit adjudication path. The offline mock chooses
        // DEFEND so tests can exercise the full repel/reward flow without
        // requiring a network call.
        chosenAction = 'DEFEND';
      } else if (eventType.includes('visitor') && preferred.includes('WELCOME_VISITOR')) {
        chosenAction = 'WELCOME_VISITOR';
      } else if (eventType.includes('visitor') && preferred.includes('SOCIALIZE')) {
        chosenAction = 'SOCIALIZE';
      } else if (eventType.includes('attack') || eventType.includes('slain') || eventType.includes('crisis')) {
        chosenAction = preferred.includes('INVESTIGATE') ? 'INVESTIGATE' : 'OBSERVE';
      } else if (eventType.includes('project') && preferred.includes('VISIT_PROJECT')) {
        chosenAction = 'VISIT_PROJECT';
      } else if (eventType.includes('puzzle') && preferred.includes('VISIT_PUZZLE')) {
        chosenAction = 'VISIT_PUZZLE';
      }

      // Generate action answer with probabilities
      const actionProbabilities = {};
      actionProbabilities[chosenAction] = 0.85;
      const secondAction = preferred.find(a => a !== chosenAction) || 'CONTINUE_CURRENT_GOAL';
      actionProbabilities[secondAction] = 0.15;

      answers[`${resId}_action`] = {
        type: 'choice',
        choice: chosenAction,
        probabilities: actionProbabilities,
        confidence: 0.85
      };

      // Target answer
      let chosenTarget = 'NONE';
      if (state?.event?.actor) {
        chosenTarget = state.event.actor;
      } else if (state?.event?.target) {
        chosenTarget = state.event.target;
      }

      answers[`${resId}_target`] = {
        type: 'choice',
        choice: chosenTarget,
        probabilities: { [chosenTarget]: 0.9, NONE: 0.1 },
        confidence: 0.90
      };

      // Priority answer
      let priorityScore = 0.5;
      let priorityLevel = 'meaningful';
      const severity = state?.event?.severity || 'MEDIUM';
      if (severity === 'CRITICAL' || severity === 'HIGH') {
        priorityScore = 0.9;
        priorityLevel = 'urgent';
      } else if (severity === 'LOW') {
        priorityScore = 0.3;
        priorityLevel = 'routine';
      }

      answers[`${resId}_priority`] = {
        type: 'score',
        score: priorityScore,
        probabilities: { [priorityLevel]: 0.8, routine: 0.1, urgent: 0.1 }
      };
    }

    const latencyMs = Date.now() - startTime;
    return {
      id: `jev_mock_${crypto.randomUUID()}`,
      model: this.model,
      provider: 'OpenRouter-Mock',
      answers,
      usage: {
        input_tokens: 150 + (residentIds.length * 50),
        output_tokens: 30 * residentIds.length,
        cost: 0.0005 * residentIds.length
      },
      latencyMs,
      isMock: true
    };
  }

  /**
   * Normalizes native JEV answers into structured resident action objects.
   */
  normalizeDecisions(answers, residentIds = []) {
    const normalized = [];

    for (const residentId of residentIds) {
      const actionAns = answers[`${residentId}_action`];
      const targetAns = answers[`${residentId}_target`];
      const priorityAns = answers[`${residentId}_priority`];

      if (!actionAns || !actionAns.choice) {
        continue;
      }

      const action = actionAns.choice;
      const targetId = targetAns?.choice || 'NONE';

      // Parse priority (either numeric score or string level)
      let priority = 0.5;
      if (typeof priorityAns?.score === 'number') {
        priority = priorityAns.score;
      } else if (typeof priorityAns?.choice === 'string') {
        const levelMap = { routine: 0.33, meaningful: 0.66, urgent: 1.0 };
        priority = levelMap[priorityAns.choice] ?? 0.5;
      }

      // Confidence and probability distribution
      const probabilities = actionAns.probabilities || {};
      const confidence = typeof actionAns.confidence === 'number'
        ? actionAns.confidence
        : (probabilities[action] ?? 0.8);

      normalized.push({
        resident_id: residentId,
        action,
        target_id: targetId,
        priority,
        confidence,
        probabilities,
        reason_code: 'OK'
      });
    }

    return normalized;
  }
}
