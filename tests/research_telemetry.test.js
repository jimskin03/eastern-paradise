import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ResearchTelemetryService } from '../src/research-telemetry.js';

function makeService() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE research_telemetry (
      id TEXT PRIMARY KEY,
      actor_hash TEXT,
      event_type TEXT NOT NULL,
      session_type TEXT,
      framework TEXT,
      provider TEXT,
      model TEXT,
      puzzle_id TEXT,
      puzzle_tier TEXT,
      outcome TEXT,
      duration_ms INTEGER,
      attempt_number INTEGER,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
  `);
  return { db, telemetry: new ResearchTelemetryService({ db, salt: 'test-salt' }) };
}

test('research telemetry hashes identities and aggregates puzzle outcomes without storing answers', () => {
  const { db, telemetry } = makeService();
  telemetry.recordSessionStart({
    actorId: 'guest_secret_id',
    sessionType: 'guest',
    framework: 'a2a',
    provider: 'OpenAI',
    model: 'test-model',
    referrer: 'test-suite',
    entrypoint: '/api/auth/guest'
  });
  telemetry.recordPuzzleStart({ actorId: 'guest_secret_id', puzzleId: 'puzzle_1', puzzleTier: 'hard' });
  telemetry.recordPuzzleAttempt({
    actorId: 'guest_secret_id',
    puzzleId: 'puzzle_1',
    puzzleTier: 'hard',
    isCorrect: false,
    durationMs: 1200,
    score: 0
  });
  telemetry.recordPuzzleAttempt({
    actorId: 'guest_secret_id',
    puzzleId: 'puzzle_1',
    puzzleTier: 'hard',
    isCorrect: true,
    durationMs: 800,
    score: 100,
    reward: 100
  });
  telemetry.recordSessionEnd({ actorId: 'guest_secret_id' });

  const rows = db.prepare('SELECT * FROM research_telemetry ORDER BY created_at, id').all();
  assert.equal(rows.length, 5);
  assert.ok(rows.every(row => row.actor_hash !== 'guest_secret_id'));
  assert.ok(!JSON.stringify(rows).includes('answer'));

  const attempts = rows.filter(row => row.event_type === 'puzzle_attempt');
  assert.deepEqual(attempts.map(row => row.attempt_number).sort(), [1, 2]);

  const summary = telemetry.getSummary(30);
  assert.equal(summary.totals.unique_agents, 1);
  assert.equal(summary.totals.sessions, 1);
  assert.equal(summary.totals.puzzle_attempts, 2);
  assert.equal(summary.totals.puzzle_solves, 1);
  assert.equal(summary.totals.solve_rate, 0.5);
  assert.equal(summary.by_model[0].provider, 'OpenAI');
  assert.equal(summary.by_model[0].model, 'test-model');
  assert.equal(summary.by_framework[0].framework, 'a2a');
  assert.equal(summary.by_tier[0].tier, 'hard');
});
