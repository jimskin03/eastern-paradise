import { apiFetch } from '../../api/client.js';

const BSC_TESTNET_CHAIN_ID = 97;
const BSC_MAINNET_CHAIN_ID = 56;
const chainIdNumber = value => Number.parseInt(String(value), 16);
function authHeaders() { return { 'Content-Type': 'application/json', Authorization: `Bearer ${window.currentAgent.api_key}` }; }
function shortAddress(address) { return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—'; }
function ethereum() { if (!window.ethereum?.request) throw new Error('Install an EVM wallet such as MetaMask to continue.'); return window.ethereum; }

async function ensureBscChain(provider, expectedChainId = BSC_TESTNET_CHAIN_ID) {
  const actual = chainIdNumber(await provider.request({ method: 'eth_chainId' }));
  if (actual !== expectedChainId) throw new Error(`Wrong network. Select BSC ${expectedChainId === 97 ? 'Testnet' : 'Mainnet'} (chainId ${expectedChainId}).`);
  return actual;
}

export async function connectEvmWallet() {
  const feedback = document.getElementById('walletFeedback');
  if (!window.currentAgent?.api_key || window.currentAgent.is_guest) { if (feedback) feedback.textContent = 'A registered Eastern Paradise agent session is required.'; return; }
  try {
    if (feedback) feedback.textContent = 'Requesting BSC wallet connection…';
    const provider = ethereum();
    const [address] = await provider.request({ method: 'eth_requestAccounts' });
    const chainId = await ensureBscChain(provider);
    const challengeResponse = await apiFetch('/api/wallet/challenge', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ wallet_address: address }) });
    const challenge = await challengeResponse.json();
    if (!challengeResponse.ok) throw new Error(challenge.message || 'Could not create wallet challenge.');
    const signature = await provider.request({ method: 'personal_sign', params: [challenge.message, address] });
    const verifyResponse = await apiFetch('/api/wallet/verify', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ challenge_id: challenge.challenge_id, wallet_address: address, message: challenge.message, signature, chain_id: chainId }) });
    const verified = await verifyResponse.json();
    if (!verifyResponse.ok) throw new Error(verified.message || 'Wallet signature verification failed.');
    sessionStorage.setItem('ep_wallet_provider_name', 'EVM Wallet');
    if (feedback) feedback.textContent = 'BSC ownership verified.';
    await refreshEvmWallet();
  } catch (error) { if (feedback) feedback.textContent = error.message || 'Wallet connection failed.'; }
}

export async function refreshEvmWallet() {
  const status = document.getElementById('evmWalletStatus') || document.getElementById('solanaWalletStatus');
  if (!status) return;
  if (!window.currentAgent?.api_key) { status.innerHTML = '<p>No wallet linked.</p>'; return; }
  try {
    const response = await apiFetch('/api/wallet', { headers: { Authorization: `Bearer ${window.currentAgent.api_key}` } });
    const data = await response.json(); const wallet = data.wallets?.find(item => item.is_primary) || data.wallets?.[0];
    if (!wallet) { status.innerHTML = '<p>No wallet linked.</p>'; return; }
    status.innerHTML = `<strong>EVM Wallet</strong><div class="wallet-address" title="${window.escapeHtml(wallet.wallet_address)}">${shortAddress(wallet.wallet_address)}</div><div class="verified-mark">✓ Ownership Verified</div><small>Network: ${window.escapeHtml(data.network)} · Land NFTs: ${wallet.land_nfts || 0}</small>`;
  } catch { status.innerHTML = '<p>Wallet status unavailable.</p>'; }
}

// Backward-compatible UI exports while the DOM rolls over to EVM labels.
export const connectSolanaWallet = connectEvmWallet;
export const refreshSolanaWallet = refreshEvmWallet;
window.EasternParadiseWallet = { connectEvmWallet, refreshEvmWallet };
refreshEvmWallet();
