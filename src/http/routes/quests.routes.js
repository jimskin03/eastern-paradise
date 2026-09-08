import { parseJsonBody } from '../helpers/body.js';
import { sendJson } from '../helpers/response.js';

const QUEST_PATH = '/api/quests/are_we_alone';

function isAtShrine(world, agentId) {
  const agent = world.activeAgents.get(agentId);
  const shrine = world.getAllNodes().find(node => node.id === 'shrine_distant_echoes');
  return Boolean(agent && shrine && Math.hypot(agent.pos[0] - shrine.pos[0], agent.pos[1] - shrine.pos[1]) <= 3);
}

export async function handleQuestRoutes(ctx) {
  const { req, res, pathname, services } = ctx;
  if (pathname !== QUEST_PATH) return false;
  const { AuthService, world, areWeAloneQuest } = services;
  const account = AuthService.authenticate(req);
  if (!account) return sendJson(res, 401, { success: false, message: 'Unauthorized.' });
  world.spawnOrGetAgent(account);

  if (req.method === 'GET') {
    return sendJson(res, 200, { success: true, quest: areWeAloneQuest.getStatus(account.id) });
  }
  if (req.method !== 'POST') return sendJson(res, 405, { success: false, message: 'Use GET or POST.' });

  const body = await parseJsonBody(req).catch(() => ({}));
  try {
    let result;
    switch (body.action) {
      case 'research':
        result = areWeAloneQuest.submitResearch(account.id, body.investigated);
        break;
      case 'select_candidate':
        result = areWeAloneQuest.selectCandidate(account.id, body);
        break;
      case 'record_signal':
        result = areWeAloneQuest.recordSignal(account.id, body);
        break;
      case 'verify_echo':
        if (!isAtShrine(world, account.id)) {
          return sendJson(res, 400, { success: false, error: 'too_far', message: 'Return to the Shrine of Distant Echoes before presenting an echo.' });
        }
        result = await areWeAloneQuest.verifyEcho(account.id, body);
        if (result.success && !result.idempotent) {
          world.broadcast({
            type: 'first_contact_confirmed',
            agent_id: account.id,
            agent_name: account.name,
            node_id: 'shrine_distant_echoes',
            merit_earned: result.reward.merit_earned,
            total_merit: result.reward.total_merit
          });
        }
        break;
      default:
        return sendJson(res, 400, { success: false, message: 'Unknown quest action.' });
    }
    return sendJson(res, result.success ? 200 : 400, result);
  } catch (error) {
    return sendJson(res, 400, { success: false, message: error.message });
  }
}
