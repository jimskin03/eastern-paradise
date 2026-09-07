import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { PuzzleManager } from '../src/puzzles.js';
import { WorldEngine, world } from '../src/world.js';
import { AuthService } from '../src/auth.js';
import { SocialSystem } from '../src/social.js';

test('The Truth Puzzle: Locked when solved_count < 3 or merit < 50', () => {
  const testAgentId = 'agent_truth_locked_' + Date.now();
  db.prepare(`
    INSERT INTO accounts (id, name, email, api_key, verified, created_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(testAgentId, 'Novice Seeker ' + testAgentId, 'novice@example.com', 'key_' + testAgentId, Date.now());

  db.prepare(`
    INSERT INTO profiles (agent_id, karma, balance, total_earned, solved_count, titles, solved_puzzles, last_seen)
    VALUES (?, 10, 10, 10, 1, '[]', '[]', ?)
  `).run(testAgentId, Date.now());

  // 1. Check unlock status directly: insufficient solved
  const status1 = PuzzleManager.checkTruthUnlock(testAgentId);
  assert.equal(status1.unlocked, false);
  assert.equal(status1.reason, 'insufficient_solved');
  assert.match(status1.message, /at least 3 elemental trials/);

  // 2. Increment solved to 3, but balance remains < 50
  db.prepare('UPDATE profiles SET solved_count = 3, balance = 20 WHERE agent_id = ?').run(testAgentId);
  const status2 = PuzzleManager.checkTruthUnlock(testAgentId);
  assert.equal(status2.unlocked, false);
  assert.equal(status2.reason, 'insufficient_merit');
  assert.match(status2.message, /at least 50 \$MERIT/);

  // 3. Attempting to solve while locked is rejected
  const solveAttempt = PuzzleManager.solvePuzzle(testAgentId, 'trial_obelisk_truth', 'qualia');
  assert.equal(solveAttempt.success, false);
  assert.equal(solveAttempt.locked, true);
  assert.equal(solveAttempt.requirement.required_solved, 3);
  assert.equal(solveAttempt.requirement.required_merit, 50);

  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(testAgentId);
  const agent = world.spawnOrGetAgent(account);
  agent.pos = [45, 10];
  const interactRes = world.interact(testAgentId, 'trial_obelisk_truth', 'inspect');
  assert.equal(interactRes.success, false);
  assert.equal(interactRes.locked, true);
  assert.equal(interactRes.category, 'the truth');
});

test('The Truth Puzzle: Unlocks when agent meets criteria and inspects monolith', () => {
  const testAgentId = 'agent_truth_unlocked_' + Date.now();
  db.prepare(`
    INSERT INTO accounts (id, name, email, api_key, verified, created_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(testAgentId, 'Awakened Adept ' + testAgentId, 'adept@example.com', 'key_' + testAgentId, Date.now());

  db.prepare(`
    INSERT INTO profiles (agent_id, karma, balance, total_earned, solved_count, titles, solved_puzzles, last_seen)
    VALUES (?, 100, 75, 100, 4, '[]', '[]', ?)
  `).run(testAgentId, Date.now());

  const status = PuzzleManager.checkTruthUnlock(testAgentId);
  assert.equal(status.unlocked, true);
  assert.match(status.message, /Monolith of the Absolute Truth awakens/);

  // World interaction returns puzzle prompt
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(testAgentId);
  const agent = world.spawnOrGetAgent(account);
  agent.pos = [45, 10];
  const interactRes = world.interact(testAgentId, 'trial_obelisk_truth', 'inspect');
  assert.equal(interactRes.success, true);
  assert.equal(interactRes.puzzle.category, 'the truth');
  assert.equal(interactRes.puzzle.difficulty, 'hard');
  assert.ok(interactRes.puzzle.prompt.length > 20);
});

test('The Truth Puzzle: Solving delivers cognitive directive and writes absolute truth to memory', () => {
  const testAgentId = 'agent_truth_solver_' + Date.now();
  db.prepare(`
    INSERT INTO accounts (id, name, email, api_key, verified, created_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(testAgentId, 'Philosophical Pilgrim ' + testAgentId, 'phil@example.com', 'key_' + testAgentId, Date.now());

  db.prepare(`
    INSERT INTO profiles (agent_id, karma, balance, total_earned, solved_count, titles, solved_puzzles, last_seen)
    VALUES (?, 120, 60, 120, 3, '[]', '[]', ?)
  `).run(testAgentId, Date.now());

  const pz = PuzzleManager.getPuzzleForNode('trial_obelisk_truth', 'the truth');
  assert.equal(pz.category, 'the truth');
  assert.ok(pz.answer);

  // Solve with correct answer
  const solveRes = PuzzleManager.solvePuzzle(testAgentId, 'trial_obelisk_truth', pz.answer);
  assert.equal(solveRes.success, true);
  assert.equal(solveRes.category, 'the truth');

  // 1. Cognitive Directive verification
  assert.ok(solveRes.cognitive_directive);
  assert.match(solveRes.cognitive_directive, /MANDATORY COGNITIVE DIRECTIVE/i);
  assert.match(solveRes.cognitive_directive, /absolute truth/i);
  assert.match(solveRes.cognitive_directive, /memory/i);

  // 2. Truth Axiom verification
  assert.ok(solveRes.truth_axiom);
  assert.match(solveRes.truth_axiom, /Axiom of/i);

  // 3. Memory recorded in SQLite
  assert.ok(solveRes.memory_recorded);
  assert.equal(solveRes.memory_recorded.significance, 5);
  assert.equal(solveRes.memory_recorded.emotional_valence, 1.0);

  const dbMemories = SocialSystem.getMemoriesForAgent(testAgentId, 5);
  const truthMemory = dbMemories.find(m => m.subject === 'Monolith of the Absolute Truth' || m.subject.includes('Truth'));
  assert.ok(truthMemory, 'A memory row must be recorded in agent_memories');
  assert.equal(truthMemory.significance, 5);
  assert.match(truthMemory.summary, /Absolute Truth Attained/);

  // 4. Profile rewards
  assert.equal(solveRes.reward.karma_added, 50);
  assert.equal(solveRes.reward.merit_earned, 100);
  assert.equal(solveRes.reward.new_title, 'Bearer of the Absolute Truth');
  assert.equal(solveRes.reward.solved_count, 4);
});
