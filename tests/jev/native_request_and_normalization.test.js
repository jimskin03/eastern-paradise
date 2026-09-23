import test from 'node:test';
import assert from 'node:assert/strict';
import { JevContextBuilder } from '../../src/jev/context.js';
import { JevClient } from '../../src/jev/client.js';
import { BOUNDED_ACTIONS, JEV_MODEL } from '../../src/jev/config.js';

test('JEV Native OpenRouter Payload Construction & Normalization', async (t) => {
  const primaryEvent = {
    id: 'evt_test_1',
    event_type: 'visitor_arrival',
    actor_id: 'visitor_pilgrim_1',
    actor_name: 'Pilgrim One',
    target_id: null,
    zone_id: 'arrival',
    description: 'A new seeker stepped through the Gate of Arrival.'
  };

  const primaryClassification = {
    eligible: true,
    tier: 'A',
    severity: 'MEDIUM',
    category: 'social',
    normalizedType: 'visitor_arrival'
  };

  const residents = [
    {
      id: 'resident_tian',
      name: 'Elder Tian',
      role: 'Pavilion Hearthkeeper',
      traits: ['warm', 'hospitable'],
      needs: { energy: 80, curiosity: 65, social: 50 },
      zone_name: 'tea_pavilion',
      action_state: 'idle',
      current_goal: 'Stoking charcoal embers',
      public_intent: 'Brewing cedar tea',
      is_alive: true,
      imprisoned: false
    },
    {
      id: 'resident_daoming',
      name: 'Master Daoming',
      role: 'Abbot of Bamboo Grove',
      traits: ['zen', 'disciplined'],
      needs: { energy: 70, curiosity: 80, social: 60 },
      zone_name: 'bamboo_grove',
      action_state: 'idle',
      current_goal: 'Listening to bamboo resonance',
      public_intent: 'Mindful walking',
      is_alive: true,
      imprisoned: false
    },
    {
      id: 'resident_dead',
      name: 'Fallen Resident',
      role: 'Specter',
      is_alive: false,
      imprisoned: false
    }
  ];

  await t.test('JevContextBuilder builds exact OpenRouter JEV native schema', () => {
    const payload = JevContextBuilder.buildRequestPayload({
      primaryEvent,
      primaryClassification,
      eventsInBatch: [{ event: primaryEvent, classification: primaryClassification }],
      residents
    });

    assert.equal(payload.model, JEV_MODEL);
    assert.ok(payload.state, 'Payload must have state object');
    assert.ok(payload.questions, 'Payload must have questions object');

    // 1. Verify State
    assert.equal(payload.state.event.type, 'visitor_arrival');
    assert.equal(payload.state.event.actor, 'Pilgrim One');
    assert.ok(payload.state.residents.resident_tian, 'Active resident should be in state');
    assert.ok(payload.state.residents.resident_daoming, 'Active resident should be in state');

    // 2. Verify Questions for active residents
    assert.ok(payload.questions.resident_tian_action, 'resident_tian_action must be present');
    assert.equal(payload.questions.resident_tian_action.type, 'choice');
    assert.ok(payload.questions.resident_tian_action.criteria, 'Must have criteria object');

    assert.ok(payload.questions.resident_tian_target, 'resident_tian_target must be present');
    assert.equal(payload.questions.resident_tian_target.type, 'choice');
    assert.ok(payload.questions.resident_tian_target.criteria['visitor_pilgrim_1'], 'Event actor must be a candidate target');

    assert.ok(payload.questions.resident_tian_priority, 'resident_tian_priority must be present');
    assert.equal(payload.questions.resident_tian_priority.type, 'score');

    // 3. Inactive/dead residents must NOT have questions generated
    assert.equal(payload.questions.resident_dead_action, undefined);
  });

  await t.test('JevClient mock response generates compliant typed answers', async () => {
    const client = new JevClient({ mock: true });
    const payload = JevContextBuilder.buildRequestPayload({
      primaryEvent,
      primaryClassification,
      residents: residents.filter(r => r.is_alive)
    });

    const response = await client.requestDecisions({
      state: payload.state,
      questions: payload.questions,
      residentIds: ['resident_tian', 'resident_daoming']
    });

    assert.equal(response.isMock, true);
    assert.ok(response.answers.resident_tian_action);
    assert.equal(response.answers.resident_tian_action.type, 'choice');
    assert.ok(BOUNDED_ACTIONS.includes(response.answers.resident_tian_action.choice));
    assert.ok(response.answers.resident_tian_action.confidence > 0);
    assert.ok(response.answers.resident_tian_action.probabilities);
  });

  await t.test('JevClient normalizes native answers into resident action records', () => {
    const client = new JevClient();
    const mockAnswers = {
      resident_tian_action: {
        type: 'choice',
        choice: 'WELCOME_VISITOR',
        probabilities: { WELCOME_VISITOR: 0.88, CONTINUE_CURRENT_GOAL: 0.12 },
        confidence: 0.88
      },
      resident_tian_target: {
        type: 'choice',
        choice: 'visitor_pilgrim_1',
        confidence: 0.95
      },
      resident_tian_priority: {
        type: 'score',
        score: 0.75,
        probabilities: { meaningful: 0.8, routine: 0.2 }
      }
    };

    const normalized = client.normalizeDecisions(mockAnswers, ['resident_tian']);
    assert.equal(normalized.length, 1);
    const rec = normalized[0];
    assert.equal(rec.resident_id, 'resident_tian');
    assert.equal(rec.action, 'WELCOME_VISITOR');
    assert.equal(rec.target_id, 'visitor_pilgrim_1');
    assert.equal(rec.priority, 0.75);
    assert.equal(rec.confidence, 0.88);
    assert.deepEqual(rec.probabilities, { WELCOME_VISITOR: 0.88, CONTINUE_CURRENT_GOAL: 0.12 });
  });
});
