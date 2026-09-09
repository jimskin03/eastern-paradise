import { apiFetch } from '../../api/client.js';

let lastKnownTreasuryAddress = '';

export async function copyTreasuryAddress() {
  const addr = lastKnownTreasuryAddress;
  const fb = document.getElementById('copyTreasuryFeedback');
  const btn = document.getElementById('btnCopyTreasury');
  if (!addr) {
    if (fb) fb.innerHTML = '<span style="color: var(--accent-crimson);">No treasury address available to copy.</span>';
    return;
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(addr);
    } else {
      const ta = document.createElement('textarea');
      ta.value = addr;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    if (btn) btn.textContent = '✅';
    if (fb) fb.innerHTML = '<span style="color: var(--accent-jade);">Treasury address copied to clipboard!</span>';
    setTimeout(() => {
      if (btn) btn.textContent = '📋';
      if (fb) fb.innerHTML = '';
    }, 2500);
  } catch (err) {
    if (fb) fb.innerHTML = '<span style="color: var(--accent-crimson);">Failed to copy address.</span>';
  }
}

export async function refreshTreasury(options = {}) {
  const force = Boolean(options && options.force);
  const refreshBtn = document.getElementById('btnRefreshReserve');
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.textContent = '↻ Refreshing…';
  }
  try {
    const url = force ? '/api/economy/reserve?force=1' : '/api/economy/reserve';
    const reserveRes = await apiFetch(url);
    const reserve = await reserveRes.json();
    const chainLabelEl = document.getElementById('reserveChainLabel');
    if (chainLabelEl) {
      chainLabelEl.textContent = reserve.chain_label || (reserve.network === 'devnet' ? 'Solana devnet' : `Solana ${reserve.network || 'devnet'}`);
    }
    const treasuryAddress = reserve.treasury_address;
    lastKnownTreasuryAddress = treasuryAddress || '';
    const addrEl = document.getElementById('reserveTreasuryAddress');
    if (addrEl) {
      addrEl.textContent = treasuryAddress ? `${treasuryAddress.slice(0, 5)}...${treasuryAddress.slice(-4)}` : 'Not configured';
      addrEl.title = treasuryAddress || '';
    }
    const copyBtn = document.getElementById('btnCopyTreasury');
    if (copyBtn) {
      copyBtn.style.display = treasuryAddress ? 'inline-block' : 'none';
    }

    const solUsdPrice = Number(reserve.reserve?.sol_usd_price || 0);
    const rateEl = document.getElementById('reserveSolRateLabel');
    if (rateEl) {
      rateEl.textContent = `(1 SOL ≈ $${solUsdPrice.toFixed(2)})`;
    }

    const usdcEl = document.getElementById('reserveUsdc');
    if (usdcEl) {
      usdcEl.textContent = Number(reserve.reserve?.usdc || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
    }

    const solEl = document.getElementById('reserveSol');
    if (solEl) {
      solEl.textContent = Number(reserve.reserve?.sol || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
    }

    const outMeritEl = document.getElementById('reserveOutstandingMerit');
    if (outMeritEl) {
      outMeritEl.textContent = Number(reserve.merit?.outstanding || 0).toLocaleString();
    }

    const valEl = document.getElementById('reserveValuePerMerit');
    if (valEl) {
      valEl.textContent = `$${Number(reserve.merit?.reserve_value_per_merit || 0).toFixed(5)} / MERIT`;
    }

    const availEl = document.getElementById('reserveAvailableLand');
    if (availEl) {
      availEl.textContent = Number(reserve.land?.available || 0).toLocaleString();
    }

    const ownedEl = document.getElementById('reserveOwnedLand');
    if (ownedEl) {
      ownedEl.textContent = Number(reserve.land?.owned || 0).toLocaleString();
    }

    const burnedEl = document.getElementById('reserveLandBurned');
    if (burnedEl) {
      burnedEl.textContent = Number(reserve.merit?.burned_land || 0).toLocaleString();
    }

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
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.textContent = '↻ Refresh';
    }
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


