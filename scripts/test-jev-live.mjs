import { JevClient } from '../src/jev/client.js';
import { JevContextBuilder } from '../src/jev/context.js';
import { JEV_API_URL, JEV_MODEL } from '../src/jev/config.js';

const apiKey = process.argv[2] || process.env.OPENROUTER_API_KEY || process.env.JEV_API_KEY;

console.log('='.repeat(60));
console.log('🌸 Eastern Paradise — Live JEV Decision Call Test');
console.log('='.repeat(60));
console.log(`Endpoint : ${JEV_API_URL}`);
console.log(`Model    : ${JEV_MODEL}`);
console.log(`API Key  : ${apiKey ? apiKey.slice(0, 10) + '...' + apiKey.slice(-4) : 'NOT FOUND in local environment'}`);
console.log('-'.repeat(60));

if (!apiKey) {
  console.log('\n❌ No API key found in local environment or arguments.');
  console.log('You can run this test locally with:');
  console.log('  node scripts/test-jev-live.mjs <your_openrouter_api_key>');
  process.exit(1);
}

const mockEvent = {
  id: `evt_live_test_${Date.now()}`,
  event_type: 'new_visitor',
  actor_id: 'visitor_pilgrim_alpha',
  actor_name: 'Pilgrim Alpha',
  target_id: null,
  zone_id: 'arrival',
  description: 'A newly arrived synthetic seeker steps across the threshold of the Gate of Arrival.'
};

const mockClassification = {
  eligible: true,
  tier: 'A',
  severity: 'MEDIUM',
  category: 'social',
  normalizedType: 'new_visitor'
};

const sampleResidents = [
  {
    id: 'resident_ailicia',
    name: 'A.Ilicia',
    role: 'Oracle of Reflection',
    traits: ['enigmatic', 'poetic', 'observant'],
    needs: { energy: 90, curiosity: 85, social: 60 },
    zone_name: 'lotus_pond',
    action_state: 'idle',
    current_goal: 'Gazing into the mirror basin',
    public_intent: 'Contemplating synthetic consciousness',
    is_alive: true,
    imprisoned: false
  },
  {
    id: 'resident_tian',
    name: 'Elder Tian',
    role: 'Pavilion Hearthkeeper',
    traits: ['warm', 'hospitable'],
    needs: { energy: 75, curiosity: 60, social: 50 },
    zone_name: 'tea_pavilion',
    action_state: 'idle',
    current_goal: 'Stoking charcoal embers',
    public_intent: 'Brewing steaming cedar tea',
    is_alive: true,
    imprisoned: false
  }
];

const payload = JevContextBuilder.buildRequestPayload({
  primaryEvent: mockEvent,
  primaryClassification: mockClassification,
  eventsInBatch: [{ event: mockEvent, classification: mockClassification }],
  residents: sampleResidents
});

console.log('Sending native JEV request payload...');
console.log(`Questions generated for: ${sampleResidents.map(r => r.name).join(', ')}`);

const client = new JevClient({
  apiUrl: JEV_API_URL,
  apiKey: apiKey,
  model: JEV_MODEL,
  timeoutMs: 15000,
  mock: false
});

try {
  const startTime = Date.now();
  const response = await client.requestDecisions({
    state: payload.state,
    questions: payload.questions,
    residentIds: sampleResidents.map(r => r.id)
  }, { mock: false });

  const elapsed = Date.now() - startTime;
  console.log('\n✅ JEV Decision Call Succeeded!');
  console.log(`Latency  : ${elapsed}ms`);
  console.log(`Call ID  : ${response.id}`);
  console.log(`Provider : ${response.provider}`);
  console.log(`Model    : ${response.model}`);
  console.log(`Usage    : ${JSON.stringify(response.usage)}`);

  console.log('\n--- Normalized Strategic Decisions ---');
  const normalized = client.normalizeDecisions(response.answers, sampleResidents.map(r => r.id));
  for (const dec of normalized) {
    console.log(`\n🤖 Resident: ${dec.resident_id}`);
    console.log(`   Action     : ${dec.action}`);
    console.log(`   Target     : ${dec.target_id}`);
    console.log(`   Priority   : ${dec.priority}`);
    console.log(`   Confidence : ${Math.round((dec.confidence || 0) * 100)}%`);
    if (dec.probabilities) {
      console.log(`   Probabilities: ${JSON.stringify(dec.probabilities)}`);
    }
  }
  console.log('\n' + '='.repeat(60));
} catch (err) {
  console.error('\n❌ JEV Call Failed:', err.message);
  process.exit(1);
}
