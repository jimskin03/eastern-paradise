import { createSolanaClient } from '@metamask/connect-solana';

let cachedClient = null;
let isConnecting = false;

export async function getMetaMaskSolanaClient() {
  if (!cachedClient) {
    cachedClient = await createSolanaClient({
      dapp: {
        name: 'Eastern Paradise',
        url: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'
      }
    });
  }
  return cachedClient;
}

export function isMetaMaskAvailable() {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.ethereum?.isMetaMask ||
    window.solana?.isMetaMask ||
    window.navigator?.userAgent?.toLowerCase().includes('metamask')
  );
}

export function bytesToBase64(bytes) {
  let binary = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary);
}

export function formatWalletError(err) {
  const code = err?.code ?? err?.cause?.code;
  const msg = String(err?.message || '');
  if (code === 4001 || msg.includes('User rejected') || msg.includes('rejected')) {
    const rejErr = new Error('Wallet connection or signing was rejected in MetaMask.');
    rejErr.code = 4001;
    return rejErr;
  }
  if (code === -32002 || msg.includes('already pending')) {
    const pendErr = new Error('A wallet request is already pending. Please check MetaMask.');
    pendErr.code = -32002;
    return pendErr;
  }
  return err;
}

export async function connectMetaMask() {
  if (isConnecting) {
    const pendErr = new Error('A wallet request is already pending. Please check MetaMask.');
    pendErr.code = -32002;
    throw pendErr;
  }

  isConnecting = true;
  try {
    const client = await getMetaMaskSolanaClient();
    const wallet = client.getWallet();
    if (!wallet) {
      throw new Error('MetaMask Solana wallet not found. Please ensure MetaMask extension is installed.');
    }

    const connectFeature = wallet.features?.['standard:connect'];
    if (!connectFeature?.connect) {
      throw new Error('MetaMask does not support standard:connect.');
    }

    const { accounts } = await connectFeature.connect();
    if (!accounts || accounts.length === 0) {
      throw new Error('No Solana account was selected in MetaMask.');
    }

    const account = accounts.find(acc => acc.chains?.some(c => String(c).startsWith('solana:'))) || accounts[0];
    if (!account || !account.address) {
      throw new Error('Failed to retrieve Solana account address from MetaMask.');
    }

    return {
      wallet,
      account,
      address: account.address,
      providerName: 'MetaMask'
    };
  } catch (err) {
    throw formatWalletError(err);
  } finally {
    isConnecting = false;
  }
}

export async function signWithMetaMask(wallet, account, challengeMessage) {
  try {
    const signFeature = wallet.features?.['solana:signMessage'];
    if (!signFeature?.signMessage) {
      throw new Error('MetaMask does not support solana:signMessage.');
    }

    // Exact UTF-8 challenge bytes: do not prefix or modify
    const messageBytes = new TextEncoder().encode(challengeMessage);
    const signResults = await signFeature.signMessage({
      account,
      message: messageBytes
    });

    const [signed] = signResults;
    if (!signed?.signature) {
      throw new Error('No signature returned from MetaMask.');
    }

    return bytesToBase64(signed.signature);
  } catch (err) {
    throw formatWalletError(err);
  }
}

export async function connectAndSignMetaMask(challengeMessage) {
  const { wallet, account, address, providerName } = await connectMetaMask();
  const signature = await signWithMetaMask(wallet, account, challengeMessage);
  return { address, signature, providerName };
}

// Expose on window for browser consumers
if (typeof window !== 'undefined') {
  window.MetaMaskSolana = {
    getMetaMaskSolanaClient,
    isMetaMaskAvailable,
    connectMetaMask,
    signWithMetaMask,
    connectAndSignMetaMask,
    bytesToBase64,
    formatWalletError
  };
}
