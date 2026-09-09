import crypto from 'node:crypto';
import { Contract, Wallet, getAddress } from 'ethers';
import { createProvider, isEvmAddress } from './bsc-client.js';
export class EvmLandAssetProvider {
  constructor({ config }) { this.config=config; this.assets=new Map(); this.purchaseAssets=new Map(); this.mintCalls=0; this.failNextMint=null; }
  async prepareLandAsset({ purchaseId }) { return { assetAddress: `0x${crypto.createHash('sha256').update(`land:${purchaseId}`).digest('hex').slice(0,40)}` }; }
  async submitLandAsset({ purchaseId, assetAddress, recipientWallet, metadataUri }) {
    if (this.purchaseAssets.has(purchaseId)) return { ...this.purchaseAssets.get(purchaseId), alreadySubmitted:true };
    this.mintCalls++; if (this.failNextMint) { const e=this.failNextMint; this.failNextMint=null; e.definitive=true; throw e; }
    const provider=createProvider(this.config); await provider.getNetwork();
    const issuer=new Wallet(this.config.issuerPrivateKey, provider); const contract=new Contract(this.config.collectionAddress, ['function mint(address to, string uri) returns (uint256)'], issuer);
    const tx=await contract.mint(recipientWallet, metadataUri); const receipt=await tx.wait();
    const result={assetAddress, signature:receipt.hash, owner:getAddress(recipientWallet), collectionAddress:this.config.collectionAddress, alreadyConfirmed:true}; this.purchaseAssets.set(purchaseId,result); this.assets.set(assetAddress,result); return result;
  }
  async checkLandAsset({ assetAddress, signature }) { const asset=this.assets.get(assetAddress); if(asset) return {state:'confirmed',...asset}; if(!signature) return {state:'unknown'}; return {state:'pending'}; }
  async getAssetOwner(assetAddress) { const asset=this.assets.get(assetAddress); if(!asset) throw new Error('On-chain asset owner lookup requires an indexed ERC-721 adapter.'); return {owner:asset.owner, collectionAddress:asset.collectionAddress}; }
}
export class MockLandAssetProvider extends EvmLandAssetProvider {
  constructor(){ super({config:{}}); }
  async submitLandAsset({purchaseId,assetAddress,recipientWallet,collectionAddress='mock-bsc-land'}) { if(this.purchaseAssets.has(purchaseId)) return {...this.purchaseAssets.get(purchaseId),alreadySubmitted:true}; this.mintCalls++; if(this.failNextMint){const e=this.failNextMint;this.failNextMint=null;e.definitive=true;throw e;} const result={assetAddress,signature:`0x${crypto.createHash('sha256').update(`tx:${purchaseId}`).digest('hex')}`,owner:getAddress(recipientWallet),collectionAddress,alreadyConfirmed:true}; this.assets.set(assetAddress,result);this.purchaseAssets.set(purchaseId,result);return result; }
  transfer(assetAddress,newOwner){const asset=this.assets.get(assetAddress);if(!asset) throw new Error('Mock asset not found.');asset.owner=getAddress(newOwner);}
}
export function createLandAssetProvider(config){ return config.nftMode==='evm' ? new EvmLandAssetProvider({config}) : new MockLandAssetProvider(); }
