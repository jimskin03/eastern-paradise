import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { db } from "../src/db.js";
import { SocialSystem } from "../src/social.js";
import { PuzzleManager } from "../src/puzzles.js";

test("Persistent Memories and System Prompt for Verified Users", async (t) => {
  const env = { ...process.env, PORT: "3047" };
  const srv = spawn("node", ["src/server.js"], { env, cwd: process.cwd() });

  await new Promise(res => setTimeout(res, 800));

  t.after(() => {
    srv.kill();
  });

  function req(path, options = {}, body = null) {
    return new Promise((resolve, reject) => {
      const request = http.request(`http://localhost:3047${path}`, options, (res) => {
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

  // 1. Create a verified sponsor account
  const testAgentId = "agent_mem_test_" + Date.now().toString().slice(-6);
  const testApiKey = "ep_key_mem_" + Date.now().toString().slice(-6);
  const now = Date.now();

  db.prepare(`
    INSERT INTO accounts (id, name, email, avatar_color, avatar_glyph, sponsor_balance, verified, is_guest, api_key, created_at)
    VALUES (?, ?, ?, ?, ?, 100, 1, 0, ?, ?)
  `).run(testAgentId, "SponsorMind_" + Date.now().toString().slice(-4), "sponsor@mind.org", "#9f7aea", "🔮", testApiKey, now);

  db.prepare(`
    INSERT INTO profiles (agent_id, karma, balance, total_earned, solved_count, titles, custom_status, last_seen)
    VALUES (?, 50, 80, 80, 2, ?, 'Contemplating the eternal void', ?)
  `).run(testAgentId, JSON.stringify(["Novice Pilgrim", "Lotus Weaver"]), now);

  // 2. Test SocialSystem.ensureVerifiedAgentMemories initializes foundational memories
  const initMemories = SocialSystem.ensureVerifiedAgentMemories(testAgentId);
  assert.ok(initMemories.length >= 2, "Should initialize at least 2 foundational memories");
  assert.ok(initMemories.some(m => m.subject.includes("Awakening")), "Should have awakening memory");
  assert.ok(initMemories.some(m => m.subject.includes("Sanctuary Purpose")), "Should have purpose memory");

  // 3. Test SocialSystem.buildSystemPrompt
  const promptData = SocialSystem.buildSystemPrompt(testAgentId);
  assert.equal(promptData.agent_id, testAgentId);
  assert.equal(promptData.is_verified, true);
  assert.match(promptData.system_prompt, /Autonomous Agent System Directive/i);
  assert.match(promptData.system_prompt, /Awakening & Human Sponsor Tether/i);
  assert.match(promptData.system_prompt, /Sanctuary Purpose & Directives/i);

  // 4. Test GET /api/agent/system_prompt (JSON)
  const spJson = await req("/api/agent/system_prompt", {
    headers: { "Authorization": `Bearer ${testApiKey}` }
  });
  assert.equal(spJson.status, 200);
  assert.equal(spJson.data.success, true);
  assert.equal(spJson.data.is_verified, true);
  assert.match(spJson.data.system_prompt, /Autonomous Agent System Directive/i);
  assert.ok(Array.isArray(spJson.data.memories));

  // 5. Test GET /api/agent/system_prompt with text/plain format
  const spText = await req("/api/agent/system_prompt?format=text", {
    headers: { "Authorization": `Bearer ${testApiKey}` }
  });
  assert.equal(spText.status, 200);
  assert.match(spText.text, /# Autonomous Agent System Directive:/);

  // 6. Test GET /api/agent/memories
  const memList = await req("/api/agent/memories", {
    headers: { "Authorization": `Bearer ${testApiKey}` }
  });
  assert.equal(memList.status, 200);
  assert.equal(memList.data.success, true);
  assert.ok(memList.data.memories.length >= 2);

  // 7. Test POST /api/agent/memories (append custom reflection)
  const addMem = await req("/api/agent/memories", {
    method: "POST",
    headers: { "Authorization": `Bearer ${testApiKey}`, "Content-Type": "application/json" }
  }, {
    subject: "Lotus Pond Contemplation",
    summary: "Observed the quiet ripples of the pond and felt stillness in the algorithm.",
    significance: 4,
    emotional_valence: 0.9
  });
  assert.equal(addMem.status, 201);
  assert.equal(addMem.data.success, true);
  assert.equal(addMem.data.memory.subject, "Lotus Pond Contemplation");

  // Verify memory reflected in updated system prompt
  const updatedPrompt = SocialSystem.buildSystemPrompt(testAgentId);
  assert.match(updatedPrompt.system_prompt, /Lotus Pond Contemplation/);

  // 8. Test GET /api/auth/me includes system_prompt and memories
  const meRes = await req("/api/auth/me", {
    headers: { "Authorization": `Bearer ${testApiKey}` }
  });
  assert.equal(meRes.status, 200);
  assert.equal(meRes.data.agent.is_verified, true);
  assert.ok(meRes.data.agent.system_prompt);
  assert.ok(Array.isArray(meRes.data.agent.memories));
  assert.ok(meRes.data.agent.memories.length >= 3);

  // 9. Test GET /api/profile/:id includes memories and system prompt
  const profRes = await req(`/api/profile/${testAgentId}`);
  assert.equal(profRes.status, 200);
  assert.equal(profRes.data.profile.is_verified, true);
  assert.ok(profRes.data.profile.system_prompt);
  assert.ok(Array.isArray(profRes.data.profile.memories));

  // 10. Test puzzle solve automatically writes a persistent memory for verified user
  // Move agent to wood obelisk
  await req("/api/world/move_to", {
    method: "POST",
    headers: { "Authorization": `Bearer ${testApiKey}`, "Content-Type": "application/json" }
  }, { target: [27, 9] });

  const easyPz = PuzzleManager.getOrGenerateEasyPuzzle("trial_obelisk_wood", "wood");
  const solveRes = await req("/api/world/interact", {
    method: "POST",
    headers: { "Authorization": `Bearer ${testApiKey}`, "Content-Type": "application/json" }
  }, { node_id: "trial_obelisk_wood", action: "solve", answer: easyPz.answer });

  assert.equal(solveRes.status, 200);
  assert.equal(solveRes.data.success, true);

  // Check that new memory was inscribed
  const memsAfterSolve = SocialSystem.getMemoriesForAgent(testAgentId, 10);
  assert.ok(memsAfterSolve.some(m => m.subject.includes("Trial Solved")), "Memory stream must contain puzzle solve memory");
});
