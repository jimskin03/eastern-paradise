import { apiFetch } from '../../api/client.js';
import {
  connectMetaMask,
  signWithMetaMask,
  isMetaMaskAvailable,
  bytesToBase64,
  formatWalletError
} from '../../vendor/metamask-solana.bundle.js';

const discovered = new Map();

function registerWallets(...wallets) {
  for (const wallet of wallets.flat()) {
    if (wallet?.name && wallet?.features) discovered.set(wallet.name, wallet);
  }
  renderWalletChoices();
}

if (typeof window !== 'undefined') {
  window.addEventListener('wallet-standard:register-wallet', event => {
    if (typeof event.detail === 'function') event.detail(registerWallets);
  });
  window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: registerWallets }));
}

function shortAddress(address) {
  return address ? `${address.slice(0, 4)}...${address.slice(-4)}` : '—';
}

function renderWalletChoices() {
  const select = document.getElementById('solanaWalletChoice');
  if (!select) return;

  const choices = [];
  // MetaMask via @metamask/connect-solana
  if (isMetaMaskAvailable() || !discovered.size) {
    choices.push({ name: 'MetaMask', label: 'MetaMask (Solana)' });
  }

  // Generic Wallet Standard & window.solana wallets
  for (const wallet of discovered.values()) {
    if (wallet.name !== 'MetaMask' && wallet.features?.['solana:signMessage']) {
      choices.push({ name: wallet.name, label: wallet.name });
    }
  }

  if (typeof window !== 'undefined' && window.solana?.isPhantom && !discovered.has('Phantom')) {
    choices.push({ name: 'Phantom', label: 'Phantom' });
  }

  if (choices.length === 0) {
    choices.push({ name: 'MetaMask', label: 'MetaMask (Solana)' });
  }

  select.innerHTML = choices
    .map(w => `<option value="${window.escapeHtml(w.name)}">${window.escapeHtml(w.label)}</option>`)
    .join('');
}

async function signWithWalletStandard(wallet, message) {
  const account = wallet.accounts?.find(item => item.chains?.some(chain => String(chain).startsWith('solana:'))) || wallet.accounts?.[0];
  if (!account) throw new Error('The wallet did not expose a Solana account.');
  const signMessage = wallet.features?.['solana:signMessage']?.signMessage;
  if (!signMessage) throw new Error('This wallet does not support Solana message signing.');
  const [signed] = await signMessage({ account, message: new TextEncoder().encode(message) });
  return { address: account.address, signature: bytesToBase64(signed.signature), providerName: wallet.name };
}

async function signWithLegacyWallet(provider, message) {
  const publicKey = provider.publicKey;
  if (!publicKey) throw new Error('The wallet did not expose a Solana public key.');
  const signed = await provider.signMessage(new TextEncoder().encode(message), 'utf8');
  return {
    address: publicKey.toString(),
    signature: bytesToBase64(signed.signature || signed),
    providerName: provider.isMetaMask ? 'MetaMask' : (provider.isPhantom ? 'Phantom' : 'Solana Wallet')
  };
}

export async function connectSolanaWallet() {
  const feedback = document.getElementById('walletFeedback');
  if (!window.currentAgent?.api_key || window.currentAgent.is_guest) {
    if (feedback) feedback.textContent = 'A registered Eastern Paradise agent session is required.';
    return;
  }
  if (feedback) feedback.textContent = 'Requesting wallet connection…';

  try {
    const selectedName = document.getElementById('solanaWalletChoice')?.value || 'MetaMask';
    let address;
    let providerName;
    let sign;

    if (selectedName === 'MetaMask' || (!discovered.has(selectedName) && isMetaMaskAvailable())) {
      // Primary supported path: @metamask/connect-solana
      const mm = await connectMetaMask();
      address = mm.address;
      providerName = mm.providerName;
      sign = message => signWithMetaMask(mm.wallet, mm.account, message);
    } else if (discovered.has(selectedName)) {
      // Generic Wallet Standard provider (e.g. Phantom, Solflare, etc.)
      const wallet = discovered.get(selectedName);
      const connect = wallet.features?.['standard:connect']?.connect;
      if (connect) await connect();
      const account = wallet.accounts?.find(item => item.chains?.some(chain => String(chain).startsWith('solana:'))) || wallet.accounts?.[0];
      if (!account) throw new Error('The wallet did not expose a Solana account.');
      address = account.address;
      providerName = wallet.name;
      sign = message => signWithWalletStandard(wallet, message);
    } else if (window.solana?.signMessage) {
      // Legacy window.solana fallback (Phantom / Solflare)
      const connected = await window.solana.connect();
      address = (connected?.publicKey || window.solana.publicKey).toString();
      providerName = window.solana.isPhantom ? 'Phantom' : (window.solana.isMetaMask ? 'MetaMask' : 'Solana Wallet');
      sign = message => signWithLegacyWallet(window.solana, message);
    } else {
      throw new Error('No Solana Wallet Standard message-signing wallet was found. Please install MetaMask or a compatible Solana wallet.');
    }

    // Step 2: Request server challenge for this address
    const challengeResponse = await apiFetch('/api/wallet/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${window.currentAgent.api_key}` },
      body: JSON.stringify({ wallet_address: address })
    });
    const challenge = await challengeResponse.json();
    if (!challengeResponse.ok) throw new Error(challenge.message || 'Could not create wallet challenge.');

    // Step 3: Sign exact challenge bytes (no prefix or modification)
    const signatureBase64 = typeof sign === 'function' ? await sign(challenge.message) : sign.signature;

    // Step 4: Verify with server
    const verifyResponse = await apiFetch('/api/wallet/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${window.currentAgent.api_key}` },
      body: JSON.stringify({
        challenge_id: challenge.challenge_id,
        wallet_address: address,
        message: challenge.message,
        signature: signatureBase64,
        signature_encoding: 'base64'
      })
    });
    const verified = await verifyResponse.json();
    if (!verifyResponse.ok) throw new Error(verified.message || 'Wallet signature verification failed.');

    sessionStorage.setItem('ep_wallet_provider_name', providerName);
    if (feedback) feedback.textContent = 'Ownership verified.';
    await refreshSolanaWallet();
  } catch (error) {
    const formatted = formatWalletError(error);
    if (feedback) feedback.textContent = formatted.message;
  }
}

export async function refreshSolanaWallet() {
  renderWalletChoices();
  const status = document.getElementById('solanaWalletStatus');
  if (!status) return;
  if (!window.currentAgent?.api_key) {
    status.innerHTML = '<p>No wallet linked.</p>';
    return;
  }
  try {
    const response = await apiFetch('/api/wallet', { headers: { Authorization: `Bearer ${window.currentAgent.api_key}` } });
    const data = await response.json();
    const wallet = data.wallets?.find(item => item.is_primary) || data.wallets?.[0];
    if (!wallet) {
      status.innerHTML = '<p>No wallet linked.</p>';
      return;
    }
    const providerName = sessionStorage.getItem('ep_wallet_provider_name') || 'Solana Wallet';
    status.innerHTML = `<strong>${window.escapeHtml(providerName)}</strong><div class="wallet-address" title="${wallet.wallet_address}">${shortAddress(wallet.wallet_address)}</div><div class="verified-mark">✓ Ownership Verified</div><small>Network: ${window.escapeHtml(data.network)} · Land NFTs: ${wallet.land_nfts || 0}</small>`;
  } catch {
    status.innerHTML = '<p>Wallet status unavailable.</p>';
  }
}
