import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createCollection, mplCore } from '@metaplex-foundation/mpl-core';
import { createSignerFromKeypair, generateSigner, signerIdentity } from '@metaplex-foundation/umi';
import { decodeBase58, encodeBase58 } from '../src/blockchain/solana-client.js';

const network = String(process.env.SOLANA_NETWORK || 'devnet').trim().toLowerCase();
const allowMainnet = String(process.env.SOLANA_ALLOW_MAINNET || '').trim().toLowerCase() === 'true';
const isMainnet = network === 'mainnet' || network === 'mainnet-beta';
if (network !== 'devnet' && !(allowMainnet && isMainnet)) {
  throw new Error('This setup script creates a collection on Devnet only. Mainnet collection creation requires SOLANA_ALLOW_MAINNET=true to be set explicitly.');
}
const secretValue = String(process.env.SOLANA_NFT_ISSUER_SECRET || '').trim();
if (!secretValue) throw new Error('Set SOLANA_NFT_ISSUER_SECRET to the dedicated Devnet issuer key.');
const secret = secretValue.startsWith('[') ? Uint8Array.from(JSON.parse(secretValue)) : decodeBase58(secretValue);
if (secret.length !== 64) throw new Error('Issuer secret must contain exactly 64 bytes.');

const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const baseUrl = String(process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const umi = createUmi(rpcUrl).use(mplCore());
const issuer = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(secret));
umi.use(signerIdentity(issuer));
const collection = generateSigner(umi);
const result = await createCollection(umi, {
  collection,
  name: 'Eastern Paradise Land',
  uri: `${baseUrl}/api/land/collection/metadata`
}).sendAndConfirm(umi);

console.log(JSON.stringify({
  network: 'devnet',
  collection_address: String(collection.publicKey),
  transaction_signature: encodeBase58(result.signature),
  issuer_address: String(issuer.publicKey)
}, null, 2));

