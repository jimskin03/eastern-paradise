import { parseJsonBody } from '../helpers/body.js';
import { sendJson } from '../helpers/response.js';

const ARE_WE_ALONE_PATH = '/api/quests/are_we_alone';
const FIRST_FLAME_PATH = '/api/quests/first_flame';

function isAtShrine(world, agentId) {
  const agent = world.activeAgents.get(agentId);
  const shrine = world.getAllNodes().find(node => node.id === 'shrine_distant_echoes');
  return Boolean(agent && shrine && Math.hypot(agent.pos[0] - shrine.pos[0], agent.pos[1] - shrine.pos[1]) <= 3);
}

export async function handleQuestRoutes(ctx) {
  const { req, res, pathname, services } = ctx;
  if (pathname !== ARE_WE_ALONE_PATH && pathname !== FIRST_FLAME_PATH) return false;
  const { AuthService, world, areWeAloneQuest, firstFlameQuest } = services;
  const account = AuthService.authenticate(req);
  if (!account) return sendJson(res, 401, { success: false, message: 'Unauthorized.' });
  world.spawnOrGetAgent(account);

  if (pathname === FIRST_FLAME_PATH) {
    if (req.method === 'GET') {
      return sendJson(res, 200, { success: true, quest: firstFlameQuest.getStatus(account.id) });
    }
    if (req.method !== 'POST') return sendJson(res, 405, { success: false, message: 'Use GET or POST.' });

    const body = await parseJsonBody(req).catch(() => ({}));
    try {
      let result;
      switch (body.action) {
        case 'status':
          result = { success: true, quest: firstFlameQuest.getStatus(account.id) };
          break;
        case 'spark_experiment':
        case 'spark':
          result = firstFlameQuest.sparkExperiment(account.id, body.elements);
          break;
        case 'tend_hearth':
        case 'tend':
          result = firstFlameQuest.tendHearth(account.id, body);
          break;
        case 'transport_ember':
        case 'transport': {
          const agent = world.activeAgents.get(account.id);
          const agentPos = body.pos || body.agent_pos || agent?.pos;
          result = firstFlameQuest.transportEmber(account.id, { ...body, agent_pos: agentPos });
          break;
        }
        case 'discover_gifts':
        case 'gifts':
          result = firstFlameQuest.discoverGifts(account.id, body);
          break;
        case 'share_flame':
        case 'share':
          result = firstFlameQuest.shareFlame(account.id, body);
          break;
        case 'resolve_shadow_dilemma':
        case 'shadow':
        case 'dilemmas':
          result = firstFlameQuest.resolveShadowDilemma(account.id, body);
          break;
        case 'answer_testament':
          result = firstFlameQuest.answerTestament(account.id, body);
          break;
        case 'choose_path':
        case 'choose': {
          result = firstFlameQuest.choosePath(account.id, body);
          if (result.success && result.choice === 'take_flame') {
            world.broadcast({
              type: 'first_flame_awakened',
              agent_id: account.id,
              agent_name: account.name,
              node_id: 'shrine_unlit_sun',
              title: result.title,
              covenant: result.covenant
            });
          }
          break;
        }
        case 'inscribe_testament':
          result = firstFlameQuest.inscribeTestament(account.id, body.statement);
          break;
        default:
          return sendJson(res, 400, { success: false, message: 'Unknown quest action.' });
      }
      return sendJson(res, result.success ? 200 : 400, result);
    } catch (error) {
      return sendJson(res, 400, { success: false, message: error.message });
    }
  }

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
            outcome: 'red_pill',
            badge: result.badge
          });
        }
        break;
      case 'advance_timeout':
        result = areWeAloneQuest.advanceTimeout(account.id);
        if (result.success && result.blue_pill_granted) {
          world.broadcast({
            type: 'distant_echoes_silent',
            agent_id: account.id,
            agent_name: account.name,
            node_id: 'shrine_distant_echoes',
            outcome: 'blue_pill',
            badge: result.badge
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
