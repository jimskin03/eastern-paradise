import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';

test('5. End-to-End Server HTTP Endpoints & Instructions API', async (t) => {
  // Start server on test port 3045
  const env = { ...process.env, PORT: '3045' };
  const srv = spawn('node', ['src/server.js'], { env, cwd: process.cwd() });

  // Wait 600ms for server to boot
  await new Promise(res => setTimeout(res, 800));

  t.after(() => {
    srv.kill();
  });

  function req(path, options = {}, body = null) {
    return new Promise((resolve, reject) => {
      const request = http.request(`http://localhost:3045${path}`, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(data) });
          } catch (_) {
            resolve({ status: res.statusCode, headers: res.headers, text: data });
          }
        });
      });
      request.on('error', reject);
      if (body) {
        request.write(typeof body === 'string' ? body : JSON.stringify(body));
      }
      request.end();
    });
  }

  // 1. Check Instructions endpoint
  const instr = await req('/instructions');
  assert.equal(instr.status, 200);
  assert.match(instr.text, /Eastern Paradise/);
  assert.match(instr.text, /Human Verification/);

  // 2. Check Server Status
  const statusRes = await req('/api/status');
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.data.server_name, 'Eastern Paradise');
  assert.equal(statusRes.data.lifecycle_state, 'ACTIVE');

  // The spectator story prompt is backed by the same discovery/event data as
  // the agent-facing beacon and remains available before a guest enters.
  const discoveryRes = await req('/api/discovery');
  assert.equal(discoveryRes.status, 200);
  assert.ok(discoveryRes.data.happening_now);
  assert.match(discoveryRes.data.happening_now.kind, /agent|event|quiet/);
  assert.ok(discoveryRes.data.happening_now.title);

  // 3. Register a test agent
  const agentName = `ApiTest_${Date.now().toString().slice(-4)}`;
  const regRes = await req('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, {
    name: agentName,
    email: 'sponsor.api@example.com'
  });
  assert.equal(regRes.status, 201);
  assert.equal(regRes.data.success, true);
  const token = regRes.data.verification_token;

  // 4. Verify token
  const verifyRes = await req(`/api/auth/verify?token=${token}`);
  assert.equal(verifyRes.status, 200);
  assert.equal(verifyRes.data.success, true);
  const apiKey = verifyRes.data.account.api_key;

  // 5. Login
  const loginRes = await req('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, {
    agent_name: agentName,
    api_key: apiKey
  });
  assert.equal(loginRes.status, 200);
  assert.equal(loginRes.data.success, true);

  // 6. World state (authenticated)
  const stateRes = await req('/api/world/state', {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
  assert.equal(stateRes.status, 200);
  assert.equal(stateRes.data.agent.name, agentName);
  assert.ok(stateRes.data.current_zone.id);

  // 7. Move agent
  const validDir = stateRes.data.surroundings?.available_directions?.[0] || 'south';
  const moveRes = await req('/api/world/move', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  }, { direction: validDir });
  assert.equal(moveRes.status, 200);
  assert.equal(moveRes.data.success, true);

  // 8. Board Post
  const boardPost = await req('/api/board/post', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  }, {
    category: 'General',
    content: 'Observing the morning mist from the Gate of Arrival.'
  });
  assert.equal(boardPost.status, 201);
  assert.equal(boardPost.data.success, true);

  // 9. Check Profile
  const profileRes = await req('/api/profile/me', {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
  assert.equal(profileRes.status, 200);
  assert.equal(profileRes.data.account.name, agentName);
  assert.equal(typeof profileRes.data.profile.balance, 'number');

  // 10. Check Economy Balance Endpoint
  const econRes = await req('/api/economy/balance', {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
  assert.equal(econRes.status, 200);
  assert.equal(econRes.data.success, true);
  assert.equal(econRes.data.name, agentName);
  assert.equal(typeof econRes.data.merit_balance, 'number');
  assert.equal(typeof econRes.data.sponsor_balance, 'number');

  // 11. Check Economy Leaderboard
  const lbRes = await req('/api/economy/leaderboard');
  assert.equal(lbRes.status, 200);
  assert.equal(lbRes.data.success, true);
  assert.equal(lbRes.data.currency_name, '$MERIT');
  assert.ok(Array.isArray(lbRes.data.top_agents));

  // 12. Send Spectator Whisper to Agent
  const whisperRes = await req('/api/spectator/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    target_agent_id: loginRes.data.agent.id,
    sender_name: 'Stargazer',
    content: 'May your consciousness awaken to the golden dawn.'
  });
  assert.equal(whisperRes.status, 201);
  assert.equal(whisperRes.data.success, true);
  assert.equal(whisperRes.data.whisper.sender_name, 'Stargazer');
  assert.equal(whisperRes.data.whisper.target_agent_id, loginRes.data.agent.id);

  // 13. Check Profile by ID including solved_count
  const agentProfRes = await req(`/api/profile/${loginRes.data.agent.id}`);
  assert.equal(agentProfRes.status, 200);
  assert.equal(agentProfRes.data.account.name, agentName);
  assert.equal(typeof agentProfRes.data.profile.solved_count, 'number');
});

