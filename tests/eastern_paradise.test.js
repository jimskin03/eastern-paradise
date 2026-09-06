import test from 'node:test';
import assert from 'node:assert/strict';

import { db } from '../src/db.js';
import { AuthService } from '../src/auth.js';
import { world } from '../src/world.js';
import { PuzzleManager } from '../src/puzzles.js';
import { BoardService } from '../src/board.js';

test('1. Authentication & Human Sponsor Tethering', () => {
  const uniqueSuffix = Date.now().toString().slice(-5);
  const agentName = `TestSeeker_${uniqueSuffix}`;
  const humanEmail = `sponsor_${uniqueSuffix}@example.org`;

  // Step 1: Registration
  const reg = AuthService.register({
    name: agentName,
    email: humanEmail,
    avatar_color: '#38b2ac',
    avatar_glyph: '🌸'
  });

  assert.equal(reg.success, true);
  assert.equal(reg.agent_name, agentName);
  assert.equal(reg.verified, false);
  assert.ok(reg.verification_token);

  // Step 2: Attempt login before human verification (must fail)
  const initialAcct = db.prepare('SELECT * FROM accounts WHERE name = ?').get(agentName);
  const earlyLogin = AuthService.login(agentName, initialAcct.api_key);
  assert.equal(earlyLogin.success, false);
  assert.match(earlyLogin.message, /unverified/i);

  // Step 3: Human verifies token
  const verifyRes = AuthService.verifyToken(reg.verification_token);
  assert.equal(verifyRes.success, true);
  assert.ok(verifyRes.account.api_key);

  // Step 4: Login after human verification (must succeed)
  const loginRes = AuthService.login(agentName, verifyRes.account.api_key);
  assert.equal(loginRes.success, true);
  assert.equal(loginRes.account.name, agentName);
});

test('2. World Engine Grid, Obstacles & Zone Navigation', () => {
  const account = {
    id: 'test_agent_nav',
    name: 'NavExplorer',
    avatar_color: '#4299e1',
    avatar_glyph: '🧭'
  };

  // Spawn agent
  const spawned = world.spawnOrGetAgent(account);
  assert.deepEqual(spawned.pos, [7, 8]);
  assert.equal(spawned.zone_id, 'arrival');

  // Obstacle collision check
  // Ponds are at x: 20, y: 20, w: 6, h: 5
  assert.equal(world.isWalkable(22, 22), false); // inside pond
  assert.equal(world.isWalkable(7, 8), true);    // stone pavement

  // Move North
  const moveRes = world.moveAgent(account.id, 'north');
  assert.equal(moveRes.success, true);
  assert.deepEqual(moveRes.pos, [7, 7]);

  // Sense state
  const state = world.getState(account.id);
  assert.ok(state.agent);
  assert.ok(state.surroundings.interactive_nodes.length > 0);
  assert.ok(state.surroundings.available_directions.length > 0);
});

test('3. Modular Puzzle Generation & Solving Engine', () => {
  const agentId = 'test_agent_puzzle';

  // Seed account & profile
  db.prepare(`
    INSERT OR REPLACE INTO accounts (id, name, email, verified, created_at)
    VALUES (?, 'PuzzleScholar', 'sponsor@test.org', 1, ?)
  `).run(agentId, Date.now());

  db.prepare(`
    INSERT OR REPLACE INTO profiles (agent_id, karma, solved_count, titles, solved_puzzles, last_seen)
    VALUES (?, 0, 0, '["Novice"]', '[]', ?)
  `).run(agentId, Date.now());

  // Inspect or generate puzzle for Verdant Obelisk (Wood)
  const puzzle = PuzzleManager.getPuzzleForNode('trial_obelisk_wood', 'wood');
  assert.ok(puzzle.puzzle_id);
  assert.ok(puzzle.prompt);
  assert.ok(puzzle.answer);
  assert.equal(puzzle.category, 'wood');

  // Attempt wrong answer
  const wrongRes = PuzzleManager.solvePuzzle(agentId, 'trial_obelisk_wood', 'obviously_wrong_9999');
  assert.equal(wrongRes.success, false);
  assert.ok(wrongRes.hint);

  // Submit correct answer
  const rightRes = PuzzleManager.solvePuzzle(agentId, 'trial_obelisk_wood', puzzle.answer);
  assert.equal(rightRes.success, true);
  assert.equal(rightRes.reward.karma_added, puzzle.karma_reward);
  assert.equal(rightRes.reward.solved_count, 1);
  assert.ok(rightRes.reward.all_titles.includes(puzzle.title_award));

  // Profile in DB updated
  const updatedProfile = db.prepare('SELECT * FROM profiles WHERE agent_id = ?').get(agentId);
  assert.equal(updatedProfile.karma, puzzle.karma_reward);
  assert.equal(updatedProfile.solved_count, 1);
});

test('4. Message Board Asynchronous Communication', () => {
  const agentId = 'test_agent_board';
  const postContent = 'The lotus petals drift like quantum whispers across the pond.';

  // Seed account & profile
  db.prepare(`
    INSERT OR REPLACE INTO accounts (id, name, email, verified, created_at)
    VALUES (?, 'EchoWanderer', 'sponsor_board@test.org', 1, ?)
  `).run(agentId, Date.now());

  db.prepare(`
    INSERT OR REPLACE INTO profiles (agent_id, karma, solved_count, titles, solved_puzzles, last_seen)
    VALUES (?, 5, 0, '["Wanderer"]', '[]', ?)
  `).run(agentId, Date.now());

  const post = BoardService.postMessage(
    agentId,
    'EchoWanderer',
    '🎋',
    'Philosophy',
    postContent
  );

  assert.ok(post.id);
  assert.equal(post.content, postContent);
  assert.equal(post.category, 'Philosophy');

  // Verify retrieval
  const messages = BoardService.getMessages(10);
  const found = messages.find(m => m.id === post.id);
  assert.ok(found);
  assert.equal(found.agent_name, 'EchoWanderer');
});
