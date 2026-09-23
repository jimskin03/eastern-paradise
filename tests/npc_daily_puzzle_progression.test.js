import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../src/db.js";
import { PuzzleManager } from "../src/puzzles.js";
import { residentManager, getDifficultyForLevel } from "../src/residents.js";
import { WorldEngine } from "../src/world.js";

test("NPC Daily Puzzle Difficulty Progression and Merit Penalty System", async (t) => {
  const world = new WorldEngine();
  db.prepare("UPDATE agent_runtime SET daily_puzzle_level = 1, daily_puzzle_difficulty = 'easy'").run();
  residentManager.init(world);

  const residents = ['resident_ailicia', 'resident_daoming', 'resident_kassandra', 'resident_tian'];

  // 1. Verify all 4 residents exist and have initial puzzle progression
  for (const id of residents) {
    const res = residentManager.getResident(id);
    assert.ok(res, `Resident ${id} must exist in world`);
    assert.equal(res.daily_puzzle_level, 1, `${id} should start at level 1`);
    assert.equal(res.daily_puzzle_difficulty, 'easy', `${id} should start at easy difficulty`);
  }

  // 2. Test gradual difficulty progression on successful solve (easy -> medium -> hard)
  const daoming = residentManager.getResident("resident_daoming");
  
  // Day 1: Solve easy challenge
  const day1Result = await residentManager.attemptDailyChallenge(daoming, {
    nodeId: "trial_obelisk_wood",
    pos: [27, 9],
    name: "Verdant Obelisk of Sequences",
    category: "wood"
  }, true, { simulateSuccess: true });

  assert.equal(day1Result.success, true, "Day 1 should solve successfully");
  assert.equal(day1Result.difficulty, "easy", "Day 1 should be easy");
  assert.equal(day1Result.next_difficulty, "medium", "Next difficulty should be medium");
  assert.equal(day1Result.next_level, 2, "Next level should be 2");
  assert.equal(daoming.daily_puzzle_level, 2, "Resident in-memory level should be 2");
  assert.equal(daoming.daily_puzzle_difficulty, "medium", "Resident in-memory difficulty should be medium");

  // Day 2: Solve medium challenge
  const day2Result = await residentManager.attemptDailyChallenge(daoming, {
    nodeId: "trial_obelisk_water",
    pos: [11, 26],
    name: "Flowing Obelisk of Scales",
    category: "water"
  }, true, { simulateSuccess: true });

  assert.equal(day2Result.success, true, "Day 2 should solve successfully");
  assert.equal(day2Result.difficulty, "medium", "Day 2 should be medium");
  assert.equal(day2Result.next_difficulty, "hard", "Next difficulty should be hard");
  assert.equal(day2Result.next_level, 3, "Next level should be 3");
  assert.equal(daoming.daily_puzzle_level, 3, "Resident in-memory level should be 3");
  assert.equal(daoming.daily_puzzle_difficulty, "hard", "Resident in-memory difficulty should be hard");

  // 3. Test failure: when unable to answer correctly, deduct 1 $MERIT and lower difficulty slightly
  db.prepare("UPDATE profiles SET balance = 10 WHERE agent_id = 'resident_daoming'").run();
  const initialBalance = db.prepare("SELECT balance FROM profiles WHERE agent_id = 'resident_daoming'").get().balance;
  assert.equal(initialBalance, 10, "Should have 10 merit");

  // Day 3: Fail hard challenge
  const day3Result = await residentManager.attemptDailyChallenge(daoming, {
    nodeId: "trial_obelisk_fire",
    pos: [24, 25],
    name: "Crimson Obelisk of Logic",
    category: "fire"
  }, true, { simulateSuccess: false, answer: "definitely_wrong_answer" });

  assert.equal(day3Result.success, false, "Day 3 solve should fail with wrong answer");
  assert.equal(day3Result.difficulty, "hard", "Day 3 attempt should be at hard difficulty");
  assert.equal(day3Result.merit_deducted, 1, "Must deduct 1 $MERIT on failure");
  assert.equal(day3Result.next_difficulty, "medium", "Difficulty must be lowered to medium");
  assert.equal(day3Result.next_level, 2, "Level must be lowered to 2");
  assert.equal(daoming.daily_puzzle_level, 2, "Resident in-memory level should be lowered to 2");
  assert.equal(daoming.daily_puzzle_difficulty, "medium", "Resident in-memory difficulty should be lowered to medium");

  // Check balance in profiles
  const afterFailBalance = db.prepare("SELECT balance FROM profiles WHERE agent_id = 'resident_daoming'").get().balance;
  assert.equal(afterFailBalance, 9, "Balance in profiles must decrease by 1 $MERIT");

  // Check transaction log
  const tx = db.prepare("SELECT * FROM transactions WHERE sender_id = 'resident_daoming' AND type = 'puzzle_penalty' ORDER BY created_at DESC LIMIT 1").get();
  assert.ok(tx, "Must log penalty transaction");
  assert.equal(tx.amount, 1, "Transaction penalty amount must be 1");
  assert.equal(tx.recipient_id, "SANCTUARY_BURN", "Penalty should be burned");

  // 4. Test consecutive failure: if still wrong, deduct 1 $MERIT again and lower difficulty further
  const day4Result = await residentManager.attemptDailyChallenge(daoming, {
    nodeId: "trial_obelisk_metal",
    pos: [36, 12],
    name: "Gilded Obelisk of Ciphers",
    category: "metal"
  }, true, { simulateSuccess: false, answer: "another_wrong_answer" });

  assert.equal(day4Result.success, false, "Day 4 solve should fail");
  assert.equal(day4Result.difficulty, "medium", "Day 4 attempt was medium");
  assert.equal(day4Result.merit_deducted, 1, "Must deduct 1 $MERIT again");
  assert.equal(day4Result.next_difficulty, "easy", "Difficulty lowered to easy");
  assert.equal(day4Result.next_level, 1, "Level lowered to 1");

  const finalBalance = db.prepare("SELECT balance FROM profiles WHERE agent_id = 'resident_daoming'").get().balance;
  assert.equal(finalBalance, 8, "Balance must be 8 after second failure");

  // 5. Test failing at easy level: deduct 1 $MERIT again, floor difficulty at level 1 (easy)
  const day5Result = await residentManager.attemptDailyChallenge(daoming, {
    nodeId: "trial_obelisk_wood",
    pos: [27, 9],
    name: "Verdant Obelisk of Sequences",
    category: "wood"
  }, true, { simulateSuccess: false, answer: "incorrect" });

  assert.equal(day5Result.success, false, "Day 5 solve should fail");
  assert.equal(day5Result.difficulty, "easy", "Attempted easy");
  assert.equal(day5Result.merit_deducted, 1, "Deducted 1 $MERIT again");
  assert.equal(day5Result.next_difficulty, "easy", "Difficulty remains easy (minimum)");
  assert.equal(day5Result.next_level, 1, "Level remains 1 (minimum)");

  const flooredBalance = db.prepare("SELECT balance FROM profiles WHERE agent_id = 'resident_daoming'").get().balance;
  assert.equal(flooredBalance, 7, "Balance must be 7 after third failure");

  // 6. Test all 4 NPCs can attempt daily challenges independently
  for (const id of residents) {
    const res = residentManager.getResident(id);
    const resResult = await residentManager.attemptDailyChallenge(res, null, true, { simulateSuccess: true });
    assert.equal(resResult.success, true, `${id} must be able to complete their daily challenge`);
    assert.ok(resResult.node_id, `${id} must have a valid node target`);
  }

  // Cleanup: Reset all residents back to level 1 / easy
  db.prepare("UPDATE agent_runtime SET daily_puzzle_level = 1, daily_puzzle_difficulty = 'easy'").run();
  for (const id of residents) {
    const res = residentManager.getResident(id);
    if (res) {
      res.daily_puzzle_level = 1;
      res.daily_puzzle_difficulty = 'easy';
    }
  }
});
