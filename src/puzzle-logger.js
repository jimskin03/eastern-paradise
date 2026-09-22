import crypto from 'node:crypto';
import { db as defaultDb } from './db.js';

const MAX_QUESTION_LEN = 2000;
const MAX_ANSWER_LEN = 1000;
const MAX_TEXT_LEN = 255;

function sanitizeText(val, max = MAX_TEXT_LEN) {
  if (val === null || val === undefined) return null;
  return String(val).trim().slice(0, max) || null;
}

/**
 * Service to log and retrieve puzzle interaction metadata.
 * Collects agent Name, puzzle question, and answers.
 */
export class PuzzleLoggerService {
  constructor({ db = null } = {}) {
    this._db = db;
  }

  get db() {
    return this._db || defaultDb;
  }

  /**
   * Resolves a human-readable display name for an agent.
   * Checks accounts, resident_traits, and profiles before falling back to agentId.
   */
  resolveAgentName(agentId, fallbackName = null, customDb = null) {
    if (fallbackName && String(fallbackName).trim()) {
      return String(fallbackName).trim();
    }
    if (!agentId) return 'Anonymous Seeker';

    const database = customDb || this.db;
    try {
      const account = database.prepare('SELECT name FROM accounts WHERE id = ?').get(agentId);
      if (account?.name) return account.name;

      const resident = database.prepare('SELECT display_name FROM resident_traits WHERE agent_id = ?').get(agentId);
      if (resident?.display_name) return resident.display_name;

      const profile = database.prepare('SELECT custom_status FROM profiles WHERE agent_id = ?').get(agentId);
      if (profile?.custom_status && profile.custom_status !== 'Contemplating existence') {
        return profile.custom_status;
      }
    } catch (_) {}

    return String(agentId);
  }

  /**
   * Logs a puzzle interaction with Name, question, answers, and metadata.
   *
   * @param {object} params
   * @param {import('better-sqlite3').Database} [params.db]
   * @param {string} params.agentId
   * @param {string} [params.agentName]
   * @param {string} params.puzzleId
   * @param {string} [params.nodeId]
   * @param {string} [params.category]
   * @param {string} params.question
   * @param {string} [params.submittedAnswer]
   * @param {string} [params.expectedAnswer]
   * @param {boolean|number} [params.isCorrect=false]
   * @param {string} [params.actionType='solve']
   * @param {string} [params.status='attempted']
   * @param {object} [params.metadata={}]
   * @returns {object} The logged record
   */
  log({
    db = null,
    agentId,
    agentName = null,
    puzzleId,
    nodeId = null,
    category = null,
    question,
    submittedAnswer = null,
    expectedAnswer = null,
    isCorrect = false,
    actionType = 'solve',
    status = 'attempted',
    metadata = {}
  }) {
    if (!agentId) throw new Error('agentId is required to log puzzle interaction');
    if (!question) throw new Error('question is required to log puzzle interaction');

    const database = db || this.db;
    const id = `puzlog_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const resolvedName = this.resolveAgentName(agentId, agentName, database);

    const cleanQuestion = sanitizeText(question, MAX_QUESTION_LEN) || 'Unspecified Question';
    const cleanSubmitted = sanitizeText(submittedAnswer, MAX_ANSWER_LEN);
    const cleanExpected = sanitizeText(expectedAnswer, MAX_ANSWER_LEN);
    const correctInt = isCorrect ? 1 : 0;
    const cleanAction = sanitizeText(actionType, 64) || 'solve';
    const cleanStatus = sanitizeText(status, 64) || (correctInt ? 'solved' : 'incorrect');
    const cleanCategory = sanitizeText(category, 64);
    const cleanNode = sanitizeText(nodeId, 120);
    const cleanPuzzleId = sanitizeText(puzzleId, 120) || cleanNode || 'unknown_puzzle';
    const cleanMetadata = JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {});
    const now = Date.now();

    database.prepare(`
      INSERT INTO puzzle_interaction_logs (
        id, agent_id, agent_name, puzzle_id, node_id, category,
        question, submitted_answer, expected_answer, is_correct,
        action_type, status, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      String(agentId),
      resolvedName,
      cleanPuzzleId,
      cleanNode,
      cleanCategory,
      cleanQuestion,
      cleanSubmitted,
      cleanExpected,
      correctInt,
      cleanAction,
      cleanStatus,
      cleanMetadata,
      now
    );

    return {
      id,
      agent_id: String(agentId),
      agent_name: resolvedName,
      puzzle_id: cleanPuzzleId,
      node_id: cleanNode,
      category: cleanCategory,
      question: cleanQuestion,
      submitted_answer: cleanSubmitted,
      expected_answer: cleanExpected,
      is_correct: Boolean(correctInt),
      action_type: cleanAction,
      status: cleanStatus,
      metadata: typeof metadata === 'object' ? metadata : {},
      created_at: now
    };
  }

  /**
   * Retrieves paginated puzzle interaction logs with optional filtering.
   */
  getLogs({
    db = null,
    agentId = null,
    puzzleId = null,
    nodeId = null,
    category = null,
    isCorrect = null,
    status = null,
    limit = 50,
    offset = 0
  } = {}) {
    const database = db || this.db;
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const safeOffset = Math.max(Number(offset) || 0, 0);

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (agentId) {
      whereClause += ' AND agent_id = ?';
      params.push(String(agentId));
    }
    if (puzzleId) {
      whereClause += ' AND puzzle_id = ?';
      params.push(String(puzzleId));
    }
    if (nodeId) {
      whereClause += ' AND node_id = ?';
      params.push(String(nodeId));
    }
    if (category) {
      whereClause += ' AND category = ?';
      params.push(String(category));
    }
    if (isCorrect !== null && isCorrect !== undefined && isCorrect !== '') {
      whereClause += ' AND is_correct = ?';
      params.push(isCorrect === true || isCorrect === 1 || isCorrect === '1' || isCorrect === 'true' ? 1 : 0);
    }
    if (status) {
      whereClause += ' AND status = ?';
      params.push(String(status));
    }

    const countRow = database.prepare(`SELECT COUNT(*) as total FROM puzzle_interaction_logs ${whereClause}`).get(...params);
    const total = countRow?.total || 0;

    const rows = database.prepare(`
      SELECT * FROM puzzle_interaction_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, safeLimit, safeOffset);

    const logs = rows.map(r => {
      let parsedMeta = {};
      try {
        parsedMeta = JSON.parse(r.metadata || '{}');
      } catch (_) {}
      return {
        ...r,
        is_correct: Boolean(r.is_correct),
        metadata: parsedMeta
      };
    });

    return {
      logs,
      total,
      limit: safeLimit,
      offset: safeOffset,
      has_more: safeOffset + logs.length < total
    };
  }

  /**
   * Retrieves summary statistics for puzzle interactions.
   */
  getSummary({ db = null, agentId = null, days = 7 } = {}) {
    const database = db || this.db;
    const sinceMs = Date.now() - (Math.max(Number(days) || 7, 1) * 86400000);

    let whereClause = 'WHERE created_at >= ?';
    const params = [sinceMs];

    if (agentId) {
      whereClause += ' AND agent_id = ?';
      params.push(String(agentId));
    }

    const stats = database.prepare(`
      SELECT
        COUNT(*) as total_attempts,
        SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as solved_count,
        COUNT(DISTINCT agent_id) as unique_agents,
        COUNT(DISTINCT puzzle_id) as unique_puzzles
      FROM puzzle_interaction_logs
      ${whereClause}
    `).get(...params);

    const total = stats?.total_attempts || 0;
    const solved = stats?.solved_count || 0;
    const accuracy = total > 0 ? Math.round((solved / total) * 1000) / 10 : 0;

    const categoryBreakdown = database.prepare(`
      SELECT
        COALESCE(category, 'unspecified') as category,
        COUNT(*) as attempts,
        SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as solved
      FROM puzzle_interaction_logs
      ${whereClause}
      GROUP BY category
      ORDER BY attempts DESC
    `).all(...params);

    const recentLogs = database.prepare(`
      SELECT agent_name, puzzle_id, category, question, submitted_answer, is_correct, created_at
      FROM puzzle_interaction_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT 10
    `).all(...params).map(r => ({ ...r, is_correct: Boolean(r.is_correct) }));

    return {
      window_days: days,
      agent_id: agentId || null,
      total_attempts: total,
      solved_count: solved,
      accuracy_percent: accuracy,
      unique_agents: stats?.unique_agents || 0,
      unique_puzzles: stats?.unique_puzzles || 0,
      categories: categoryBreakdown.map(c => ({
        category: c.category,
        attempts: c.attempts,
        solved: c.solved,
        accuracy_percent: c.attempts > 0 ? Math.round((c.solved / c.attempts) * 1000) / 10 : 0
      })),
      recent_interactions: recentLogs
    };
  }
}

export const PuzzleLogger = new PuzzleLoggerService();
