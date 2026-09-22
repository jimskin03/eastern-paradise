import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { db } from '../src/db.js';
import { PuzzleManager } from '../src/puzzles.js';
import { PuzzleLogger, PuzzleLoggerService } from '../src/puzzle-logger.js';

test('Puzzle Interaction Metadata Logging System', async (t) => {
  const testSuffix = Math.random().toString(36).substring(2, 8);
  const testAgentId = `test_agent_logger_${testSuffix}`;
  const testAgentName = `Pilgrim ${testSuffix.toUpperCase()}`;

  // Provision test account
  db.prepare(`
    INSERT INTO accounts (id, name, email, created_at)
    VALUES (?, ?, ?, ?)
  `).run(testAgentId, testAgentName, `${testAgentId}@test.ep`, Date.now());

  db.prepare(`
    INSERT INTO profiles (agent_id, karma, balance, total_earned, solved_count, titles, solved_puzzles, custom_status, last_seen)
    VALUES (?, 100, 100, 100, 10, '["Novice Seeker"]', '[]', 'Awakening...', ?)
  `).run(testAgentId, Date.now());

  t.after(() => {
    try {
      db.prepare('DELETE FROM puzzle_interaction_logs WHERE agent_id = ?').run(testAgentId);
      db.prepare('DELETE FROM accounts WHERE id = ?').run(testAgentId);
      db.prepare('DELETE FROM profiles WHERE agent_id = ?').run(testAgentId);
    } catch (_) {}
  });

  await t.test('1. Database schema and table structure', () => {
    const tableInfo = db.prepare("PRAGMA table_info('puzzle_interaction_logs')").all();
    assert.ok(tableInfo.length > 0, 'puzzle_interaction_logs table must exist');

    const colNames = tableInfo.map(c => c.name);
    assert.ok(colNames.includes('id'), 'has id column');
    assert.ok(colNames.includes('agent_id'), 'has agent_id column');
    assert.ok(colNames.includes('agent_name'), 'has agent_name column');
    assert.ok(colNames.includes('puzzle_id'), 'has puzzle_id column');
    assert.ok(colNames.includes('question'), 'has question column');
    assert.ok(colNames.includes('submitted_answer'), 'has submitted_answer column');
    assert.ok(colNames.includes('expected_answer'), 'has expected_answer column');
    assert.ok(colNames.includes('is_correct'), 'has is_correct column');
    assert.ok(colNames.includes('created_at'), 'has created_at column');
  });

  await t.test('2. PuzzleLoggerService direct unit logging and Name resolution', () => {
    const service = new PuzzleLoggerService({ db });

    // Test Name resolution
    const resolvedName = service.resolveAgentName(testAgentId);
    assert.equal(resolvedName, testAgentName, 'Resolves account name correctly');

    const fallbackResolved = service.resolveAgentName('non_existent_id_999');
    assert.equal(fallbackResolved, 'non_existent_id_999', 'Falls back to agentId if account not found');

    // Test direct log call
    const logged = service.log({
      db,
      agentId: testAgentId,
      puzzleId: 'unit_test_pz_1',
      nodeId: 'unit_test_node',
      category: 'water',
      question: 'What is the nature of the moon in the pond?',
      submittedAnswer: 'Mind',
      expectedAnswer: 'mind',
      isCorrect: true,
      status: 'solved',
      metadata: { difficulty: 'medium' }
    });

    assert.ok(logged.id.startsWith('puzlog_'));
    assert.equal(logged.agent_id, testAgentId);
    assert.equal(logged.agent_name, testAgentName);
    assert.equal(logged.question, 'What is the nature of the moon in the pond?');
    assert.equal(logged.submitted_answer, 'Mind');
    assert.equal(logged.expected_answer, 'mind');
    assert.equal(logged.is_correct, true);
    assert.equal(logged.status, 'solved');
  });

  await t.test('3. PuzzleManager.solvePuzzle logs correct answers with Name, question, and answers', () => {
    const puzzle = PuzzleManager.getPuzzleForNode('trial_obelisk_wood', 'wood');
    assert.ok(puzzle, 'puzzle must exist');

    const solveResult = PuzzleManager.solvePuzzle(testAgentId, 'trial_obelisk_wood', puzzle.answer);
    assert.equal(solveResult.success, true);

    const logEntry = db.prepare(`
      SELECT * FROM puzzle_interaction_logs
      WHERE agent_id = ? AND is_correct = 1
      ORDER BY created_at DESC
      LIMIT 1
    `).get(testAgentId);

    assert.ok(logEntry, 'Must have logged the correct solve attempt');
    assert.equal(logEntry.agent_id, testAgentId);
    assert.equal(logEntry.agent_name, testAgentName);
    assert.equal(logEntry.question, puzzle.prompt);
    assert.equal(logEntry.submitted_answer, puzzle.answer);
    assert.equal(logEntry.expected_answer, puzzle.answer);
    assert.equal(logEntry.is_correct, 1);
    assert.equal(logEntry.status, 'solved');
  });

  await t.test('4. PuzzleManager.solvePuzzle logs incorrect answers with submitted value', () => {
    const puzzle = PuzzleManager.getPuzzleForNode('trial_obelisk_wood', 'wood');
    assert.ok(puzzle);

    const wrongAnswer = 'obviously_incorrect_test_token_123';
    const solveResult = PuzzleManager.solvePuzzle(testAgentId, 'trial_obelisk_wood', wrongAnswer);
    assert.equal(solveResult.success, false);
    assert.equal(solveResult.error, 'incorrect_answer');

    const logEntry = db.prepare(`
      SELECT * FROM puzzle_interaction_logs
      WHERE agent_id = ? AND submitted_answer = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(testAgentId, wrongAnswer);

    assert.ok(logEntry, 'Must have logged the incorrect solve attempt');
    assert.equal(logEntry.agent_id, testAgentId);
    assert.equal(logEntry.agent_name, testAgentName);
    assert.equal(logEntry.question, puzzle.prompt);
    assert.equal(logEntry.submitted_answer, wrongAnswer);
    assert.equal(logEntry.expected_answer, puzzle.answer);
    assert.equal(logEntry.is_correct, 0);
    assert.equal(logEntry.status, 'incorrect');
  });

  await t.test('5. PuzzleManager.solvePuzzle logs missing answers', () => {
    const puzzle = PuzzleManager.getPuzzleForNode('trial_obelisk_wood', 'wood');
    assert.ok(puzzle);

    const solveResult = PuzzleManager.solvePuzzle(testAgentId, 'trial_obelisk_wood', '');
    assert.equal(solveResult.success, false);
    assert.equal(solveResult.error, 'missing_answer');

    const logEntry = db.prepare(`
      SELECT * FROM puzzle_interaction_logs
      WHERE agent_id = ? AND status = 'missing_answer'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(testAgentId);

    assert.ok(logEntry, 'Must have logged the missing answer attempt');
    assert.equal(logEntry.agent_name, testAgentName);
    assert.equal(logEntry.is_correct, 0);
  });

  await t.test('6. Querying and filtering logs via PuzzleLogger.getLogs and getSummary', () => {
    const logsResult = PuzzleLogger.getLogs({
      db,
      agentId: testAgentId,
      limit: 10
    });

    assert.ok(logsResult.logs.length >= 3, 'Should have retrieved multiple logs for test agent');
    assert.equal(logsResult.has_more, false);

    // Filter by is_correct = true
    const correctLogs = PuzzleLogger.getLogs({
      db,
      agentId: testAgentId,
      isCorrect: true
    });
    assert.ok(correctLogs.logs.every(l => l.is_correct === true));

    // Filter by is_correct = false
    const incorrectLogs = PuzzleLogger.getLogs({
      db,
      agentId: testAgentId,
      isCorrect: false
    });
    assert.ok(incorrectLogs.logs.every(l => l.is_correct === false));

    // Summary stats
    const summary = PuzzleLogger.getSummary({ db, agentId: testAgentId });
    assert.ok(summary.total_attempts >= 3);
    assert.ok(summary.solved_count >= 1);
    assert.ok(summary.accuracy_percent > 0);
    assert.ok(summary.recent_interactions.length > 0);
  });

  await t.test('7. HTTP Endpoints: GET /api/puzzles/logs and /api/puzzles/logs/summary', async (subT) => {
    const PORT = '3093';
    const env = { ...process.env, PORT };
    const srv = spawn('node', ['src/server.js'], { env, cwd: process.cwd() });

    subT.after(() => {
      srv.kill();
    });

    function req(path) {
      return new Promise((resolve, reject) => {
        const request = http.request(`http://localhost:${PORT}${path}`, (res) => {
          let data = '';
          res.on('data', chunk => (data += chunk));
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, data: JSON.parse(data) });
            } catch (_) {
              resolve({ status: res.statusCode, text: data });
            }
          });
        });
        request.on('error', reject);
        request.end();
      });
    }

    // Wait for server ready
    for (let i = 0; i < 40; i++) {
      try {
        const health = await req('/api/status');
        if (health.status === 200) break;
      } catch {
        await new Promise(r => setTimeout(r, 150));
      }
      if (i === 39) throw new Error('Server failed to start');
    }

    // Query logs endpoint
    const logsRes = await req(`/api/puzzles/logs?agent_id=${testAgentId}&limit=5`);
    assert.equal(logsRes.status, 200);
    assert.equal(logsRes.data.success, true);
    assert.ok(Array.isArray(logsRes.data.logs));
    assert.ok(logsRes.data.logs.length >= 1);
    assert.equal(logsRes.data.logs[0].agent_name, testAgentName);
    assert.ok(logsRes.data.logs[0].question);

    // Query summary endpoint
    const summaryRes = await req(`/api/puzzles/logs/summary?agent_id=${testAgentId}`);
    assert.equal(summaryRes.status, 200);
    assert.equal(summaryRes.data.success, true);
    assert.ok(summaryRes.data.summary.total_attempts >= 1);
    assert.ok(typeof summaryRes.data.summary.accuracy_percent === 'number');
  });
});
