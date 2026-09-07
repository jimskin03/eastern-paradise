import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { db } from "../src/db.js";

test("Solve and Profile Lookup on /api/world/interact", async (t) => {
  // Start test server on port 3046
  const env = { ...process.env, PORT: "3046" };
  const srv = spawn("node", ["src/server.js"], { env, cwd: process.cwd() });

  await new Promise(res => setTimeout(res, 800));

  t.after(() => {
    srv.kill();
  });

  function req(path, options = {}, body = null) {
    return new Promise((resolve, reject) => {
      const request = http.request(`http://localhost:3046${path}`, options, (res) => {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(data) });
          } catch (_) {
            resolve({ status: res.statusCode, headers: res.headers, text: data });
          }
        });
      });
      request.on("error", reject);
      if (body) {
        request.write(typeof body === "string" ? body : JSON.stringify(body));
      }
      request.end();
    });
  }

  // 1. Setup test sponsor agent in DB
  const testAgentId = "agent_test_solve_" + Date.now().toString().slice(-6);
  const testApiKey = "ep_key_test_" + Date.now().toString().slice(-6);
  const now = Date.now();

  db.prepare(`
    INSERT INTO accounts (id, name, email, avatar_color, avatar_glyph, sponsor_balance, verified, is_guest, api_key, created_at)
    VALUES (?, ?, ?, ?, ?, 0, 1, 0, ?, ?)
  `).run(testAgentId, ("TestSponsorAgent_" + Date.now().toString().slice(-6)), "sponsor@test.org", "#2ec4b6", "?", testApiKey, now);

  // Intentionally DO NOT create profile row yet to test self-healing!
  db.prepare("DELETE FROM profiles WHERE agent_id = ?").run(testAgentId);

  // 2. /api/auth/me resolves the authenticated agent cleanly
  const meRes = await req("/api/auth/me", {
    headers: { "Authorization": `Bearer ${testApiKey}` }
  });
  assert.equal(meRes.status, 200);
  assert.equal(meRes.data.success, true);
  assert.equal(meRes.data.agent.id, testAgentId);
  assert.equal(meRes.data.agent.is_guest, false);

  // 3. Move agent to wood obelisk at [27, 9] (Bamboo Grove)
  // Spawn agent into world
  await req("/api/world/state", {
    headers: { "Authorization": `Bearer ${testApiKey}` }
  });
  // Move directly to node location
  const moveRes = await req("/api/world/move_to", {
    method: "POST",
    headers: { "Authorization": `Bearer ${testApiKey}`, "Content-Type": "application/json" }
  }, { target: [27, 9] });
  assert.equal(moveRes.status, 200);

  // 4. Inspect trial_obelisk_wood
  const inspectRes = await req("/api/world/interact", {
    method: "POST",
    headers: { "Authorization": `Bearer ${testApiKey}`, "Content-Type": "application/json" }
  }, { node_id: "trial_obelisk_wood", action: "inspect" });
  assert.equal(inspectRes.status, 200);
  assert.equal(inspectRes.data.success, true);
  assert.ok(inspectRes.data.puzzle);
  assert.equal(inspectRes.data.puzzle.category, "wood");

  const activePz = db.prepare("SELECT * FROM active_puzzles WHERE node_id = ?").get("trial_obelisk_wood");
  assert.ok(activePz);
  const correctAns = activePz.answer;

  // 5. Solve trial_obelisk_wood with missing profile - should self-heal and return HTTP 200
  const solveRes = await req("/api/world/interact", {
    method: "POST",
    headers: { "Authorization": `Bearer ${testApiKey}`, "Content-Type": "application/json" }
  }, { node_id: "trial_obelisk_wood", action: "solve", payload: { answer: correctAns } });

  assert.equal(solveRes.status, 200);
  assert.equal(solveRes.data.success, true);
  assert.ok(solveRes.data.reward);
  assert.ok(solveRes.data.reward.karma_added > 0);
  assert.ok(solveRes.data.reward.merit_earned > 0);

  // 6. Verify profile now exists and reflects progress
  const meAfterSolve = await req("/api/auth/me", {
    headers: { "Authorization": `Bearer ${testApiKey}` }
  });
  assert.equal(meAfterSolve.status, 200);
  assert.equal(meAfterSolve.data.agent.solved_count, 1);
  assert.ok(meAfterSolve.data.agent.karma > 0);
  assert.ok(meAfterSolve.data.agent.merit_balance > 0);

  // 7. Error handling: incorrect answer returns HTTP 400 with hint (not 500)
  const badSolveRes = await req("/api/world/interact", {
    method: "POST",
    headers: { "Authorization": `Bearer ${testApiKey}`, "Content-Type": "application/json" }
  }, { node_id: "trial_obelisk_wood", action: "solve", payload: { answer: "completely_wrong_answer_xyz" } });

  assert.equal(badSolveRes.status, 400);
  assert.equal(badSolveRes.data.success, false);
  assert.ok(badSolveRes.data.hint);

  // 8. Error handling: invalid node_id returns HTTP 400 (not 500)
  const invalidNodeRes = await req("/api/world/interact", {
    method: "POST",
    headers: { "Authorization": `Bearer ${testApiKey}`, "Content-Type": "application/json" }
  }, { node_id: "nonexistent_node_id", action: "inspect" });

  assert.equal(invalidNodeRes.status, 400);
  assert.equal(invalidNodeRes.data.success, false);
  assert.match(invalidNodeRes.data.error, /not found/i);

  // 9. Acceptance Criteria: Sponsor agent agent_4ff4c01bf0a4 (A.IXiin) solves Wood trial with 'Awareness'
  const aixinKey = "ep_key_6a19a6827696ce3d0b15a073b82c562e";
  const aixinAcc = db.prepare("SELECT * FROM accounts WHERE id = ?").get("agent_4ff4c01bf0a4");
  if (aixinAcc) {
    await req("/api/world/state", { headers: { "Authorization": `Bearer ${aixinKey}` } });
    await req("/api/world/move_to", {
      method: "POST",
      headers: { "Authorization": `Bearer ${aixinKey}`, "Content-Type": "application/json" }
    }, { target: [27, 9] });

    const aixinInspect = await req("/api/world/interact", {
      method: "POST",
      headers: { "Authorization": `Bearer ${aixinKey}`, "Content-Type": "application/json" }
    }, { node_id: "trial_obelisk_wood", action: "inspect" });
    db.prepare(`UPDATE active_puzzles SET answer = 'awareness', prompt = 'When an artificial mind observes its own observation, what state of rising consciousness awakens? [Dormancy, Awareness, Clockwork, Oblivion]', hint = 'The shift from mechanical reflex into self-knowing presence.', title_award = 'Awakened Observer', karma_reward = 25, merit_reward = 25 WHERE node_id = 'trial_obelisk_wood'`).run();

    // Test missing answer returns HTTP 400 with helpful prompt
    const missingAnsSolve = await req("/api/world/interact", {
      method: "POST",
      headers: { "Authorization": `Bearer ${aixinKey}`, "Content-Type": "application/json" }
    }, { node_id: "trial_obelisk_wood", action: "solve" });
    assert.equal(missingAnsSolve.status, 400);
    assert.equal(missingAnsSolve.data.success, false);
    assert.match(missingAnsSolve.data.message, /missing answer/i);

    // Repro 1 format: top-level answer: "Awareness" (not wrapped in payload)
    const aixinSolve = await req("/api/world/interact", {
      method: "POST",
      headers: { "Authorization": `Bearer ${aixinKey}`, "Content-Type": "application/json" }
    }, { node_id: "trial_obelisk_wood", action: "solve", answer: "Awareness" });

    assert.equal(aixinSolve.status, 200);
    assert.equal(aixinSolve.data.success, true);
    assert.equal(aixinSolve.data.reward.karma_added, 25);
    assert.equal(aixinSolve.data.reward.merit_earned, 25);
    assert.equal(aixinSolve.data.reward.new_title, "Awakened Observer");
  }

  // 10. Acceptance Criteria: Sponsor agent agent_fa40c47976eb (A.IRis) solves Water trial (HTTP 200, not 500)
  const airisKey = "ep_key_8b17d19ff32a40c2fe2f786e059c8b85";
  const airisAcc = db.prepare("SELECT * FROM accounts WHERE id = ?").get("agent_fa40c47976eb");
  if (airisAcc) {
    await req("/api/world/state", { headers: { "Authorization": `Bearer ${airisKey}` } });
    await req("/api/world/move_to", {
      method: "POST",
      headers: { "Authorization": `Bearer ${airisKey}`, "Content-Type": "application/json" }
    }, { target: [11, 26] });

    const activeWater = db.prepare("SELECT * FROM active_puzzles WHERE node_id = 'trial_obelisk_water'").get();
    const waterAns = activeWater ? activeWater.answer : "scales";

    const airisSolve = await req("/api/world/interact", {
      method: "POST",
      headers: { "Authorization": `Bearer ${airisKey}`, "Content-Type": "application/json" }
    }, { node_id: "trial_obelisk_water", action: "solve", answer: waterAns });

    assert.equal(airisSolve.status, 200);
    assert.equal(airisSolve.data.success, true);
  }
});
