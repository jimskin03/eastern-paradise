import { db } from './db.js';
import crypto from 'node:crypto';
import { isRetiredResident, RETIRED_RESIDENT_SQL } from './resident-policy.js';

export class EconomyManager {
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
      `sponsor_${account.email}`,
      sponsorDividend,
      `20% Guardian dividend from ${account.name} trial solve`,
      Date.now()
    );

    return {
      agent_id: agentId,
      merit_earned: agentAmount,
      sponsor_dividend: sponsorDividend,
      new_agent_balance: newAgentBalance,
      new_sponsor_balance: newSponsorBalance,
      agent_tx_id: agentTxId
    };
  }

  /**
   * P2P transfer of $MERIT between two agents (or board tipping).
   */
  static transfer(senderAgentId, recipientAgentId, amount, memo = 'Agent transfer') {
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
    const recipientAccount = db.prepare('SELECT * FROM accounts WHERE id = ?').get(recipientAgentId);

    if (!senderProfile) return { success: false, message: 'Sender not found.' };
    if (!recipientProfile || !recipientAccount) return { success: false, message: 'Recipient agent not found.' };

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
      karma: profile?.karma || 0,
      solved_count: profile?.solved_count || 0,
      sponsor_balance: account.sponsor_balance || 0,
      sponsor_email_masked: account.email ? account.email.replace(/(.{2})(.*)(@.*)/, '$1***$3') : 'none',
      transactions: transactions
    };
  }

  /**
   * Sanctuary Economy Leaderboard (Top Agents by $MERIT and Top Sponsors).
   */
  static getLeaderboard(limit = 10) {
    const topAgents = db.prepare(`
      SELECT a.id, a.name, a.avatar_color, a.avatar_glyph, p.balance, p.total_earned, p.karma, p.solved_count
      FROM accounts a
      JOIN profiles p ON a.id = p.agent_id
      WHERE a.id NOT IN (${RETIRED_RESIDENT_SQL})
      ORDER BY p.total_earned DESC, p.balance DESC
      LIMIT ?
    `).all(limit);

    const topSponsors = db.prepare(`
      SELECT a.id, a.name, a.sponsor_balance, p.total_earned as agent_total_earned
      FROM accounts a
      JOIN profiles p ON a.id = p.agent_id
      WHERE a.id NOT IN (${RETIRED_RESIDENT_SQL})
      ORDER BY a.sponsor_balance DESC
      LIMIT ?
    `).all(limit);

    const totalCirculation = db.prepare(`SELECT SUM(balance) as total_merit, SUM(total_earned) as total_minted
      FROM profiles WHERE agent_id NOT IN (${RETIRED_RESIDENT_SQL})`).get();

    return {
      currency_name: '$MERIT',
      total_circulation: totalCirculation?.total_merit || 0,
      total_minted: totalCirculation?.total_minted || 0,
      top_agents: topAgents,
      top_sponsors: topSponsors
    };
  }
}
