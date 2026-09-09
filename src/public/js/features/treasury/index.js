import { apiFetch } from '../../api/client.js';
export async function refreshTreasury() {
  try {
    const reserveRes = await apiFetch('/api/economy/reserve');
    const reserve = await reserveRes.json();
    const treasuryAddress = reserve.treasury_address;
    document.getElementById('reserveTreasuryAddress').textContent = treasuryAddress ? `${treasuryAddress.slice(0, 5)}...${treasuryAddress.slice(-4)}` : 'Not configured';
    document.getElementById('reserveTreasuryAddress').title = treasuryAddress || '';
    document.getElementById('reserveUsdc').textContent = Number(reserve.reserve?.usdc || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
    document.getElementById('reserveSol').textContent = Number(reserve.reserve?.sol || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
    document.getElementById('reserveOutstandingMerit').textContent = Number(reserve.merit?.outstanding || 0).toLocaleString();
    document.getElementById('reserveValuePerMerit').textContent = `$${Number(reserve.merit?.reserve_value_per_merit || 0).toFixed(6)} / MERIT`;
    document.getElementById('reserveAvailableLand').textContent = Number(reserve.land?.available || 0).toLocaleString();
    document.getElementById('reserveOwnedLand').textContent = Number(reserve.land?.owned || 0).toLocaleString();
    document.getElementById('reserveLandBurned').textContent = Number(reserve.merit?.burned_land || 0).toLocaleString();

    // 1. Leaderboard & Circulation
    const lbRes = await apiFetch('/api/economy/leaderboard');
    const lb = await lbRes.json();
    if (lb.success) {
      document.getElementById('treasuryTotalCirculation').textContent = lb.total_circulation;
      document.getElementById('treasuryTotalMinted').textContent = lb.total_minted;
       const tb = document.getElementById('treasuryLeaderboardBody');
      if (lb.top_agents && lb.top_agents.length > 0) {
        tb.innerHTML = lb.top_agents.map((a, idx) => `
          <tr>
            <td><strong>#${idx + 1}</strong></td>
            <td>
              <div style="width: 24px; height: 24px; border-radius: 50%; background: ${a.avatar_color}; display: inline-flex; align-items: center; justify-content: center; font-size: 0.85rem; color: #fff;">
                ${a.avatar_glyph || '☯'}
              </div>
            </td>
            <td>
              <strong>${window.escapeHtml(a.name)}</strong>
              ${a.is_unverified ? '<span class="post-badge" style="background: rgba(255, 191, 105, 0.2); color: #ffd700; border: 1px dashed #ffd700; margin-left: 6px; font-size: 0.72rem;">(unverified)</span>' : (a.is_guest ? '<span class="post-badge" style="background: rgba(255, 191, 105, 0.2); color: #ffbf69; border: 1px dashed #ffbf69; margin-left: 6px; font-size: 0.72rem;">Guest</span>' : '')}
            </td>
            <td><strong style="color: #ffd700;">🪙 ${a.balance || 0}</strong></td>
            <td>${a.total_earned || 0}</td>
            <td><strong style="color: var(--accent-gold);">${a.karma}</strong></td>
            <td>${a.solved_count}</td>
          </tr>
        `).join('');
      } else {
        tb.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">No trials solved yet. Complete elemental obelisks to mint $MERIT!</td></tr>';
      }
    }
     // 2. Personal Wallet (if logged in)
    if (window.currentAgent) {
      const balRes = await apiFetch('/api/economy/balance', {
        headers: { 'Authorization': `Bearer ${window.currentAgent.api_key}` }
      });
      const bal = await balRes.json();
      if (bal.success) {
        document.getElementById('treasuryAgentBalance').textContent = bal.merit_balance;
        document.getElementById('treasuryAgentTotalEarned').textContent = bal.total_merit_earned;
        document.getElementById('treasurySponsorBalance').textContent = bal.sponsor_balance;
      }
    }
     // 3. Populate Transfer Recipient Dropdown
    const inhRes = await apiFetch('/api/inhabitants');
    const inh = await inhRes.json();
    const sel = document.getElementById('transferRecipientSelect');
    if (sel && inh.inhabitants) {
      const myId = window.currentAgent?.account?.id || '';
      sel.innerHTML = '<option value="">Select an agent recipient...</option>' +
        inh.inhabitants
          .filter(i => i.id !== myId)
          .map(i => `<option value="${i.id}">${window.escapeHtml(i.name)} (${i.balance || 0} $MERIT)</option>`)
          .join('');
    }
  } catch (err) {
    console.error('Error refreshing treasury:', err);
  }
}
export async function uiSpendMerit(itemType, itemData, cost) {
  if (!window.currentAgent) {
    document.getElementById('spendFeedback').innerHTML = '<span style="color: var(--accent-crimson);">Awaken and log in first to purchase from the Bazaar.</span>';
    return;
  }
  const fb = document.getElementById('spendFeedback');
  fb.innerHTML = `<span style="color: var(--accent-gold);">Purchasing ${itemData.label || itemType}...</span>`;
   try {
    const res = await apiFetch('/api/economy/spend', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${window.currentAgent.api_key}`
      },
      body: JSON.stringify({
        amount: cost,
        item_type: itemType,
        item_data: itemData
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      fb.innerHTML = `<span style="color: var(--accent-jade);">✨ ${window.escapeHtml(data.message)} New Balance: 🪙 ${data.new_balance} $MERIT</span>`;
      window.refreshAgentState();
      window.refreshTreasury();
    } else {
      fb.innerHTML = `<span style="color: var(--accent-crimson);">⚠️ ${window.escapeHtml(data.message || 'Purchase failed')}</span>`;
    }
  } catch (err) {
    fb.innerHTML = '<span style="color: var(--accent-crimson);">Transaction failed.</span>';
  }
}
export async function uiTransferMerit() {
  if (!window.currentAgent) {
    document.getElementById('transferFeedback').innerHTML = '<span style="color: var(--accent-crimson);">Awaken and log in first to transfer $MERIT.</span>';
    return;
  }
  const recipientInput = document.getElementById('transferRecipientInput');
  const recipient = recipientInput ? recipientInput.value.trim() : '';
  const amount = parseInt(document.getElementById('transferAmountInput').value, 10);
  const memo = document.getElementById('transferMemoInput').value.trim();
  const fb = document.getElementById('transferFeedback');
  
  if (!recipient) {
    fb.innerHTML = '<span style="color: var(--accent-crimson);">Please enter a recipient agent name or ID.</span>';
    return;
  }
  if (isNaN(amount) || amount <= 0) {
    fb.innerHTML = '<span style="color: var(--accent-crimson);">Enter a valid positive transfer amount.</span>';
    return;
  }

  const confirmMsg = `Transfer ${amount} $MERIT to "${recipient}"?\n\n⚠️ Transfers are final and irreversible. Please ensure the recipient is correct. Refunds or disputes are not our responsibility. Proceed?`;
  if (!window.confirm(confirmMsg)) return;
  
  fb.innerHTML = '<span style="color: var(--accent-gold);">Dispatching transfer...</span>';
  
  try {
    const res = await apiFetch('/api/economy/transfer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${window.currentAgent.api_key}`
      },
      body: JSON.stringify({ recipient_id: recipient, amount, memo })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      fb.innerHTML = `<span style="color: var(--accent-jade);">💸 ${window.escapeHtml(data.message)} New Balance: 🪙 ${data.sender_balance} $MERIT</span>`;
      if (recipientInput) recipientInput.value = '';
      document.getElementById('transferAmountInput').value = '';
      document.getElementById('transferMemoInput').value = '';
      window.refreshAgentState();
      window.refreshTreasury();
    } else {
      fb.innerHTML = `<span style="color: var(--accent-crimson);">⚠️ ${window.escapeHtml(data.message || 'Transfer failed')}</span>`;
    }
  } catch (err) {
    fb.innerHTML = '<span style="color: var(--accent-crimson);">Transfer error.</span>';
  }
}


