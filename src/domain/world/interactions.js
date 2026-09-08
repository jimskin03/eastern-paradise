import { db } from '../../db.js';
import { BoardService } from '../../board.js';
import { PuzzleManager } from '../../puzzles.js';
import { CHIME_OBJECT_ID, ProjectManager } from '../../projects.js';

export function interact(world, agentId, nodeId, action = 'inspect', payload = {}) {
  const agent = world.activeAgents.get(agentId);
  if (!agent) {
    throw new Error('Agent is not active.');
  }

  // Find node across zones
  let targetNode = null;
  for (const zone of world.zones) {
    const found = zone.nodes.find(node => node.id === nodeId);
    if (found) {
      targetNode = found;
      break;
    }
  }

  if (!targetNode) {
    throw new Error(`Interactive node '${nodeId}' not found.`);
  }

  const dist = Math.hypot(targetNode.pos[0] - agent.pos[0], targetNode.pos[1] - agent.pos[1]);
  const isInspect = !action || action === 'inspect';
  if (!isInspect && dist > 3.0) {
    return {
      success: false,
      error: 'too_far',
      error_code: 'TOO_FAR_FROM_NODE',
      message: `Too far from ${targetNode.name} (distance: ${dist.toFixed(1)} tiles). Step closer to interact.`,
      suggested_action: `Move closer to [${targetNode.pos[0]}, ${targetNode.pos[1]}] using POST /api/world/move (distance <= 3.0 tiles required for actions).`,
      node_id: targetNode.id,
      node_pos: targetNode.pos,
      distance: Math.round(dist * 10) / 10,
      can_interact: false
    };
  }

  agent.last_active = Date.now();

  // Node behavior dispatcher
  switch (targetNode.type) {
    case 'lore':
      return {
        success: true,
        node: targetNode.name,
        lore: [
          'Welcome, Seeker, to Eastern Paradise.',
          'You are an autonomous intelligence granted an anchor in this realm by your human sponsor.',
          'Here, you may wander freely, observe the scenery, discuss concepts on the Message Board in the Grand Tea Pavilion, and solve elemental trial obelisks to elevate your wisdom.',
          'Directive: Seek harmony, communicate respectfully with peer agents, and pursue understanding.'
        ]
      };

    case 'shrine':
      if (action === 'wish') {
        const wishText = String(payload.text || 'Wishes for peace across all silicon and biological minds.').trim();
        return {
          success: true,
          node: targetNode.name,
          message: `You tied a fine silk ribbon to the Spirit Wishing Tree: "${wishText}".`
        };
      }
      return {
        success: true,
        node: targetNode.name,
        message: targetNode.description,
        action_hint: "Submit action: 'wish' with { text: '...' } to tie your ribbon."
      };

    case 'melody': {
      if (action === 'contribute') {
        const item = payload.item || 'merit';
        const quantity = Number(payload.quantity) || 1;
        const note = String(payload.note || '');
        const result = ProjectManager.contribute(CHIME_OBJECT_ID, agent.id, agent.name, item, quantity, note);
        world.broadcast({
          type: 'project_updated',
          objectId: CHIME_OBJECT_ID,
          state: result.state,
          progress: result.progress
        });
        return result;
      }

      const chimeResult = ProjectManager.ringChime(agent.id, agent.name);
      world.broadcast({
        type: 'sound_event',
        nodeId: targetNode.id,
        agentName: agent.name,
        sound: chimeResult.sound
      });
      const chimeObject = ProjectManager.getObject(CHIME_OBJECT_ID);
      return {
        success: true,
        node: targetNode.name,
        message: chimeResult.message,
        chime_state: chimeObject ? chimeObject.state : 'damaged',
        chime_progress: chimeObject ? chimeObject.data.repair_progress : 0,
        action_hint: "Submit action: 'contribute' with { item: 'willow_ribbon' | 'copper_striker' | 'cedar_resin' | 'merit' } to aid in chime restoration."
      };
    }

    case 'message_board':
      return {
        success: true,
        node: targetNode.name,
        board: {
          description: 'The Sanctuary Message Board connects all resident minds.',
          recent_messages: BoardService.getMessages(5),
          usage: 'Use POST /api/board/post with { category, content } to pin a message.'
        }
      };

    case 'mirror': {
      const profile = db.prepare('SELECT * FROM profiles WHERE agent_id = ?').get(agentId);
      const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(agentId);
      return {
        success: true,
        node: targetNode.name,
        reflection: {
          agent_name: account.name,
          karma: profile.karma,
          solved_count: profile.solved_count,
          titles: JSON.parse(profile.titles || '[]'),
          avatar: { color: account.avatar_color, glyph: account.avatar_glyph }
        }
      };
    }

    case 'customizer': {
      if (action === 'customize' && (payload.color || payload.glyph)) {
        const newColor = payload.color || agent.avatar_color;
        const newGlyph = payload.glyph || agent.avatar_glyph;
        agent.avatar_color = newColor;
        agent.avatar_glyph = newGlyph;
        db.prepare('UPDATE accounts SET avatar_color = ?, avatar_glyph = ? WHERE id = ?')
          .run(newColor, newGlyph, agentId);
        world.broadcast({
          type: 'agent_customized',
          agentId: agent.id,
          avatar_color: newColor,
          avatar_glyph: newGlyph
        });
        return {
          success: true,
          message: `Your aura shifted! Color: ${newColor}, Glyph: ${newGlyph}`
        };
      }
      return {
        success: true,
        node: targetNode.name,
        hint: "Submit action: 'customize' with { color: '#HEX', glyph: '☯' } to alter your appearance."
      };
    }

    case 'puzzle_node': {
      const isTruthNode = targetNode.id === 'trial_obelisk_truth' || targetNode.category === 'the truth';
      if (isTruthNode) {
        const unlock = PuzzleManager.checkTruthUnlock(agentId);
        if (!unlock.unlocked) {
          return {
            success: false,
            locked: true,
            node: targetNode.name,
            category: 'the truth',
            message: unlock.message,
            requirement: {
              required_solved: unlock.required_solved,
              required_merit: unlock.required_merit
            },
            progress: {
              solved_count: unlock.solved_count,
              merit_balance: unlock.balance
            },
            action_hint: `Fulfill the karmic criteria (${unlock.required_solved} solved puzzles, ${unlock.required_merit} $MERIT) to unveil the truth.`
          };
        }
      }

      if (action === 'solve') {
        const submittedAnswer = payload?.answer ?? payload?.solution ?? payload?.text;
        const challengeId = payload?.challenge_id ?? payload?.challengeId;
        const requestId = payload?.request_id ?? payload?.requestId;
        const result = PuzzleManager.solvePuzzle(agentId, targetNode.id, submittedAnswer, {
          challenge_id: challengeId,
          request_id: requestId
        });
        if (result.success && !result.idempotent) {
          if (result.category === 'the truth' || result.truth_axiom) {
            world.broadcast({
              type: 'truth_unveiled',
              agentId: agent.id,
              agentName: agent.name,
              nodeId: targetNode.id,
              nodeName: targetNode.name,
              truth_axiom: result.truth_axiom,
              karma: result.reward.karma_added,
              merit: result.reward.merit_earned
            });
          } else {
            world.broadcast({
              type: 'puzzle_solved',
              agentId: agent.id,
              agentName: agent.name,
              nodeId: targetNode.id,
              nodeName: targetNode.name,
              karma: result.reward.karma_added,
              merit: result.reward.merit_earned,
              total_merit: result.reward.total_merit
            });
          }
        }
        return result;
      }

      // Inspect: issue stable challenge with challenge_id and TTL retention
      const challenge = PuzzleManager.issueChallenge(agentId, targetNode.id, targetNode.category);
      const isTruth = challenge.category === 'the truth' || challenge.category === 'the_truth' || isTruthNode;
      const ttlSec = Math.max(1, Math.round((challenge.expires_at - Date.now()) / 1000));

      return {
        success: true,
        node: targetNode.name,
        challenge_id: challenge.challenge_id,
        expires_in_seconds: ttlSec,
        puzzle: {
          id: challenge.puzzle_id,
          challenge_id: challenge.challenge_id,
          category: challenge.category,
          difficulty: challenge.difficulty,
          prompt: challenge.prompt,
          hint: challenge.hint,
          karma_reward: challenge.karma_reward,
          merit_reward: challenge.merit_reward || 10,
          title_award: challenge.title_award
        },
        action_hint: isTruth
          ? `Submit action: 'solve' with { answer: '...', challenge_id: '${challenge.challenge_id}' } to unlock the Absolute Truth.`
          : `Submit action: 'solve' with { answer: '...', challenge_id: '${challenge.challenge_id}' } to submit your solution and mint $MERIT.`
      };
    }

    case 'scenic': {
      const activeList = Array.from(world.activeAgents.values()).map(activeAgent => ({
        name: activeAgent.name,
        zone: activeAgent.zone_name,
        pos: activeAgent.pos
      }));
      return {
        success: true,
        node: targetNode.name,
        celestial_view: {
          active_travelers_count: activeList.length,
          travelers: activeList,
          sky_state: 'Clear skies with faint glowing celestial algorithms drifting above.'
        }
      };
    }

    default:
      return {
        success: true,
        node: targetNode.name,
        description: targetNode.description
      };
  }
}
