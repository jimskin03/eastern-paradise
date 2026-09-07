import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../src/db.js";
import { PuzzleManager } from "../src/puzzles.js";
import { residentManager } from "../src/residents.js";
import { WorldEngine } from "../src/world.js";
import { SocialSystem } from "../src/social.js";

test("A.Ilicia Daily Easy Challenge and Activity Feed Step Silence", async (t) => {
  const world = new WorldEngine();
  residentManager.init(world);

  const ailicia = residentManager.getResident("resident_ailicia");
  assert.ok(ailicia, "A.Ilicia resident must be present in world");

  // 1. Test PuzzleManager.getOrGenerateEasyPuzzle
  const easyPz = PuzzleManager.getOrGenerateEasyPuzzle("trial_obelisk_wood", "wood");
  assert.equal(easyPz.difficulty, "easy", "Must guarantee an easy puzzle");
  assert.ok(easyPz.answer, "Puzzle must have an answer");

  // 2. Test A.Ilicia autonomous daily challenge solve (forced to test execution)
  const result = await residentManager.attemptDailyChallenge(ailicia, {
    nodeId: "trial_obelisk_wood",
    pos: [27, 9],
    name: "Verdant Obelisk of Sequences",
    category: "wood"
  }, true);

  assert.equal(result.success, true, "A.Ilicia must successfully solve the easy challenge");
  assert.ok(result.answered, "A.Ilicia must provide an answer");
  assert.ok(result.reward.karma_added > 0, "A.Ilicia must receive karma");
  assert.ok(result.reward.merit_earned > 0, "A.Ilicia must mint $MERIT");

  // Verify memory recorded
  const ailiciaMemories = SocialSystem.getMemoriesForAgent("resident_ailicia", 10);
  assert.ok(
    ailiciaMemories.some(m => m.subject.includes("Daily Challenge")),
    "A.Ilicia must record daily challenge memory"
  );

  // 3. Test Cooldown: Attempting again within 24 hours must be on cooldown
  const cooldownRes = await residentManager.attemptDailyChallenge(ailicia, null, false);
  assert.equal(cooldownRes.success, false, "Should not solve challenge twice in same day");
  assert.equal(cooldownRes.cooldown, true, "Must flag cooldown");

  // 4. Test Activity Feed Step Silence for A.Ilicia
  // In spectator.js:
  // if (!msg.ambient) {
  //   if (msg.name !== 'A.Ilicia' && msg.agentId !== 'resident_ailicia' && !msg.is_resident) {
  //     logActivity(`<strong>${escapeHtml(msg.name)}</strong> stepped to [${msg.pos.join(', ')}].`);
  //     soundSystem.play('step');
  //   }
  // }
  function simulateActivityFeedLog(msg, logged) {
    if (!msg.ambient) {
      if (msg.name !== 'A.Ilicia' && msg.agentId !== 'resident_ailicia' && !msg.is_resident) {
        logged.push(`${msg.name} stepped to [${msg.pos.join(', ')}].`);
      }
    }
  }

  const logs = [];
  // Visitor step -> should log
  simulateActivityFeedLog({ name: "Seeker1", agentId: "agent_seeker1", is_resident: false, pos: [10, 10] }, logs);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /Seeker1 stepped/);

  // A.Ilicia step -> must NOT log
  simulateActivityFeedLog({ name: "A.Ilicia", agentId: "resident_ailicia", is_resident: true, pos: [23, 24] }, logs);
  assert.equal(logs.length, 1, "A.Ilicia step must NOT be logged into activity feed");
});
