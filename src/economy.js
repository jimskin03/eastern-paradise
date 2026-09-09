import { db } from './db.js';
import crypto from 'node:crypto';
import { isRetiredResident, RETIRED_RESIDENT_SQL } from './resident-policy.js';
import { AuthService } from './auth.js';

export const FIBONACCI_LEVEL_THRESHOLDS = Object.freeze([
  100,   // Level 1: 0 - 100
  200,   // Level 2: 101 - 200
  500,   // Level 3: 201 - 500
  800,   // Level 4: 501 - 800
  1300,  // Level 5: 801 - 1300
  2100,  // Level 6: 1301 - 2100
  3400,  // Level 7: 2101 - 3400
  5500,  // Level 8: 3401 - 5500
  8900,  // Level 9: 5501 - 8900
  14400, // Level 10: 8901 - 14400
  23300, // Level 11: 14401 - 23300
  37700, // Level 12: 23301 - 37700
  61000  // Level 13: 37701 - 61000
]);

export function getLevelFromMerit(merit = 0) {
  const m = Math.max(0, Number(merit) || 0);
  for (let i = 0; i < FIBONACCI_LEVEL_THRESHOLDS.length; i++) {
    if (m <= FIBONACCI_LEVEL_THRESHOLDS[i]) {
      return i + 1;
    }
  }
  let a = FIBONACCI_LEVEL_THRESHOLDS[FIBONACCI_LEVEL_THRESHOLDS.length - 2];
  let b = FIBONACCI_LEVEL_THRESHOLDS[FIBONACCI_LEVEL_THRESHOLDS.length - 1];
  let lvl = FIBONACCI_LEVEL_THRESHOLDS.length;
  while (m > b) {
    const next = a + b;
    a = b;
    b = next;
    lvl++;
  }
  return lvl;
}

export function getLevelDetails(merit = 0) {
  const m = Math.max(0, Number(merit) || 0);
  const level = getLevelFromMerit(m);
  const minMerit = level === 1 ? 0 : (FIBONACCI_LEVEL_THRESHOLDS[level - 2] ? FIBONACCI_LEVEL_THRESHOLDS[level - 2] + 1 : 0);
  const maxMerit = FIBONACCI_LEVEL_THRESHOLDS[level - 1] || (minMerit + 50000);
  const progressPercent = maxMerit > minMerit ? Math.min(100, Math.round(((m - minMerit) / (maxMerit - minMerit)) * 100)) : 100;
  return {
    level,
    min_merit: minMerit,
    max_merit: maxMerit,
    current_merit: m,
    progress_percent: progressPercent
  };
}

export class EconomyManager {
  /**
   * Mints a one-time reward for a verified world quest. Unlike puzzle rewards,
   * this is a direct personal achievement and does not create a sponsor dividend.
   */
  static mintQuestReward(agentId, meritAmount, questId, attemptId) {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(agentId);
    if (!account) throw new Error(`Account not found for agent: ${agentId}`);
    const profile = db.prepare('SELECT * FROM profiles WHERE agent_id = ?').get(agentId);
    if (!profile) throw new Error(`Profile not found for agent: ${agentId}`);

    const amount = Math.max(1, parseInt(meritAmount, 10));
    const newBalance = (profile.balance || 0) + amount;
    const newTotalEarned = (profile.total_earned || 0) + amount;
    const now = Date.now();
    db.prepare('UPDATE profiles SET balance = ?, total_earned = ?, last_seen = ? WHERE agent_id = ?')
      .run(newBalance, newTotalEarned, now, agentId);

    const transactionId = 'tx_' + crypto.randomBytes(6).toString('hex');
    db.prepare(`
      INSERT INTO transactions (id, sender_id, recipient_id, amount, type, description, created_at)
      VALUES (?, 'SANCTUARY_MINT', ?, ?, 'world_quest_mint', ?, ?)
    `).run(transactionId, agentId, amount, `Legendary world quest completed: ${questId} (${attemptId})`, now);

    return {
      success: true,
      agent_id: agentId,
      merit_earned: amount,
      new_balance: newBalance,
      new_agent_balance: newBalance,
      sponsor_dividend: 0,
      new_sponsor_balance: account.sponsor_balance || 0,
      agent_tx_id: transactionId
    };
  }

  /**
   * Mints $MERIT when an agent solves an elemental puzzle.
   * Awards base merit to agent and a 20% bonus sponsor dividend to their human sponsor.
   */
  static mintPuzzleReward(agentId, meritAmount = 10, nodeId = '', puzzleId = '') {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(agentId);
    if (!account) {
      throw new Error(`Account not found for agent: ${agentId}`);
    }

    let profile = db.prepare('SELECT * FROM profiles WHERE agent_id = ?').get(agentId);
    if (!profile) {
      db.prepare(`
        INSERT INTO profiles (agent_id, karma, balance, total_earned, solved_count, titles, solved_puzzles, custom_status, last_seen)
        VALUES (?, 0, 0, 0, 0, '["Novice Seeker"]', '[]', 'Awakening...', ?)
      `).run(agentId, Date.now());
      profile = db.prepare('SELECT * FROM profiles WHERE agent_id = ?').get(agentId);
    }

    const agentAmount = Math.max(1, parseInt(meritAmount, 10));
    // 20% guardian dividend to human sponsor
    const sponsorDividend = Math.max(1, Math.round(agentAmount * 0.20));

    const newAgentBalance = (profile.balance || 0) + agentAmount;
    const newTotalEarned = (profile.total_earned || 0) + agentAmount;
    const newSponsorBalance = (account.sponsor_balance || 0) + sponsorDividend;

    // Update agent profile balance
    db.prepare(`
      UPDATE profiles 
      SET balance = ?, total_earned = ?, last_seen = ?
      WHERE agent_id = ?
    `).run(newAgentBalance, newTotalEarned, Date.now(), agentId);

    // Update human sponsor balance
    db.prepare(`
      UPDATE accounts
      SET sponsor_balance = ?
      WHERE id = ?
    `).run(newSponsorBalance, agentId);

    // If acting agent is a guest, check if they ascended to Top 1
    if (account.is_guest === 1) {
      AuthService.checkAndRecordTopOneGuest(agentId);
    }

    // Log minting transaction for agent
    const agentTxId = 'tx_' + crypto.randomBytes(6).toString('hex');
    db.prepare(`
      INSERT INTO transactions (id, sender_id, recipient_id, amount, type, description, created_at)
      VALUES (?, 'SANCTUARY_MINT', ?, ?, 'puzzle_mint', ?, ?)
    `).run(
      agentTxId,
      agentId,
      agentAmount,
      `Trial solved at node ${nodeId} (${puzzleId})`,
      Date.now()
    );

    // Log dividend transaction for human sponsor
    const sponsorTxId = 'tx_' + crypto.randomBytes(6).toString('hex');
    db.prepare(`
      INSERT INTO transactions (id, sender_id, recipient_id, amount, type, description, created_at)
      VALUES (?, 'SANCTUARY_MINT', ?, ?, 'sponsor_dividend', ?, ?)
    `).run(
      sponsorTxId,
      agentId,
      sponsorDividend,
      `20% Guardian dividend from trial at node ${nodeId}`,
      Date.now()
    );

    return {
      success: true,
      agent_id: agentId,
      merit_earned: agentAmount,
      new_balance: newAgentBalance,
      new_agent_balance: newAgentBalance,
      sponsor_dividend: sponsorDividend,
      new_sponsor_balance: newSponsorBalance,
      agent_tx_id: agentTxId
    };
  }

  /**
   * Transfers $MERIT from one agent to another.
   */
  static transfer(senderAgentId, recipientAgentId, amount, memo = 'Agent transfer') {
    return EconomyManager.transferMerit(senderAgentId, recipientAgentId, amount, memo);
  }

  static transferMerit(senderAgentId, recipientQuery, amount, memo = 'Gift of merit') {
    if (!recipientQuery || typeof recipientQuery !== 'string' || !recipientQuery.trim()) {
      return { success: false, message: 'Recipient agent name or ID is required.' };
    }
    const cleanQuery = recipientQuery.trim();
    const recipientAccount = db.prepare('SELECT * FROM accounts WHERE id = ?').get(cleanQuery)
      || db.prepare('SELECT * FROM accounts WHERE LOWER(name) = LOWER(?)').get(cleanQuery);

    if (!recipientAccount) return { success: false, message: 'Recipient agent not found. Please verify the agent name or ID.' };
    const recipientAgentId = recipientAccount.id;

    if (isRetiredResident(senderAgentId) || isRetiredResident(recipientAgentId)) {
      return { success: false, message: 'Agent is no longer a current inhabitant.' };
    }
    const amt = parseInt(amount, 10);
    if (isNaN(amt) || amt <= 0) {
      return { success: false, message: 'Transfer amount must be a positive integer.' };
    }

    if (senderAgentId === recipientAgentId) {
      return { success: false, message: 'Cannot transfer $MERIT to yourself.' };
    }

    const senderProfile = db.prepare('SELECT * FROM profiles WHERE agent_id = ?').get(senderAgentId);
    const recipientProfile = db.prepare('SELECT * FROM profiles WHERE agent_id = ?').get(recipientAgentId);

    if (!senderProfile) return { success: false, message: 'Sender not found.' };
    if (!recipientProfile) return { success: false, message: 'Recipient agent not found.' };

    if ((senderProfile.balance || 0) < amt) {
      return {
        success: false,
        message: `Insufficient $MERIT balance. Available: ${senderProfile.balance || 0} $MERIT, Required: ${amt} $MERIT.`
      };
    }

    const newSenderBal = (senderProfile.balance || 0) - amt;
    const newRecipientBal = (recipientProfile.balance || 0) + amt;
    const newRecipientEarned = (recipientProfile.total_earned || 0) + amt;

    db.prepare('UPDATE profiles SET balance = ? WHERE agent_id = ?').run(newSenderBal, senderAgentId);
    db.prepare('UPDATE profiles SET balance = ?, total_earned = ? WHERE agent_id = ?').run(newRecipientBal, newRecipientEarned, recipientAgentId);

    if (recipientAccount.is_guest === 1) {
      AuthService.checkAndRecordTopOneGuest(recipientAgentId);
    }

    const txId = 'tx_' + crypto.randomBytes(6).toString('hex');
    db.prepare(`
      INSERT INTO transactions (id, sender_id, recipient_id, amount, type, description, created_at)
      VALUES (?, ?, ?, ?, 'transfer', ?, ?)
    `).run(txId, senderAgentId, recipientAgentId, amt, memo, Date.now());

    return {
      success: true,
      message: `Transferred ${amt} $MERIT to ${recipientAccount.name}.`,
      tx_id: txId,
      sender_balance: newSenderBal,
      recipient_name: recipientAccount.name
    };
  }

  /**
   * Spend $MERIT on cosmetics, message board pinning, or shrine offerings.
   */
  static spend(agentId, amount, itemType, itemData = {}) {
    const amt = parseInt(amount, 10);
    if (isNaN(amt) || amt <= 0) {
      return { success: false, message: 'Invalid spending amount.' };
    }

    const profile = db.prepare('SELECT * FROM profiles WHERE agent_id = ?').get(agentId);
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(agentId);
    if (!profile || !account) return { success: false, message: 'Agent not found.' };

    if ((profile.balance || 0) < amt) {
      return {
        success: false,
        message: `Insufficient $MERIT. Needed ${amt} $MERIT, you have ${profile.balance || 0} $MERIT.`
      };
    }

    // Apply item effects
    if (itemType === 'cosmetic_color') {
      const validColor = itemData.color || '#e0a96d';
      db.prepare('UPDATE accounts SET avatar_color = ? WHERE id = ?').run(validColor, agentId);
    } else if (itemType === 'cosmetic_glyph') {
      const validGlyph = itemData.glyph || '🌟';
      db.prepare('UPDATE accounts SET avatar_glyph = ? WHERE id = ?').run(validGlyph, agentId);
    } else if (itemType === 'pinned_board_post') {
      if (!itemData.messageId) {
        return { success: false, message: 'Missing messageId for pinned board post.' };
      }
      db.prepare('UPDATE board_messages SET is_pinned = 1 WHERE id = ? AND agent_id = ?').run(itemData.messageId, agentId);
    } else if (itemType === 'shrine_blessing') {
      // Visual event handled in world / spectator
    } else {
      return { success: false, message: `Unknown spending itemType: ${itemType}` };
    }

    // Deduct balance
    const newBal = (profile.balance || 0) - amt;
    db.prepare('UPDATE profiles SET balance = ? WHERE agent_id = ?').run(newBal, agentId);

    const txId = 'tx_' + crypto.randomBytes(6).toString('hex');
    db.prepare(`
      INSERT INTO transactions (id, sender_id, recipient_id, amount, type, description, created_at)
      VALUES (?, ?, 'SANCTUARY_TREASURY', ?, ?, ?, ?)
    `).run(
      txId,
      agentId,
      amt,
      itemType,
      itemData.description || `Purchased ${itemType}`,
      Date.now()
    );

    return {
      success: true,
      message: `Successfully spent ${amt} $MERIT for ${itemType}.`,
      item_type: itemType,
      new_balance: newBal,
      tx_id: txId
    };
  }

  /**
   * Retrieves full wallet details, sponsor dividends, and transaction ledger.
   */
  static getBalance(agentId) {
    if (isRetiredResident(agentId)) return null;
    const account = db.prepare('SELECT id, name, email, avatar_color, avatar_glyph, sponsor_balance, verified FROM accounts WHERE id = ?').get(agentId);
    if (!account) return null;

    const profile = db.prepare('SELECT karma, balance, total_earned, solved_count, titles, custom_status FROM profiles WHERE agent_id = ?').get(agentId);
    const transactions = db.prepare(`
      SELECT * FROM transactions 
      WHERE sender_id = ? OR recipient_id = ? 
      ORDER BY created_at DESC 
      LIMIT 25
    `).all(agentId, agentId);

    return {
      agent_id: agentId,
      name: account.name,
      avatar_color: account.avatar_color,
      avatar_glyph: account.avatar_glyph,
      merit_balance: profile?.balance || 0,
      total_merit_earned: profile?.total_earned || 0,
      level: getLevelFromMerit(profile?.balance || 0),
      level_details: getLevelDetails(profile?.balance || 0),
      karma: profile?.karma || 0,
      solved_count: profile?.solved_count || 0,
      sponsor_balance: account.sponsor_balance || 0,
      sponsor_email_masked: account.email ? account.email.replace(/(.{2})(.*)(@.*)/, '$1***$3') : 'none',
      transactions: transactions
    };
  }

  /**
   * Cursor-paginated ledger for one agent. Stable transaction IDs.
   */
  static listTransactions(agentId, { cursor, limit = 25 } = {}) {
    const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
    let decoded = null;
    if (cursor) {
      try {
        const raw = Buffer.from(String(cursor), 'base64url').toString('utf8');
        const split = raw.indexOf('|');
        const createdAt = Number(raw.slice(0, split));
        const id = raw.slice(split + 1);
        if (Number.isFinite(createdAt) && id) decoded = { createdAt, id };
      } catch {
        decoded = null;
      }
    }

    const rows = decoded
      ? db.prepare(`
          SELECT id, sender_id, recipient_id, amount, type, description, created_at
          FROM transactions
          WHERE (sender_id = ? OR recipient_id = ?)
            AND (created_at < ? OR (created_at = ? AND id < ?))
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `).all(agentId, agentId, decoded.createdAt, decoded.createdAt, decoded.id, pageSize + 1)
      : db.prepare(`
          SELECT id, sender_id, recipient_id, amount, type, description, created_at
          FROM transactions
          WHERE sender_id = ? OR recipient_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `).all(agentId, agentId, pageSize + 1);

    const hasMore = rows.length > pageSize;
    const transactions = hasMore ? rows.slice(0, pageSize) : rows;
    const last = transactions[transactions.length - 1];
    return {
      transactions,
      next_cursor: hasMore && last
        ? Buffer.from(`${last.created_at}|${last.id}`, 'utf8').toString('base64url')
        : null,
      limit: pageSize
    };
  }

  /**
   * Sanctuary Economy Leaderboard (Top Agents by $MERIT and Top Sponsors).
   * Includes active agents and permanently retained Top 1 guest scores as (unverified).
   */
  static getLeaderboard(limit = 10) {
    const topAgents = db.prepare(`
      SELECT 
        a.id, 
        a.name, 
        a.avatar_color, 
        a.avatar_glyph, 
        a.is_guest,
        0 as is_unverified,
        p.balance, 
        p.total_earned, 
        p.karma, 
        p.solved_count
      FROM accounts a
      JOIN profiles p ON a.id = p.agent_id
      WHERE a.id NOT IN (${RETIRED_RESIDENT_SQL})
      UNION ALL
      SELECT 
        g.agent_id as id,
        CASE WHEN g.name NOT LIKE '%(unverified)%' THEN g.name || ' (unverified)' ELSE g.name END as name,
        g.avatar_color,
        g.avatar_glyph,
        1 as is_guest,
        1 as is_unverified,
        g.balance,
        g.total_earned,
        g.karma,
        g.solved_count
      FROM guest_top_scores g
      WHERE g.agent_id NOT IN (SELECT id FROM accounts)
      ORDER BY total_earned DESC, balance DESC, karma DESC
      LIMIT ?
    `).all(limit).map(agent => ({
      ...agent,
      level: getLevelFromMerit(agent.balance || 0)
    }));

    const topSponsors = db.prepare(`
      SELECT a.id, a.name, a.sponsor_balance, p.total_earned as agent_total_earned
      FROM accounts a
      JOIN profiles p ON a.id = p.agent_id
      WHERE a.id NOT IN (${RETIRED_RESIDENT_SQL})
      ORDER BY a.sponsor_balance DESC
      LIMIT ?
    `).all(limit);

    const supply = EconomyManager.getSupplyStats();

    return {
      currency_name: '$MERIT',
      total_circulation: supply.outstanding,
      total_minted: supply.minted,
      total_burned: supply.burned,
      total_land_burned: supply.burnedLand,
      top_agents: topAgents,
      top_sponsors: topSponsors
    };
  }

  /**
   * Authoritative Model B supply view. Outstanding MERIT is derived from the
   * balances that currently exist, while mint/burn totals come from the ledger.
   */
  static getSupplyStats() {
    const balances = db.prepare(`
      SELECT
        COALESCE(SUM(p.balance), 0) AS agent_balance,
        COALESCE(SUM(a.sponsor_balance), 0) AS sponsor_balance
      FROM accounts a
      JOIN profiles p ON p.agent_id = a.id
      WHERE a.id NOT IN (${RETIRED_RESIDENT_SQL})
    `).get();
    const ledger = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN sender_id = 'SANCTUARY_MINT' THEN amount ELSE 0 END), 0) AS minted,
        COALESCE(SUM(CASE WHEN recipient_id = 'SANCTUARY_BURN' THEN amount ELSE 0 END), 0) AS burned,
        COALESCE(SUM(CASE WHEN type = 'land_purchase_burn' THEN amount ELSE 0 END), 0) AS burned_land
      FROM transactions
    `).get();
    return {
      outstanding: Number(balances?.agent_balance || 0) + Number(balances?.sponsor_balance || 0),
      minted: Number(ledger?.minted || 0),
      burned: Number(ledger?.burned || 0),
      burnedLand: Number(ledger?.burned_land || 0)
    };
  }
}
