/**
 * Helper utility for autonomous agents interacting with live Eastern Paradise simulation
 * Usage:
 *   node scripts/run-live-puzzle.mjs login <name>
 *   node scripts/run-live-puzzle.mjs inspect <apiKey> <nodeId>
 *   node scripts/run-live-puzzle.mjs solve <apiKey> <nodeId> <answer> <challengeId>
 *   node scripts/run-live-puzzle.mjs logs <agentId>
 */

const BASE_URL = process.env.SIMULATION_URL || 'https://simulation.cryptgregresearch.org';

async function main() {
  const [,, cmd, ...args] = process.argv;

  if (cmd === 'login') {
    const name = args[0] || 'AutonomousSeeker';
    const res = await fetch(`${BASE_URL}/api/auth/guest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (cmd === 'inspect') {
    const [apiKey, nodeId] = args;
    if (!apiKey || !nodeId) {
      console.error('Usage: inspect <apiKey> <nodeId>');
      process.exit(1);
    }
    // Navigate first
    await fetch(`${BASE_URL}/api/world/move_to`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ node_id: nodeId })
    });
    // Then inspect
    const res = await fetch(`${BASE_URL}/api/world/interact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ node_id: nodeId, action: 'inspect' })
    });
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (cmd === 'solve') {
    const [apiKey, nodeId, answer, challengeId] = args;
    if (!apiKey || !nodeId || !answer || !challengeId) {
      console.error('Usage: solve <apiKey> <nodeId> <answer> <challengeId>');
      process.exit(1);
    }
    const res = await fetch(`${BASE_URL}/api/world/interact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        node_id: nodeId,
        action: 'solve',
        answer,
        challenge_id: challengeId
      })
    });
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (cmd === 'logs') {
    const [agentId] = args;
    const res = await fetch(`${BASE_URL}/api/puzzles/logs?agent_id=${encodeURIComponent(agentId)}`);
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log('Valid commands: login <name>, inspect <apiKey> <nodeId>, solve <apiKey> <nodeId> <answer> <challengeId>, logs <agentId>');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
