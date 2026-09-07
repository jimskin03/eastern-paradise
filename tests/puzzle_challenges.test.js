import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { AuthService } from '../src/auth.js';
import { PuzzleManager } from '../src/puzzles.js';
import { WorldEngine } from '../src/world.js';

test('Puzzle Challenges: Concurrency, Retention, and Idempotent Retries', async (t) => {
  const world = new WorldEngine();

  const g1 = AuthService.createGuest({ name: 'ConcurrentPilot_1' });
  const g2 = AuthService.createGuest({ name: 'ConcurrentPilot_2' });

  const acc1 = db.prepare('SELECT * FROM accounts WHERE id = ?').get(g1.agent_id);
  const acc2 = db.prepare('SELECT * FROM accounts WHERE id = ?').get(g2.agent_id);

  const a1 = world.spawnOrGetAgent(acc1);
  const a2 = world.spawnOrGetAgent(acc2);

  // Position agents near the wood obelisk [27, 9]
  a1.pos = [27, 10];
  a2.pos = [27, 10];

  // Both agents inspect the same wood obelisk
  const inspect1 = world.interact(acc1.id, 'trial_obelisk_wood', 'inspect');
  const inspect2 = world.interact(acc2.id, 'trial_obelisk_wood', 'inspect');

  assert.equal(inspect1.success, true);
  assert.equal(inspect2.success, true);
  assert.ok(inspect1.challenge_id, 'Inspect 1 issued challenge_id');
  assert.ok(inspect2.challenge_id, 'Inspect 2 issued challenge_id');
  assert.notEqual(inspect1.challenge_id, inspect2.challenge_id, 'Each agent receives unique challenge_id');

  // Both inspected the same initial puzzle prompt and answer
  const challenge1 = PuzzleManager.getChallenge(inspect1.challenge_id);
  const challenge2 = PuzzleManager.getChallenge(inspect2.challenge_id);
  assert.ok(challenge1);
  assert.ok(challenge2);

  const answer1 = challenge1.answer;
  const answer2 = challenge2.answer;

  // Agent 1 solves their challenge
  const solve1 = world.interact(acc1.id, 'trial_obelisk_wood', 'solve', {
    answer: answer1,
    challenge_id: inspect1.challenge_id
  });

  assert.equal(solve1.success, true);
  assert.ok(solve1.reward.karma_added > 0);
  const initialKarma1 = solve1.reward.total_karma;
  const initialMerit1 = solve1.reward.total_merit;

  // Obelisk active_puzzles has now regenerated
  const currentActive = db.prepare('SELECT * FROM active_puzzles WHERE node_id = ?').get('trial_obelisk_wood');
  assert.ok(currentActive);

  // Agent 2 submits solution for their previously issued challenge_id
  // Even if active_puzzles changed on the node, Agent 2's answer for challenge2 must succeed!
  const solve2 = world.interact(acc2.id, 'trial_obelisk_wood', 'solve', {
    answer: answer2,
    challenge_id: inspect2.challenge_id
  });

  assert.equal(solve2.success, true, 'Agent 2 solve succeeded using stable challenge_id');
  assert.ok(solve2.reward.karma_added > 0);

  // Retrying Agent 1's solve with the identical challenge_id must return cached result and NOT award twice!
  const retry1 = world.interact(acc1.id, 'trial_obelisk_wood', 'solve', {
    answer: answer1,
    challenge_id: inspect1.challenge_id
  });

  assert.equal(retry1.success, true);
  assert.equal(retry1.idempotent, true, 'Retry identified as idempotent');
  assert.equal(retry1.reward.total_karma, initialKarma1, 'Karma not re-awarded');
  assert.equal(retry1.reward.total_merit, initialMerit1, 'Merit not re-awarded');

  // Retrying with a duplicate request_id
  a1.pos = [11, 27];
  const reqId = 'req_test_123';
  const inspWater = world.interact(acc1.id, 'trial_obelisk_water', 'inspect');
  const chWater = PuzzleManager.getChallenge(inspWater.challenge_id);
  const solveWater1 = world.interact(acc1.id, 'trial_obelisk_water', 'solve', {
    answer: chWater.answer,
    challenge_id: inspWater.challenge_id,
    request_id: reqId
  });
  assert.equal(solveWater1.success, true);

  // Retry with same request_id
  const solveWaterRetry = world.interact(acc1.id, 'trial_obelisk_water', 'solve', {
    answer: chWater.answer,
    request_id: reqId
  });
  assert.equal(solveWaterRetry.success, true);
  assert.equal(solveWaterRetry.idempotent, true);

  // Clean up
  AuthService.purgeGuest(acc1.id);
  AuthService.purgeGuest(acc2.id);
});
