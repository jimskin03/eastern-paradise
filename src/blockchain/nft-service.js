import crypto from 'node:crypto';
import { decodeBase58, encodeBase58 } from './solana-client.js';

export class LandAssetProvider {
  async prepareLandAsset() { throw new Error('prepareLandAsset must be implemented.'); }
  async submitLandAsset() { throw new Error('submitLandAsset must be implemented.'); }
  async checkLandAsset() { throw new Error('checkLandAsset must be implemented.'); }
  async getAssetOwner() { throw new Error('getAssetOwner must be implemented.'); }
}

export class MockLandAssetProvider extends LandAssetProvider {
  constructor() {
    super();
    this.assets = new Map();
    this.purchaseAssets = new Map();
    this.mintCalls = 0;
    this.failNextMint = null;
  }

  async prepareLandAsset({ purchaseId }) {
    return { assetAddress: encodeBase58(crypto.createHash('sha256').update(`asset:${purchaseId}`).digest()) };
  }

  async submitLandAsset({ purchaseId, assetAddress, recipientWallet, collectionAddress = 'mock-eastern-paradise-land' }) {
    if (this.purchaseAssets.has(purchaseId)) return { ...this.purchaseAssets.get(purchaseId), alreadySubmitted: true };
    this.mintCalls += 1;
    if (this.failNextMint) {
      const error = this.failNextMint;
      this.failNextMint = null;
      error.definitive = true;
      throw error;
    }
    const signature = encodeBase58(crypto.createHash('sha512').update(`signature:${purchaseId}`).digest());
    const result = { assetAddress, signature, owner: recipientWallet, collectionAddress };
    this.assets.set(assetAddress, { ...result });
    this.purchaseAssets.set(purchaseId, result);
    return result;
  }

  async checkLandAsset({ assetAddress, signature }) {
    const asset = this.assets.get(assetAddress);
    if (!asset) return { state: signature ? 'failed' : 'unknown' };
    return { state: 'confirmed', ...asset };
  }

  async getAssetOwner(assetAddress) {
    const asset = this.assets.get(assetAddress);
    if (!asset) throw new Error('Mock asset not found.');
    return { owner: asset.owner, collectionAddress: asset.collectionAddress };
  }

  transfer(assetAddress, newOwner) {
    const asset = this.assets.get(assetAddress);
    if (!asset) throw new Error('Mock asset not found.');
    asset.owner = newOwner;
  }
}

function parseIssuerSecret(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('NFT issuer secret is not configured.');
  if (raw.startsWith('[')) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('NFT issuer secret JSON must be a byte array.');
    return Uint8Array.from(parsed);
  }
  return decodeBase58(raw);
}

export class SolanaLandAssetProvider extends LandAssetProvider {
  constructor({ config }) {
    super();
    this.config = config;
    this.umi = null;
    this.sdk = null;
    this.rpcClient = null;
  }

  async initialize() {
    if (this.umi) return;
    const [{ createUmi }, core, umiSdk] = await Promise.all([
      import('@metaplex-foundation/umi-bundle-defaults'),
      import('@metaplex-foundation/mpl-core'),
      import('@metaplex-foundation/umi')
    ]);
    const umi = createUmi(this.config.rpcUrl).use(core.mplCore());
    const issuerBytes = parseIssuerSecret(this.config.issuerSecret);
    const keypair = umi.eddsa.createKeypairFromSecretKey(issuerBytes);
    umi.use(umiSdk.keypairIdentity(umiSdk.createSignerFromKeypair(umi, keypair)));
    this.umi = umi;
    this.sdk = { core, umiSdk };
    const { SolanaRpcClient } = await import('./solana-client.js');
    this.rpcClient = new SolanaRpcClient({ rpcUrl: this.config.rpcUrl });
  }

  async deterministicAssetSigner(purchaseId) {
    await this.initialize();
    const issuer = parseIssuerSecret(this.config.issuerSecret);
    const seed = crypto.createHmac('sha256', Buffer.from(issuer)).update(`eastern-paradise-land:${purchaseId}`).digest();
    const { Keypair } = await import('@solana/web3.js');
    const web3Keypair = Keypair.fromSeed(seed);
    return this.sdk.umiSdk.createSignerFromKeypair(
      this.umi,
      this.umi.eddsa.createKeypairFromSecretKey(web3Keypair.secretKey)
    );
  }

  async prepareLandAsset({ purchaseId }) {
    await this.initialize();
    const asset = await this.deterministicAssetSigner(purchaseId);
    return { assetAddress: String(asset.publicKey) };
  }

  async submitLandAsset({ purchaseId, assetAddress, recipientWallet, name, metadataUri, grid }) {
    await this.initialize();
    const { core, umiSdk } = this.sdk;
    const asset = await this.deterministicAssetSigner(purchaseId);
    if (String(asset.publicKey) !== assetAddress) throw new Error('Prepared asset address does not match deterministic signer.');
    try {
      const existing = await core.fetchAsset(this.umi, asset.publicKey);
      return {
        assetAddress: String(existing.publicKey),
        signature: null,
        owner: String(existing.owner),
        collectionAddress: this.config.collectionAddress,
        recovered: true,
        alreadyConfirmed: true
      };
    } catch {}

    try {
      const builder = core.create(this.umi, {
        asset,
        collection: umiSdk.publicKey(this.config.collectionAddress),
        owner: umiSdk.publicKey(recipientWallet),
        name,
        uri: metadataUri,
        plugins: [{
          type: 'Attributes',
          authority: core.pluginAuthority('None'),
          attributeList: [
            { key: 'Grid ID', value: grid.grid_id },
            { key: 'Grid X', value: String(grid.x) },
            { key: 'Grid Y', value: String(grid.y) },
            { key: 'World', value: 'Eastern Paradise' }
          ]
        }, { type: 'ImmutableMetadata' }]
      });
      const transaction = await builder.buildAndSign(this.umi);
      const rawSignature = await this.umi.rpc.sendTransaction(transaction);
      return {
        assetAddress: String(asset.publicKey),
        signature: encodeBase58(rawSignature),
        owner: recipientWallet,
        collectionAddress: this.config.collectionAddress
      };
    } catch (error) {
      try {
        const existing = await core.fetchAsset(this.umi, asset.publicKey);
        return {
          assetAddress: String(existing.publicKey),
          signature: null,
          owner: String(existing.owner),
          collectionAddress: this.config.collectionAddress,
          recovered: true,
          alreadyConfirmed: true
        };
      } catch {
        throw error;
      }
    }
  }

  async checkLandAsset({ assetAddress, signature }) {
    await this.initialize();
    try {
      const asset = await this.sdk.core.fetchAsset(this.umi, this.sdk.umiSdk.publicKey(assetAddress));
      return {
        state: 'confirmed',
        assetAddress,
        signature: signature || null,
        owner: String(asset.owner),
        collectionAddress: this.config.collectionAddress
      };
    } catch {}
    if (!signature) return { state: 'unknown' };
    return this.rpcClient.getSignatureStatus(signature);
  }

  async getAssetOwner(assetAddress) {
    await this.initialize();
    const asset = await this.sdk.core.fetchAsset(this.umi, this.sdk.umiSdk.publicKey(assetAddress));
    const updateAuthority = asset.updateAuthority;
    const collectionAddress = updateAuthority?.type === 'Collection'
      ? String(updateAuthority.address)
      : (updateAuthority?.__kind === 'Collection' ? String(updateAuthority.fields?.[0]) : null);
    return { owner: String(asset.owner), collectionAddress };
  }
}

export function createLandAssetProvider(config) {
  return config.nftMode === 'solana'
    ? new SolanaLandAssetProvider({ config })
    : new MockLandAssetProvider();
}
