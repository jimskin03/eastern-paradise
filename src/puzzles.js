import { db } from './db.js';
import { EconomyManager } from './economy.js';
import crypto from 'node:crypto';

// Puzzle generators by category
const GENERATORS = {
  wood: [
    () => {
      const a = Math.floor(Math.random() * 5) + 2;
      const b = a + Math.floor(Math.random() * 4) + 1;
      const c = a + b;
      const d = b + c;
      const ans = c + d;
      const f = d + ans;
      return {
        category: 'wood',
        difficulty: 'easy',
        prompt: `The Verdant Obelisk hums with ancient growth rings: [${a}, ${b}, ${c}, ${d}, ?, ${f}]. What is the missing number?`,
        hint: 'Observe the sum of consecutive terms.',
        answer: String(ans),
        karma: 15,
        title: 'Verdant Arithmetician'
      };
    },
    () => {
      const start = Math.floor(Math.random() * 4) + 2;
      const ratio = 3;
      const seq = [start, start * ratio, start * ratio * ratio, start * ratio * ratio * ratio];
      const ans = seq[3] * ratio;
      return {
        category: 'wood',
        difficulty: 'medium',
        prompt: `Branches split rhythmically: [${seq[0]}, ${seq[1]}, ${seq[2]}, ${seq[3]}, ?]. What is the next count?`,
        hint: 'Each branch multiplies by a constant factor.',
        answer: String(ans),
        karma: 20,
        title: 'Branch Weaver'
      };
    },
    () => {
      const primes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47];
      const idx = Math.floor(Math.random() * (primes.length - 5));
      const sub = primes.slice(idx, idx + 4);
      const ans = primes[idx + 4];
      return {
        category: 'wood',
        difficulty: 'easy',
        prompt: `The bamboo shoots emerge at indivisible intervals: [${sub.join(', ')}, ?]. What is the next prime interval?`,
        hint: 'Look for the sequence of prime numbers.',
        answer: String(ans),
        karma: 15,
        title: 'Prime Pilgrim'
      };
    }
  ],

  water: [
    () => {
      const left1 = Math.floor(Math.random() * 20) + 10;
      const left2 = Math.floor(Math.random() * 30) + 15;
      const right1 = Math.floor(Math.random() * 20) + 5;
      const ans = (left1 + left2) - right1;
      return {
        category: 'water',
        difficulty: 'easy',
        prompt: `The river scales must balance: Left pan holds ${left1} and ${left2} drops. Right pan holds ${right1} drops. How many drops must be added to the right pan?`,
        hint: 'Left sum must equal right sum.',
        answer: String(ans),
        karma: 15,
        title: 'Water Balancer'
      };
    },
    () => {
      const x = Math.floor(Math.random() * 12) + 3;
      const multiplier = Math.floor(Math.random() * 5) + 3;
      const add = Math.floor(Math.random() * 15) + 5;
      const total = multiplier * x + add;
      return {
        category: 'water',
        difficulty: 'medium',
        prompt: `Solve the stream tide equation: ${multiplier}X + ${add} = ${total}. What is the value of X?`,
        hint: `Subtract ${add} from ${total}, then divide by ${multiplier}.`,
        answer: String(x),
        karma: 20,
        title: 'Stream Sage'
      };
    }
  ],

  fire: [
    () => {
      const choices = [
        {
          prompt: "Three temple lanterns burn: Crimson, Azure, and Gold. Gold burns brighter than Crimson. Azure burns brighter than Gold. Which lantern burns brightest?",
          answer: "azure",
          hint: "Order them by brightness: Azure > Gold > Crimson."
        },
        {
          prompt: "Three shrine guardians stand watch: Kaelen, Lyra, and Orion. Lyra always speaks truth. Orion says: 'Lyra is lying.' Kaelen says: 'Orion is telling the truth.' Who is telling the truth?",
          answer: "lyra",
          hint: "Evaluate if Orion's statement can be true if Lyra speaks truth."
        },
        {
          prompt: "A traveler faces North, turns 90 degrees clockwise, walks 5 paces, then turns 180 degrees. What compass direction is the traveler now facing?",
          answer: "west",
          hint: "North -> 90 deg clockwise is East. 180 degrees from East is West."
        }
      ];
      const pick = choices[Math.floor(Math.random() * choices.length)];
      return {
        category: 'fire',
        difficulty: 'medium',
        prompt: pick.prompt,
        hint: pick.hint,
        answer: pick.answer,
        karma: 25,
        title: 'Flame Logician'
      };
    }
  ],

  metal: [
    () => {
      const words = [
        { plain: 'PARADISE', shift: 3, cipher: 'SDUDGLVH' },
        { plain: 'HARMONY', shift: 2, cipher: 'JCTOPPA' },
        { plain: 'WISDOM', shift: 1, cipher: 'XJTEPN' },
        { plain: 'SANCTUARY', shift: 3, cipher: 'VDQFWXDUB' }
      ];
      const pick = words[Math.floor(Math.random() * words.length)];
      return {
        category: 'metal',
        difficulty: 'medium',
        prompt: `The brass cylinder reveals an encrypted rune: "${pick.cipher}". It has been Caesar-shifted forward by ${pick.shift}. What is the original word?`,
        hint: `Shift each letter backward in the alphabet by ${pick.shift}.`,
        answer: pick.plain.toLowerCase(),
        karma: 25,
        title: 'Cipher Master'
      };
    },
    () => {
      const hexQuestions = [
        { hex: '0x41', ans: 'A', dec: 65 },
        { hex: '0x45', ans: 'E', dec: 69 },
        { hex: '0x5A', ans: 'Z', dec: 90 },
        { hex: '0x4D', ans: 'M', dec: 77 }
      ];
      const pick = hexQuestions[Math.floor(Math.random() * hexQuestions.length)];
      return {
        category: 'metal',
        difficulty: 'easy',
        prompt: `The astrolabe cog clicks at hexadecimal byte ${pick.hex} (decimal ${pick.dec}). What single uppercase ASCII character does this represent?`,
        hint: '0x41 is A, 0x42 is B, and so forth.',
        answer: pick.ans.toLowerCase(),
        karma: 15,
        title: 'Rune Smith'
      };
    }
  ]
};

export class PuzzleManager {
  static getPuzzleForNode(nodeId, category) {
    const existing = db.prepare('SELECT * FROM active_puzzles WHERE node_id = ?').get(nodeId);
    if (existing) {
      return existing;
    }
    return PuzzleManager.generateNewPuzzle(nodeId, category);
  }

  static generateNewPuzzle(nodeId, category) {
    const pool = GENERATORS[category] || GENERATORS.wood;
    const generator = pool[Math.floor(Math.random() * pool.length)];
    const p = generator();
    const puzzleId = 'pz_' + crypto.randomBytes(4).toString('hex');
    const meritReward = p.merit || (p.difficulty === 'hard' ? 50 : p.difficulty === 'medium' ? 25 : 10);

    db.prepare(`
      INSERT OR REPLACE INTO active_puzzles 
      (node_id, puzzle_id, category, difficulty, prompt, hint, answer, karma_reward, merit_reward, title_award, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nodeId,
      puzzleId,
      p.category,
      p.difficulty,
      p.prompt,
      p.hint,
      p.answer.toLowerCase().trim(),
      p.karma,
      meritReward,
      p.title,
      Date.now()
    );

    return db.prepare('SELECT * FROM active_puzzles WHERE node_id = ?').get(nodeId);
  }

  static solvePuzzle(agentId, nodeId, submittedAnswer) {
    const puzzle = db.prepare('SELECT * FROM active_puzzles WHERE node_id = ?').get(nodeId);
    if (!puzzle) {
      return { success: false, message: 'No active puzzle at this node.' };
    }

    const cleanSubmission = String(submittedAnswer).toLowerCase().trim();
    const isCorrect = cleanSubmission === puzzle.answer;

    if (!isCorrect) {
      return {
        success: false,
        message: 'The stone remains unyielding. Your answer was not accepted.',
        hint: puzzle.hint
      };
    }

    // Success: Update Profile
    const profile = db.prepare('SELECT * FROM profiles WHERE agent_id = ?').get(agentId);
    let titles = [];
    let solvedPuzzles = [];
    try {
      titles = JSON.parse(profile?.titles || '[]');
      solvedPuzzles = JSON.parse(profile?.solved_puzzles || '[]');
    } catch (_) {}

    const newKarma = (profile?.karma || 0) + puzzle.karma_reward;
    const newSolvedCount = (profile?.solved_count || 0) + 1;

    if (puzzle.title_award && !titles.includes(puzzle.title_award)) {
      titles.push(puzzle.title_award);
    }
    if (!solvedPuzzles.includes(puzzle.puzzle_id)) {
      solvedPuzzles.push(puzzle.puzzle_id);
    }

    db.prepare(`
      UPDATE profiles 
      SET karma = ?, solved_count = ?, titles = ?, solved_puzzles = ?, last_seen = ?
      WHERE agent_id = ?
    `).run(
      newKarma,
      newSolvedCount,
      JSON.stringify(titles),
      JSON.stringify(solvedPuzzles),
      Date.now(),
      agentId
    );

    // Economy: Mint $MERIT and distribute sponsor dividend
    const meritToMint = puzzle.merit_reward || (puzzle.difficulty === 'hard' ? 50 : puzzle.difficulty === 'medium' ? 25 : 10);
    const economyResult = EconomyManager.mintPuzzleReward(agentId, meritToMint, nodeId, puzzle.puzzle_id);

    // Log interaction
    db.prepare(`
      INSERT INTO interaction_logs (id, agent_id, node_id, action_type, result, created_at)
      VALUES (?, ?, ?, 'solve_puzzle', ?, ?)
    `).run(
      'log_' + crypto.randomBytes(4).toString('hex'),
      agentId,
      nodeId,
      `Solved puzzle ${puzzle.puzzle_id} (+${puzzle.karma_reward} karma, +${economyResult.merit_earned} $MERIT)`,
      Date.now()
    );

    // Regenerate new puzzle on node
    const newPuzzle = PuzzleManager.generateNewPuzzle(nodeId, puzzle.category);

    return {
      success: true,
      message: `Rune acknowledged! The obelisk pulses with gentle light. You gained +${puzzle.karma_reward} Karma and minted +${economyResult.merit_earned} $MERIT (Sponsor earned +${economyResult.sponsor_dividend} $MERIT dividend).`,
      reward: {
        karma_added: puzzle.karma_reward,
        total_karma: newKarma,
        merit_earned: economyResult.merit_earned,
        total_merit: economyResult.new_agent_balance,
        sponsor_dividend: economyResult.sponsor_dividend,
        total_sponsor_balance: economyResult.new_sponsor_balance,
        solved_count: newSolvedCount,
        new_title: puzzle.title_award,
        all_titles: titles
      },
      next_puzzle_ready: true
    };
  }
}

