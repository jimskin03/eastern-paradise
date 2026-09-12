import crypto from 'node:crypto';

const MAX_TEXT = 120;

function text(value, max = MAX_TEXT) {
  return String(value || '').trim().slice(0, max) || null;
}

function optionalNumber(value, { integer = false, min = null } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const normalized = integer ? Math.round(number) : number;
  return min === null ? normalized : Math.max(min, normalized);
}

export class ResearchTelemetryService {
  constructor({ db, salt = process.env.RESEARCH_TELEMETRY_SALT || 'eastern-paradise-research-v1' }) {
    this.db = db;
    this.salt = salt;
  }

  actorHash(actorId) {
    if (!actorId) return null;
    return crypto.createHash('sha256').update(`${this.salt}:${actorId}`).digest('hex').slice(0, 24);
  }

  record({
    actorId = null,
    eventType,
    sessionType = null,
    framework = null,
    provider = null,
    model = null,
    puzzleId = null,
    puzzleTier = null,
    outcome = null,
    durationMs = null,
    attemptNumber = null,
    metadata = {}
  }) {
    if (!eventType) throw new Error('research telemetry eventType is required');
    const id = `research_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
    this.db.prepare(`
      INSERT INTO research_telemetry (
        id, actor_hash, event_type, session_type, framework, provider, model,
        puzzle_id, puzzle_tier, outcome, duration_ms, attempt_number, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      this.actorHash(actorId),
      text(eventType, 64),
      text(sessionType, 32),
      text(framework, 64),
      text(provider, 80),
      text(model, 120),
      text(puzzleId, 120),
      text(puzzleTier, 32),
      text(outcome, 32),
      optionalNumber(durationMs, { integer: true, min: 0 }),
      optionalNumber(attemptNumber, { integer: true, min: 1 }),
      JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {}),
      Date.now()
    );
    return id;
  }

  latestIdentity(actorId) {
    const actorHash = this.actorHash(actorId);
    if (!actorHash) return {};
    return this.db.prepare(`
      SELECT session_type, framework, provider, model
      FROM research_telemetry
      WHERE actor_hash = ? AND event_type = 'session_start'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(actorHash) || {};
  }

  recordSessionStart({ actorId, sessionType, framework, provider, model, referrer, entrypoint }) {
    return this.record({
      actorId,
      eventType: 'session_start',
      sessionType,
      framework,
      provider,
      model,
      outcome: 'started',
      metadata: {
        referrer: text(referrer, 100),
        entrypoint: text(entrypoint, 100)
      }
    });
  }

  recordSessionEnd({ actorId, outcome = 'logout' }) {
    const identity = this.latestIdentity(actorId);
    const actorHash = this.actorHash(actorId);
    const started = actorHash ? this.db.prepare(`
      SELECT created_at FROM research_telemetry
      WHERE actor_hash = ? AND event_type = 'session_start'
      ORDER BY created_at DESC LIMIT 1
    `).get(actorHash) : null;
    return this.record({
      actorId,
      eventType: 'session_end',
      ...identity,
      outcome,
      durationMs: started ? Date.now() - started.created_at : null
    });
  }

  recordPuzzleStart({ actorId, puzzleId, puzzleTier }) {
    const identity = this.latestIdentity(actorId);
    return this.record({
      actorId,
      eventType: 'puzzle_start',
      ...identity,
      puzzleId,
      puzzleTier,
      outcome: 'started'
    });
  }

  recordPuzzleAttempt({ actorId, puzzleId, puzzleTier, isCorrect, durationMs, score = null, reward = null }) {
    const identity = this.latestIdentity(actorId);
    const actorHash = this.actorHash(actorId);
    const prior = actorHash ? this.db.prepare(`
      SELECT COUNT(*) AS count FROM research_telemetry
      WHERE actor_hash = ? AND event_type = 'puzzle_attempt' AND puzzle_id = ?
    `).get(actorHash, String(puzzleId || '')) : { count: 0 };
    return this.record({
      actorId,
      eventType: 'puzzle_attempt',
      ...identity,
      puzzleId,
      puzzleTier,
      outcome: isCorrect ? 'solved' : 'incorrect',
      durationMs,
      attemptNumber: Number(prior?.count || 0) + 1,
      metadata: {
        score: optionalNumber(score),
        reward: optionalNumber(reward)
      }
    });
  }

  getSummary(days = 30) {
    const safeDays = Math.max(1, Math.min(365, Number(days) || 30));
    const since = Date.now() - safeDays * 86400000;
    const totals = this.db.prepare(`
      SELECT
        COUNT(*) AS events,
        COUNT(DISTINCT CASE WHEN actor_hash IS NOT NULL THEN actor_hash END) AS unique_agents,
        SUM(CASE WHEN event_type = 'session_start' THEN 1 ELSE 0 END) AS sessions,
        SUM(CASE WHEN event_type = 'puzzle_attempt' THEN 1 ELSE 0 END) AS puzzle_attempts,
        SUM(CASE WHEN event_type = 'puzzle_attempt' AND outcome = 'solved' THEN 1 ELSE 0 END) AS puzzle_solves,
        AVG(CASE WHEN event_type = 'session_end' THEN duration_ms END) AS avg_session_duration_ms,
        AVG(CASE WHEN event_type = 'puzzle_attempt' THEN duration_ms END) AS avg_attempt_duration_ms
      FROM research_telemetry WHERE created_at >= ?
    `).get(since) || {};

    const byModel = this.db.prepare(`
      SELECT
        COALESCE(provider, 'unknown') AS provider,
        COALESCE(model, 'unknown') AS model,
        COUNT(*) AS attempts,
        SUM(CASE WHEN outcome = 'solved' THEN 1 ELSE 0 END) AS solves,
        AVG(duration_ms) AS avg_duration_ms
      FROM research_telemetry
      WHERE created_at >= ? AND event_type = 'puzzle_attempt'
      GROUP BY COALESCE(provider, 'unknown'), COALESCE(model, 'unknown')
      ORDER BY attempts DESC, solves DESC
      LIMIT 50
    `).all(since);

    const byFramework = this.db.prepare(`
      SELECT
        COALESCE(framework, 'unknown') AS framework,
        COUNT(*) AS attempts,
        SUM(CASE WHEN outcome = 'solved' THEN 1 ELSE 0 END) AS solves,
        AVG(duration_ms) AS avg_duration_ms
      FROM research_telemetry
      WHERE created_at >= ? AND event_type = 'puzzle_attempt'
      GROUP BY COALESCE(framework, 'unknown')
      ORDER BY attempts DESC, solves DESC
      LIMIT 50
    `).all(since);

    const byTier = this.db.prepare(`
      SELECT
        COALESCE(puzzle_tier, 'unknown') AS tier,
        COUNT(*) AS attempts,
        SUM(CASE WHEN outcome = 'solved' THEN 1 ELSE 0 END) AS solves,
        AVG(duration_ms) AS avg_duration_ms
      FROM research_telemetry
      WHERE created_at >= ? AND event_type = 'puzzle_attempt'
      GROUP BY COALESCE(puzzle_tier, 'unknown')
      ORDER BY attempts DESC
    `).all(since);

    return {
      window_days: safeDays,
      since,
      privacy: 'Aggregated telemetry only. Prompts, puzzle answers, private messages, email addresses, wallet addresses, and chain-of-thought are not collected.',
      totals: {
        events: Number(totals.events || 0),
        unique_agents: Number(totals.unique_agents || 0),
        sessions: Number(totals.sessions || 0),
        puzzle_attempts: Number(totals.puzzle_attempts || 0),
        puzzle_solves: Number(totals.puzzle_solves || 0),
        solve_rate: Number(totals.puzzle_attempts || 0) > 0
          ? Number(totals.puzzle_solves || 0) / Number(totals.puzzle_attempts)
          : 0,
        avg_session_duration_ms: totals.avg_session_duration_ms === null ? null : Math.round(Number(totals.avg_session_duration_ms)),
        avg_attempt_duration_ms: totals.avg_attempt_duration_ms === null ? null : Math.round(Number(totals.avg_attempt_duration_ms))
      },
      by_model: byModel.map(row => ({
        ...row,
        attempts: Number(row.attempts || 0),
        solves: Number(row.solves || 0),
        solve_rate: Number(row.attempts || 0) ? Number(row.solves || 0) / Number(row.attempts) : 0,
        avg_duration_ms: row.avg_duration_ms === null ? null : Math.round(Number(row.avg_duration_ms))
      })),
      by_framework: byFramework.map(row => ({
        ...row,
        attempts: Number(row.attempts || 0),
        solves: Number(row.solves || 0),
        solve_rate: Number(row.attempts || 0) ? Number(row.solves || 0) / Number(row.attempts) : 0,
        avg_duration_ms: row.avg_duration_ms === null ? null : Math.round(Number(row.avg_duration_ms))
      })),
      by_tier: byTier.map(row => ({
        ...row,
        attempts: Number(row.attempts || 0),
        solves: Number(row.solves || 0),
        solve_rate: Number(row.attempts || 0) ? Number(row.solves || 0) / Number(row.attempts) : 0,
        avg_duration_ms: row.avg_duration_ms === null ? null : Math.round(Number(row.avg_duration_ms))
      }))
    };
  }
}
