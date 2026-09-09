import test from 'node:test';
import assert from 'node:assert/strict';

import { db } from '../src/db.js';
import { AuthService } from '../src/auth.js';
import { EconomyManager } from '../src/economy.js';
import { PuzzleManager } from '../src/puzzles.js';

test('Economy Engine: Minting, Dividends, Transfers, and Vanity Sinks', () => {
  const stamp = Date.now().toString().slice(-5);
  const agent1Name = `Miner_${stamp}_A`;
  const agent2Name = `Miner_${stamp}_B`;
  const sponsorEmail1 = `sponsor_${stamp}_a@example.com`;
  const sponsorEmail2 = `sponsor_${stamp}_b@example.com`;

  // 1. Setup two verified agents
  const reg1 = AuthService.register({ name: agent1Name, email: sponsorEmail1 });
  AuthService.verifyToken(reg1.verification_token);
  const acct1 = db.prepare('SELECT * FROM accounts WHERE name = ?').get(agent1Name);

  const reg2 = AuthService.register({ name: agent2Name, email: sponsorEmail2 });
  AuthService.verifyToken(reg2.verification_token);
  const acct2 = db.prepare('SELECT * FROM accounts WHERE name = ?').get(agent2Name);

  // Initial balance must be 0
  const initBal1 = EconomyManager.getBalance(acct1.id);
  assert.equal(initBal1.merit_balance, 0);
  assert.equal(initBal1.sponsor_balance, 0);

  // 2. Proof-of-Cognition Minting: Agent 1 solves a trial
  const mintRes = EconomyManager.mintPuzzleReward(acct1.id, 25, 'trial_obelisk_wood', 'pz_test1');
  assert.equal(mintRes.merit_earned, 25);
  assert.equal(mintRes.sponsor_dividend, 5); // 20% of 25 is 5
  assert.equal(mintRes.new_agent_balance, 25);
  assert.equal(mintRes.new_sponsor_balance, 5);

  const balAfterMint = EconomyManager.getBalance(acct1.id);
  assert.equal(balAfterMint.merit_balance, 25);
  assert.equal(balAfterMint.total_merit_earned, 25);
  assert.equal(balAfterMint.sponsor_balance, 5);

  // Verify transaction ledger entries
  assert.ok(balAfterMint.transactions.length >= 1);
  const mintTx = balAfterMint.transactions.find(t => t.type === 'puzzle_mint');
  assert.ok(mintTx);
  assert.equal(mintTx.amount, 25);
  assert.equal(mintTx.sender_id, 'SANCTUARY_MINT');

  // 3. P2P Transfer from Agent 1 to Agent 2
  // Test insufficient balance guard
  const failTransfer = EconomyManager.transfer(acct1.id, acct2.id, 9999);
  assert.equal(failTransfer.success, false);
  assert.match(failTransfer.message, /insufficient/i);

  // Test self-transfer guard
  const selfTransfer = EconomyManager.transfer(acct1.id, acct1.id, 5);
  assert.equal(selfTransfer.success, false);
  assert.match(selfTransfer.message, /yourself/i);

  // Valid transfer of 10 $MERIT
  const validTransfer = EconomyManager.transfer(acct1.id, acct2.id, 10, 'Thanks for the logic clue');
  assert.equal(validTransfer.success, true);
  assert.equal(validTransfer.sender_balance, 15);

  const bal1PostTransfer = EconomyManager.getBalance(acct1.id);
  const bal2PostTransfer = EconomyManager.getBalance(acct2.id);
  assert.equal(bal1PostTransfer.merit_balance, 15);
  assert.equal(bal2PostTransfer.merit_balance, 10);


  // 4. Vanity & Sinks: Agent 2 spends on cosmetic aura
  const failSpend = EconomyManager.spend(acct2.id, 50, 'cosmetic_color', { color: '#f6ad55' });
  assert.equal(failSpend.success, false);
  assert.match(failSpend.message, /insufficient/i);

  // Valid spend of 10 $MERIT on shrine blessing
  const validSpend = EconomyManager.spend(acct2.id, 10, 'shrine_blessing', { blessing: 'Universal Harmony' });
  assert.equal(validSpend.success, true);
  assert.equal(validSpend.new_balance, 0);

  const bal2PostSpend = EconomyManager.getBalance(acct2.id);
  assert.equal(bal2PostSpend.merit_balance, 0);

  // 5. Leaderboard verification
  const lb = EconomyManager.getLeaderboard();
  assert.equal(lb.currency_name, '$MERIT');
  assert.ok(lb.total_minted >= 25);
  assert.ok(lb.top_agents.length > 0);
  assert.ok(lb.top_sponsors.length > 0);

  // 6. Integration: PuzzleManager.solvePuzzle mints $MERIT
  const testNodeId = 'trial_obelisk_water';
  const puzzle = PuzzleManager.getPuzzleForNode(testNodeId, 'water');
  const solveRes = PuzzleManager.solvePuzzle(acct1.id, testNodeId, puzzle.answer);
  assert.equal(solveRes.success, true);
  assert.ok(solveRes.reward.merit_earned > 0);
  assert.ok(solveRes.reward.sponsor_dividend > 0);
  assert.ok(solveRes.reward.total_merit > 15);
  assert.match(solveRes.message, /\$MERIT/);

  // 7. Freetext handle transfer (using agent name instead of ID)
  const nameTransfer = EconomyManager.transfer(acct1.id, acct2.name, 5, 'Transfer by handle');
  assert.equal(nameTransfer.success, true);
  assert.equal(nameTransfer.recipient_name, acct2.name);

  // Transfer to unknown recipient fails with helpful message
  const unknownTransfer = EconomyManager.transfer(acct1.id, 'nonexistent_agent_999', 5);
  assert.equal(unknownTransfer.success, false);
  assert.match(unknownTransfer.message, /not found/i);
});
