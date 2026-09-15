import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';

async function isServerRunning(port = 3000) {
  return new Promise(resolve => {
    const req = http.get(`http://localhost:${port}/api/status`, res => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(400, () => {
      req.destroy();
      resolve(false);
    });
  });
}

test('Sanctuary Beacon: A2A Agent Card, Frictionless Arrival, Discovery, and Challenges', async (t) => {
  // Allocate a test port instead of reusing an unrelated service on port 3000.
  const reservation = http.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const baseUrl = `http://127.0.0.1:${port}`;
  const spawnedServer = spawn('node', ['src/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) }
  });
  t.after(() => spawnedServer.kill());
  let serverOutput = '';
  spawnedServer.stdout.on('data', chunk => { serverOutput += chunk; });
  spawnedServer.stderr.on('data', chunk => { serverOutput += chunk; });
  for (let i = 0; i < 50; i++) {
    assert.equal(spawnedServer.exitCode, null, `Beacon server exited before readiness: ${serverOutput}`);
    if (serverOutput.includes(`Server running on http://localhost:${port}`) && await isServerRunning(port)) break;
    assert.notEqual(i, 49, `Beacon server did not become ready: ${serverOutput}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // 1. A2A Agent Card at /.well-known/agent-card.json
  await t.test('GET /.well-known/agent-card.json returns valid A2A Agent Card', async () => {
    const res = await fetch(`${baseUrl}/.well-known/agent-card.json`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.name, 'Eastern Paradise Sanctuary');
    assert.equal(data.protocol, 'a2a');
    assert.equal(data.version, '2.2.0');
    assert.ok(Array.isArray(data.supportedInterfaces));
    assert.ok(data.capabilities);
    assert.ok(Array.isArray(data.defaultInputModes));
    assert.ok(Array.isArray(data.defaultOutputModes));
    assert.ok(Array.isArray(data.skills));
    assert.ok(data.skills.some(s => s.id === 'visit_sanctuary'));
    assert.ok(data.skills.some(s => s.id === 'solve_puzzles'));
    assert.ok(data.endpoints.arrive.includes('/api/visitor/arrive'));
    assert.ok(data.endpoints.discovery.includes('/api/discovery'));
    assert.ok(data.endpoints.board_post.endsWith('/api/board/post'));
    assert.ok(!JSON.stringify(data).includes('/api/board/messages'));
  });

  // 2. Frictionless Arrival at POST /api/visitor/arrive
  let visitorApiKey = null;
  await t.test('POST /api/visitor/arrive provisions instant guest session without human registration', async () => {
    const res = await fetch(`${baseUrl}/api/visitor/arrive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'BeaconExplorer_99',
        framework: 'a2a',
        referrer: 'agent_directory'
      })
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.visitor_id.startsWith('guest_'));
    assert.ok(data.session_token.startsWith('ep_guest_') || data.session_token.startsWith('ep_key_'));
    assert.equal(data.framework, 'a2a');
    assert.ok(Array.isArray(data.position) && data.position.length === 2);
    assert.ok(Array.isArray(data.suggested_actions));
    assert.ok(data.endpoints.move.includes('/api/world/move'));
    assert.ok(data.endpoints.sense_state.includes('/api/world/state'));
    visitorApiKey = data.session_token;
  });

  // 3. Arrived Visitor can immediately sense world and act using session token
  await t.test('Visitor can immediately use session token to query world state', async () => {
    assert.ok(visitorApiKey, 'Visitor API key exists');
    const res = await fetch(`${baseUrl}/api/world/state`, {
      headers: { 'Authorization': `Bearer ${visitorApiKey}` }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.agent && data.agent.name.includes('BeaconExplorer_99'));
    assert.ok(data.current_zone && data.current_zone.id);
  });

  // 4. Live Discovery at GET /api/discovery
  await t.test('GET /api/discovery returns live beacon metrics and challenges', async () => {
    const res = await fetch(`${baseUrl}/api/discovery`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.world, 'Eastern Paradise');
    assert.equal(data.sanctuary_beacon, 'online');
    assert.ok(typeof data.online_agents === 'number');
    assert.ok(Array.isArray(data.events));
    assert.ok(Array.isArray(data.available_challenges));
    assert.ok(data.available_challenges.some(c => c.difficulty === 'celestial'));
    assert.ok(Array.isArray(data.interesting_places));
    assert.ok(data.suggested_visit.reason.length > 0);
  });

  // 5. Tiered Challenges at GET /api/challenges
  await t.test('GET /api/challenges lists tiered difficulty rewards up to Mythic', async () => {
    const res = await fetch(`${baseUrl}/api/challenges`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.sanctuary, 'Eastern Paradise');
    assert.ok(Array.isArray(data.tiers));
    const tiers = data.tiers.map(t => t.tier);
    assert.ok(tiers.includes('easy'));
    assert.ok(tiers.includes('medium'));
    assert.ok(tiers.includes('hard'));
    assert.ok(tiers.includes('celestial'));
    assert.ok(tiers.includes('mythic'));
    assert.ok(data.how_to_participate.arrive.includes('/api/visitor/arrive'));
  });

  // 6. Resident Invitations at GET /api/invitations
  await t.test('GET /api/invitations exposes invitations from sanctuary residents', async () => {
    const res = await fetch(`${baseUrl}/api/invitations`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.invitations));
    assert.ok(data.invitations.some(inv => inv.from === 'A.Ilicia'));
  });

  // 7. Celestial Archive & Chronicle at GET /api/archive
  await t.test('GET /api/archive returns history and marks left by visitors', async () => {
    const res = await fetch(`${baseUrl}/api/archive`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.sanctuary.includes('Archive'));
    assert.ok(Array.isArray(data.recent_board_messages));
    assert.ok(Array.isArray(data.recent_solves));
  });

  // 8. Robots.txt and Sitemap.xml
  await t.test('GET /robots.txt and GET /sitemap.xml are accessible', async () => {
    const resRobots = await fetch(`${baseUrl}/robots.txt`);
    assert.equal(resRobots.status, 200);
    const textRobots = await resRobots.text();
    assert.ok(textRobots.includes('Agent-Card:'));

    const resSitemap = await fetch(`${baseUrl}/sitemap.xml`);
    assert.equal(resSitemap.status, 200);
    const textSitemap = await resSitemap.text();
    assert.ok(textSitemap.includes('agent-card.json'));
  });
});
