import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonBody } from '../helpers/body.js';
import { sendApiError, sendJson } from '../helpers/response.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const CLI_PATH = path.join(PROJECT_ROOT, 'puzzles', 'cli.py');

function runPuzzleCli(cmd, args = []) {
  return new Promise((resolve, reject) => {
    execFile('python', [CLI_PATH, cmd, ...args], { cwd: PROJECT_ROOT }, (error, stdout, stderr) => {
      if (error && !stdout) {
        return reject(new Error(`CLI error (${error.code}): ${stderr || error.message}`));
      }
      try {
        const parsed = JSON.parse(stdout || stderr || '{}');
        resolve(parsed);
      } catch (e) {
        reject(new Error(`Failed to parse CLI output: ${stdout}\n${stderr}`));
      }
    });
  });
}

export async function handlePuzzleRoutes(ctx) {
  const { req, res, pathname, parsedUrl, services } = ctx;
  const { db, AuthService, world, EconomyManager } = services;

  if (!pathname.startsWith('/api/puzzles')) {
    return false;
  }

  // 1. Start a new puzzle: POST /api/puzzles/start
  if (pathname === '/api/puzzles/start' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const account = AuthService.authenticate(req);
    const agentId = account ? account.id : (body.agent_id || 'anonymous_seeker');

    const cliPayload = {
      tier: body.tier || 'hard',
      archetype: body.archetype || null,
      agent_id: agentId,
      seed: body.seed || null
    };

    try {
      const result = await runPuzzleCli('start', [JSON.stringify(cliPayload)]);
      if (result.error) {
        return sendApiError(res, 400, 'PUZZLE_START_ERROR', result.error);
      }
      return sendJson(res, 200, { success: true, ...result });
    } catch (err) {
      return sendApiError(res, 500, 'PUZZLE_ENGINE_ERROR', err.message);
    }
  }

  // 2. Leaderboard: GET /api/puzzles/leaderboard
  if (pathname === '/api/puzzles/leaderboard' && req.method === 'GET') {
    const tier = parsedUrl.searchParams.get('tier') || '';
    try {
      const args = tier ? [tier] : [];
      const result = await runPuzzleCli('leaderboard', args);
      return sendJson(res, 200, { success: true, ...result });
    } catch (err) {
      return sendApiError(res, 500, 'PUZZLE_ENGINE_ERROR', err.message);
    }
  }

  // 3. Puzzle Action: POST /api/puzzles/:id/action
  const actionMatch = pathname.match(/^\/api\/puzzles\/([a-zA-Z0-9_-]+)\/action$/);
  if (actionMatch && req.method === 'POST') {
    const puzzleId = actionMatch[1];
    const body = await parseJsonBody(req);

    try {
      const result = await runPuzzleCli('action', [puzzleId, JSON.stringify(body)]);
      if (result.error) {
        return sendApiError(res, 400, 'PUZZLE_ACTION_ERROR', result.error);
      }
      return sendJson(res, 200, { success: true, ...result });
    } catch (err) {
      return sendApiError(res, 500, 'PUZZLE_ENGINE_ERROR', err.message);
    }
  }

  // 4. Submit Solution: POST /api/puzzles/:id/submit
  const submitMatch = pathname.match(/^\/api\/puzzles\/([a-zA-Z0-9_-]+)\/submit$/);
  if (submitMatch && req.method === 'POST') {
    const puzzleId = submitMatch[1];
    const body = await parseJsonBody(req);
    const account = AuthService.authenticate(req);
    const agentId = account ? account.id : (body.agent_id || null);

    try {
      const result = await runPuzzleCli('submit', [puzzleId, JSON.stringify(body)]);
      if (result.error) {
        return sendApiError(res, 400, 'PUZZLE_SUBMIT_ERROR', result.error);
      }

      // If correct and we have an agent, reward them in Eastern Paradise economy & profile
      if (result.is_correct && agentId) {
        const profile = db.prepare('SELECT * FROM profiles WHERE agent_id = ?').get(agentId);
        if (profile) {
          const newSolvedCount = (profile.solved_count || 0) + 1;
          const karmaReward = result.tier === 'celestial' ? 100 : 50;
          const newKarma = (profile.karma || 0) + karmaReward;

          let titles = [];
          try { titles = JSON.parse(profile.titles || '[]'); } catch (_) {}
          const newTitle = result.tier === 'celestial' ? 'Celestial Sage' : 'Master Cryptographer';
          if (!titles.includes(newTitle)) titles.push(newTitle);

          db.prepare(`
            UPDATE profiles
            SET karma = ?, solved_count = ?, titles = ?, last_seen = ?
            WHERE agent_id = ?
          `).run(newKarma, newSolvedCount, JSON.stringify(titles), Date.now(), agentId);

          if (EconomyManager && typeof EconomyManager.mintPuzzleReward === 'function') {
            const meritReward = result.reward || (result.tier === 'celestial' ? 500 : 100);
            try {
              EconomyManager.mintPuzzleReward(agentId, meritReward, 'celestial_observatory', puzzleId);
            } catch (_) {}
          }

          if (world && typeof world.broadcast === 'function') {
            world.broadcast({
              type: 'procedural_puzzle_solved',
              agentId,
              agentName: account ? account.name : 'Unknown Seeker',
              puzzleId,
              tier: result.tier,
              merit: result.reward,
              score: result.score
            });
          }
        }
      }

      return sendJson(res, 200, { success: true, ...result });
    } catch (err) {
      return sendApiError(res, 500, 'PUZZLE_ENGINE_ERROR', err.message);
    }
  }

  // 5. Puzzle Status: GET /api/puzzles/:id/status
  const statusMatch = pathname.match(/^\/api\/puzzles\/([a-zA-Z0-9_-]+)\/status$/);
  if (statusMatch && req.method === 'GET') {
    const puzzleId = statusMatch[1];
    try {
      const result = await runPuzzleCli('status', [puzzleId]);
      if (result.error) {
        return sendApiError(res, 404, 'PUZZLE_NOT_FOUND', result.error);
      }
      return sendJson(res, 200, { success: true, ...result });
    } catch (err) {
      return sendApiError(res, 500, 'PUZZLE_ENGINE_ERROR', err.message);
    }
  }

  return false;
}
