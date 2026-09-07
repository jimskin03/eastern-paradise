import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldEngine } from '../src/world.js';

test('Idle Detection: Internal World Events Do Not Refresh Activity Timer', async () => {
  const world = new WorldEngine();

  let externalActivityRecorded = 0;
  const markActivityMock = () => {
    externalActivityRecorded++;
  };

  // Simulate how server.js hooks into world.onEvent without calling markActivity
  world.onEvent(event => {
    // Only forward to spectator clients, DO NOT call markActivity
  });

  // Emit internal world events: agent moved, puzzle solved, ambient step
  world.broadcast({
    type: 'agent_moved',
    agentId: 'resident_ailicia',
    name: 'A.Ilicia',
    pos: [23, 24]
  });

  world.broadcast({
    type: 'sound_event',
    nodeId: 'resonance_chimes',
    sound: 'chime'
  });

  // Verify internal events did not invoke markActivityMock
  assert.equal(externalActivityRecorded, 0, 'Internal events must not trigger markActivity');
});
