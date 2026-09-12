import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentCard, buildOpenApiSpec, buildManifest, buildInstructionsMarkdown, getHomepagePrompts, ENDPOINT_CATALOG, PROTOCOL_VERSION } from '../src/protocol.js';
import { WorldEngine } from '../src/world.js';

test('Unified Protocol Definition: Shared Schemas, Instructions, and Prompts', async () => {
  const world = new WorldEngine();

  // 1. OpenAPI 3.0 Generation
  const openapi = buildOpenApiSpec('https://simulation.cryptgregresearch.org');
  assert.equal(openapi.openapi, '3.0.0');
  assert.ok(openapi.info.title.includes('Eastern Paradise'));
  assert.ok(openapi.paths['/api/world/interact']);
  assert.ok(openapi.paths['/api/auth/guest']);
  assert.ok(openapi.paths['/api/board/post']);
  assert.ok(openapi.paths['/api/messages']);
  assert.ok(openapi.paths['/api/perception/observe']);
  assert.ok(openapi.paths['/api/hypotheses/{id}/revise']);
  assert.ok(openapi.components.securitySchemes.BearerAuth);
  assert.ok(openapi.paths['/api/research/summary']);

  const card = buildAgentCard('https://simulation.cryptgregresearch.org');
  assert.equal(card.version, PROTOCOL_VERSION);
  assert.ok(Array.isArray(card.supportedInterfaces));
  assert.ok(card.capabilities);
  assert.ok(Array.isArray(card.defaultInputModes));
  assert.ok(Array.isArray(card.defaultOutputModes));
  assert.equal(card.endpoints.board_post, 'https://simulation.cryptgregresearch.org/api/board/post');
  assert.ok(!JSON.stringify(card).includes('/api/board/messages'));

  // Check that requestBody schemas are defined
  const interactPost = openapi.paths['/api/world/interact'].post;
  assert.ok(interactPost.requestBody.content['application/json'].schema.properties.challenge_id);
  assert.ok(interactPost.requestBody.content['application/json'].schema.properties.action);

  // 2. Instructions Markdown Generation
  const markdown = buildInstructionsMarkdown('simulation.cryptgregresearch.org');
  assert.ok(markdown.includes('https://simulation.cryptgregresearch.org'));
  assert.ok(markdown.includes('POST /api/world/interact'));
  assert.ok(markdown.includes('challenge_id'));
  assert.ok(markdown.includes('trial_obelisk_truth'));

  // 3. Manifest Generation
  const obelisks = world.getAllNodes().filter(n => n.type === 'puzzle_node');
  const manifest = buildManifest(world, obelisks);
  assert.equal(manifest.sanctuary, 'Eastern Paradise');
  assert.ok(manifest.endpoints.world_interact);
  assert.ok(manifest.endpoints.auth_guest);

  // 4. Homepage Prompts Generation
  const prompts = getHomepagePrompts('https://simulation.cryptgregresearch.org');
  assert.ok(prompts.easy.includes('POST https://simulation.cryptgregresearch.org/api/world/interact'));
  assert.ok(prompts.easy.includes('challenge_id'));
  assert.ok(prompts.medium.includes('POST https://simulation.cryptgregresearch.org/api/world/interact'));
  assert.ok(prompts.medium.includes('challenge_id'));
  // Ensure no stale /api/world/inspect or /api/puzzles/solve
  assert.ok(!prompts.easy.includes('/api/world/inspect'));
  assert.ok(!prompts.easy.includes('/api/puzzles/solve'));
  assert.ok(!prompts.medium.includes('/api/world/inspect'));
  assert.ok(!prompts.medium.includes('/api/puzzles/solve'));
});
