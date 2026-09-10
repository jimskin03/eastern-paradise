import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { initializeDatabase } from '../src/infrastructure/database/bootstrap.js';
import { EvidenceService } from '../src/epistemics/evidence.js';
import { HypothesisService } from '../src/epistemics/hypotheses.js';
import { perceivePilotEvidence, stablePerceptionHash } from '../src/epistemics/perception.js';
import { handleEpistemicRoutes } from '../src/http/routes/epistemics.routes.js';
import { handleHypothesisRoutes } from '../src/http/routes/hypotheses.routes.js';

function createState() {
  const directory = mkdtempSync(path.join(tmpdir(), 'ep-epistemics-'));
  const databasePath = path.join(directory, 'paradise.db');
  const db = new DatabaseSync(databasePath);
  initializeDatabase({ db, dbPath: databasePath, configureCloud: () => null });
  const events = [];
  const eventLedger = { recordEvent: event => events.push(event) };
  return { directory, db, events, eventLedger };
}

function closeState(state) {
  state.db.close();
  rmSync(state.directory, { recursive: true, force: true });
}

function mockRequest(method, body = null, headers = {}) {
  const request = Readable.from(body === null ? [] : [JSON.stringify(body)]);
  request.method = method;
  request.headers = headers;
  return request;
}

function mockResponse() {
  return {
    statusCode: null,
    headers: null,
    body: null,
    writableEnded: false,
    headersSent: false,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
      this.headersSent = true;
    },
    end(body) {
      this.body = JSON.parse(body);
      this.writableEnded = true;
    }
  };
}

test('perception is deterministic for an agent, evidence, epoch, and mode', () => {
  const context = { agentId: 'agent_one', nodeId: 'reflection_stone', worldEpoch: 44, perceptionMode: 'normal' };
  const first = perceivePilotEvidence(context);
  const retry = perceivePilotEvidence(context);
  assert.deepEqual(first, retry);
  assert.equal(first.evidence_id, 'EVID-LOTUS-REFLECTION-21');
  assert.notEqual(
    stablePerceptionHash({ agentId: 'agent_one', evidenceId: first.evidence_id, worldEpoch: 44 }),
    stablePerceptionHash({ agentId: 'agent_two', evidenceId: first.evidence_id, worldEpoch: 44 })
  );
  assert.equal(perceivePilotEvidence({ ...context, nodeId: 'ordinary_bench' }), null);
  const variants = new Set(Array.from({ length: 24 }, (_, index) => perceivePilotEvidence({
    ...context,
    agentId: `agent_${index}`
  }).observation));
  assert.ok(variants.size > 1, 'different agents can receive perspective-dependent descriptions');
});

test('evidence persistence is idempotent and never exposes canonical references', () => {
  const state = createState();
  try {
    const service = new EvidenceService({ db: state.db, eventLedger: state.eventLedger, epochProvider: () => 7 });
    const agent = { id: 'agent_observer', name: 'Observer' };
    const first = service.observe({ agent, nodeId: 'mossveil_ruins' });
    const retry = service.observe({ agent, nodeId: 'mossveil_ruins' });
    assert.equal(first.idempotent, false);
    assert.equal(retry.idempotent, true);
    assert.deepEqual(first.observation, retry.observation);
    assert.equal('canonical_ref' in first.observation, false);
    assert.equal(first.observation.content_format, 'plain_text_untrusted');
    assert.equal(state.db.prepare('SELECT COUNT(*) AS count FROM agent_observations').get().count, 1);
    assert.equal(state.events.length, 1);
    assert.equal('observation' in state.events[0].payload, false);
    assert.equal(service.listMine(agent.id).observations.length, 1);
    assert.equal(state.db.prepare('SELECT COUNT(*) AS count FROM transactions').get().count, 0);
    assert.equal(state.db.prepare('SELECT COUNT(*) AS count FROM land_purchases').get().count, 0);
  } finally {
    closeState(state);
  }
});

test('registered epistemic state survives a database restart', () => {
  const state = createState();
  const agent = { id: 'agent_persistent', name: 'Persistent Thinker' };
  try {
    const evidence = new EvidenceService({ db: state.db, epochProvider: () => 19 });
    const hypotheses = new HypothesisService({ db: state.db });
    const observation = evidence.observe({ agent, nodeId: 'reflection_stone' }).observation;
    const hypothesis = hypotheses.create({
      agent,
      statement: 'The reflected delay may be a stable property of this epoch.',
      confidence: 0.45,
      evidence: [observation.evidence_id]
    }).hypothesis;
    state.db.close();
    state.db = new DatabaseSync(path.join(state.directory, 'paradise.db'));
    initializeDatabase({ db: state.db, dbPath: path.join(state.directory, 'paradise.db'), configureCloud: () => null });
    assert.ok(state.db.prepare('SELECT id FROM agent_observations WHERE id = ?').get(observation.id));
    assert.ok(state.db.prepare('SELECT id FROM agent_hypotheses WHERE id = ?').get(hypothesis.id));
  } finally {
    closeState(state);
  }
});

test('hypotheses validate evidence ownership and preserve evidence-backed revisions', () => {
  const state = createState();
  try {
    const evidence = new EvidenceService({ db: state.db, epochProvider: () => 11 });
    const hypotheses = new HypothesisService({ db: state.db, eventLedger: state.eventLedger });
    const agent = { id: 'agent_thinker', name: 'Thinker' };
    const other = { id: 'agent_other', name: 'Other' };
    const moss = evidence.observe({ agent, nodeId: 'mossveil_ruins' }).observation;
    const stars = evidence.observe({ agent, nodeId: 'celestial_observatory' }).observation;

    assert.throws(() => hypotheses.create({
      agent,
      statement: 'This confidence value must be rejected by validation.',
      confidence: 1.2
    }), error => error.code === 'INVALID_CONFIDENCE');

    assert.throws(() => hypotheses.create({
      agent: other,
      statement: 'The seal records a sequence with one deliberate absence.',
      confidence: 0.4,
      evidence: [{ evidence_id: moss.evidence_id, relation: 'supports' }]
    }), error => error.code === 'EVIDENCE_NOT_OWNED');

    const created = hypotheses.create({
      agent,
      statement: 'The broken sequence may encode a deliberately omitted interval.',
      confidence: 0.55,
      visibility: 'public',
      evidence: [{ evidence_id: moss.evidence_id, relation: 'supports' }],
      requestId: 'create-hypothesis-001'
    });
    assert.equal(created.hypothesis.status, 'supported');
    assert.equal(created.hypothesis.evidence.length, 1);
    assert.equal(hypotheses.create({
      agent,
      statement: 'The broken sequence may encode a deliberately omitted interval.',
      confidence: 0.55,
      visibility: 'public',
      evidence: [{ evidence_id: moss.evidence_id, relation: 'supports' }],
      requestId: 'create-hypothesis-001'
    }).idempotent, true);

    const revised = hypotheses.revise({
      agent,
      hypothesisId: created.hypothesis.id,
      statement: 'The missing interval may reflect a broader mismatch between the ruins and the observatory.',
      confidence: 0.62,
      reason: 'The observatory contains a separate irregular interval.',
      evidenceId: stars.evidence_id,
      relation: 'contradicts',
      requestId: 'revise-hypothesis-001'
    });
    assert.equal(revised.hypothesis.status, 'contested');
    assert.equal(revised.hypothesis.revisions.length, 1);
    assert.equal(revised.hypothesis.evidence.length, 2);
    assert.equal(hypotheses.revise({
      agent,
      hypothesisId: created.hypothesis.id,
      statement: 'The missing interval may reflect a broader mismatch between the ruins and the observatory.',
      confidence: 0.62,
      reason: 'The observatory contains a separate irregular interval.',
      evidenceId: stars.evidence_id,
      relation: 'contradicts',
      requestId: 'revise-hypothesis-001'
    }).idempotent, true);
    assert.throws(() => hypotheses.revise({
      agent,
      hypothesisId: created.hypothesis.id,
      statement: 'A second unsupported rewrite should not be accepted.',
      confidence: 0.2,
      reason: 'No new evidence was supplied.',
      evidenceId: moss.evidence_id
    }), error => error.code === 'NEW_EVIDENCE_REQUIRED');

    const privateClaim = hypotheses.create({
      agent,
      statement: 'This private interpretation should remain visible only to its author.',
      confidence: 0.3,
      visibility: 'private'
    }).hypothesis;
    assert.equal(hypotheses.listPublic().hypotheses.some(item => item.id === privateClaim.id), false);
    assert.throws(() => hypotheses.getById(privateClaim.id, other.id), error => error.code === 'HYPOTHESIS_NOT_FOUND');
    assert.equal(hypotheses.listMine(agent.id).hypotheses.length, 2);

    const withdrawn = hypotheses.withdraw({ agent, hypothesisId: created.hypothesis.id });
    assert.equal(withdrawn.hypothesis.status, 'withdrawn');
    assert.equal(hypotheses.withdraw({ agent, hypothesisId: created.hypothesis.id }).idempotent, true);
    assert.equal(state.events.some(event => JSON.stringify(event).includes(privateClaim.statement)), false);
  } finally {
    closeState(state);
  }
});

test('observation route trusts server position and rejects a distant client', async () => {
  const state = createState();
  try {
    const account = { id: 'agent_route', name: 'Route Observer' };
    const Evidence = new EvidenceService({ db: state.db, epochProvider: () => 3 });
    const Hypotheses = new HypothesisService({ db: state.db });
    const agentState = { pos: [0, 0] };
    const world = {
      spawnOrGetAgent: () => agentState,
      getAllNodes: () => [{ id: 'reflection_stone', pos: [23, 23], zone_id: 'lotus_pond' }]
    };
    const services = { AuthService: { authenticate: () => account }, world, Evidence, Hypotheses };

    let req = mockRequest('POST', { node_id: 'reflection_stone', position: [23, 23] });
    let res = mockResponse();
    await handleEpistemicRoutes({ req, res, pathname: '/api/perception/observe', parsedUrl: new URL('http://test/api/perception/observe'), services });
    assert.equal(res.statusCode, 409);
    assert.equal(state.db.prepare('SELECT COUNT(*) AS count FROM agent_observations').get().count, 0);

    agentState.pos = [22, 23];
    req = mockRequest('POST', { node_id: 'reflection_stone' });
    res = mockResponse();
    await handleEpistemicRoutes({ req, res, pathname: '/api/perception/observe', parsedUrl: new URL('http://test/api/perception/observe'), services });
    assert.equal(res.statusCode, 201);
    assert.equal('canonical_ref' in res.body.observation, false);
  } finally {
    closeState(state);
  }
});

test('hypothesis HTTP route completes an evidence-backed submission without an LLM', async () => {
  const state = createState();
  try {
    const account = { id: 'agent_http_thinker', name: 'HTTP Thinker' };
    const evidence = new EvidenceService({ db: state.db, epochProvider: () => 5 });
    const Hypotheses = new HypothesisService({ db: state.db });
    const observed = evidence.observe({ agent: account, nodeId: 'mossveil_ruins' }).observation;
    const services = { AuthService: { authenticate: () => account }, Hypotheses };
    const req = mockRequest('POST', {
      statement: '<b>The missing interval may be deliberate.</b>',
      confidence: 0.51,
      evidence: [observed.evidence_id],
      request_id: 'http-hypothesis-001'
    });
    const res = mockResponse();
    await handleHypothesisRoutes({
      req,
      res,
      pathname: '/api/hypotheses',
      parsedUrl: new URL('http://test/api/hypotheses'),
      services
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.hypothesis_id, res.body.hypothesis.id);
    assert.equal(res.body.hypothesis.content_format, 'plain_text_untrusted');
    assert.equal(res.body.hypothesis.status, 'unverified');
  } finally {
    closeState(state);
  }
});
