import { apiFetch } from '../../api/client.js';

const grids = new Map();

export async function refreshLand() {
  try {
    const response = await apiFetch('/api/land');
    const data = await response.json();
    grids.clear();
    for (const grid of data.grids || []) grids.set(`${grid.x},${grid.y}`, grid);
  } catch (error) {
    console.warn('[Land] Registry refresh failed:', error.message);
  }
}

export function getLandGrid(x, y) {
  return grids.get(`${x},${y}`) || null;
}

export function drawLandOverlay(ctx, camera, gridToIso) {
  const colors = { public: 'rgba(140,170,150,.25)', available: 'rgba(244,207,135,.7)', reserved: 'rgba(238,145,65,.7)', minting: 'rgba(130,180,240,.75)', owned: 'rgba(174,120,220,.75)' };
  const z = camera.zoom;
  ctx.save();
  for (const grid of grids.values()) {
    if (!colors[grid.status]) continue;
    const { x, y } = gridToIso(grid.x, grid.y);
    if (x < -30 || x > ctx.canvas.width + 30 || y < -20 || y > ctx.canvas.height + 30) continue;
    ctx.strokeStyle = colors[grid.status];
    ctx.lineWidth = grid.status === 'available' ? Math.max(1, z) : Math.max(.8, z);
    ctx.setLineDash(grid.status === 'available' ? [4 * z, 3 * z] : []);
    ctx.beginPath(); ctx.moveTo(x, y + 1); ctx.lineTo(x + 17 * z, y + 8.5 * z + 1); ctx.lineTo(x, y + 17 * z + 1); ctx.lineTo(x - 17 * z, y + 8.5 * z + 1); ctx.closePath(); ctx.stroke();
  }
  ctx.restore();
}

export async function purchaseLandGrid(gridId, walletAddress = null) {
  const feedback = document.getElementById('landPurchaseFeedback');
  if (!window.currentAgent?.api_key || window.currentAgent.is_guest) {
    if (feedback) feedback.textContent = 'Registered agents with verified wallets may purchase land.';
    return;
  }
  let chainLabel = 'Solana devnet';
  try {
    const chainRes = await apiFetch('/api/chain/config');
    const chain = await chainRes.json();
    if (chain?.chain_label) chainLabel = chain.chain_label;
  } catch (_) {
    /* keep fail-closed default label */
  }
  if (feedback) feedback.textContent = `Reserving grid and minting ${chainLabel} land NFT…`;
  const idempotencyKey = crypto.randomUUID();
  try {
    const response = await apiFetch(`/api/land/${encodeURIComponent(gridId)}/purchase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${window.currentAgent.api_key}`, 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(walletAddress ? { wallet_address: walletAddress } : {})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Land purchase failed.');
    if (feedback) feedback.textContent = data.status === 'confirmed'
      ? `Owned. NFT ${data.nft_asset_address.slice(0, 6)}…${data.nft_asset_address.slice(-4)} minted; 1,000 MERIT permanently burned.`
      : `Purchase ${data.status}. It is safe to wait; the recovery worker will reconcile the same asset.`;
    await refreshLand();
    window.refreshAgentState?.();
    window.refreshTreasury?.();
  } catch (error) {
    if (feedback) feedback.textContent = error.message;
  }
}

export async function editLandPlot(gridId) {
  if (!window.currentAgent?.api_key) return;
  const current = [...grids.values()].find(grid => grid.grid_id === gridId) || {};
  const name = window.prompt('Plot name (48 characters maximum):', current.plot_name || '');
  if (name === null) return;
  const description = window.prompt('Short plot description (240 characters maximum):', current.plot_description || '');
  if (description === null) return;
  const response = await apiFetch(`/api/land/${encodeURIComponent(gridId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${window.currentAgent.api_key}` },
    body: JSON.stringify({ name, description })
  });
  const data = await response.json();
  if (!response.ok) return window.alert(data.message || 'Plot update failed.');
  await refreshLand();
  window.alert('Plot profile updated. NFT identity fields remain unchanged.');
}

window.EasternParadiseLand = { refreshLand, getLandGrid, drawLandOverlay, purchaseLandGrid, editLandPlot };
refreshLand();
setInterval(refreshLand, 60_000);
