import crypto from 'node:crypto';
import { withImmediateTransaction } from '../infrastructure/database/transactions.js';
import { GRID_PRICE_MERIT } from './grid-registry.js';

export class LandPurchaseError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function purchaseResponse(row) {
  return {
    success: row.status === 'confirmed',
    purchase_id: row.id,
    idempotency_key: row.idempotency_key,
    grid_id: row.grid_id,
    wallet_address: row.wallet_address,
    merit_cost: row.merit_cost,
    status: row.status,
    nft_asset_address: row.nft_asset_address || null,
    solana_signature: row.solana_signature || null,
    error_code: row.error_code || null,
    error_message: row.error_message || null,
    completed_at: row.completed_at || null
  };
}

export class GridPurchaseService {
  constructor({ db, assetProvider, metadataBaseUrl, collectionAddress = null, now = () => Date.now() }) {
    this.db = db;
    this.assetProvider = assetProvider;
    this.metadataBaseUrl = metadataBaseUrl.replace(/\/$/, '');
    this.collectionAddress = collectionAddress;
    this.now = now;
  }

  getByIdempotencyKey(key) {
    return this.db.prepare('SELECT * FROM land_purchases WHERE idempotency_key = ?').get(key) || null;
  }

  getPurchase(id) {
    return this.db.prepare('SELECT * FROM land_purchases WHERE id = ?').get(id) || null;
  }

  async purchase({ agent, walletAddress, gridId, idempotencyKey }) {
    const key = String(idempotencyKey || '').trim();
    if (!key || key.length > 160) throw new LandPurchaseError('IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required.', 400);
    if (!agent || agent.is_guest) throw new LandPurchaseError('REGISTERED_AGENT_REQUIRED', 'Guests cannot purchase Eastern Paradise land.', 403);

    const replay = this.getByIdempotencyKey(key);
    if (replay) {
      if (replay.agent_id !== agent.id || replay.wallet_address !== walletAddress || replay.grid_id !== gridId) {
        throw new LandPurchaseError('IDEMPOTENCY_KEY_MISMATCH', 'This idempotency key belongs to a different purchase request.', 409);
      }
      return purchaseResponse(replay);
    }

    const purchaseId = `lp_${crypto.randomBytes(12).toString('hex')}`;
    const prepared = await this.assetProvider.prepareLandAsset({ purchaseId, gridId });
    const now = this.now();

    withImmediateTransaction(this.db, () => {
      const repeated = this.getByIdempotencyKey(key);
      if (repeated) return;
      const link = this.db.prepare('SELECT agent_id FROM wallet_links WHERE agent_id = ? AND wallet_address = ?').get(agent.id, walletAddress);
      if (!link) throw new LandPurchaseError('VERIFIED_WALLET_REQUIRED', 'Purchase wallet must be linked and cryptographically verified.', 403);
      const account = this.db.prepare('SELECT is_guest FROM accounts WHERE id = ?').get(agent.id);
      if (!account || account.is_guest) throw new LandPurchaseError('REGISTERED_AGENT_REQUIRED', 'Guests cannot purchase Eastern Paradise land.', 403);
      const grid = this.db.prepare('SELECT * FROM land_grids WHERE grid_id = ?').get(gridId);
      if (!grid) throw new LandPurchaseError('GRID_NOT_FOUND', 'Grid not found.', 404);
      if (grid.status !== 'available') throw new LandPurchaseError('GRID_NOT_AVAILABLE', `Grid is ${grid.status} and cannot be purchased.`, 409);
      const profile = this.db.prepare('SELECT balance FROM profiles WHERE agent_id = ?').get(agent.id);
      if (!profile || profile.balance < GRID_PRICE_MERIT) {
        throw new LandPurchaseError('INSUFFICIENT_MERIT', `Exactly ${GRID_PRICE_MERIT} MERIT is required.`, 400);
      }
      const reserved = this.db.prepare(`
        UPDATE land_grids SET status = 'reserved', owner_agent_id = ?, owner_wallet = ?, purchase_id = ?, nft_asset_address = ?
        WHERE grid_id = ? AND status = 'available'
      `).run(agent.id, walletAddress, purchaseId, prepared.assetAddress, gridId);
      if (reserved.changes !== 1) throw new LandPurchaseError('GRID_NOT_AVAILABLE', 'Grid was reserved by another purchase.', 409);
      this.db.prepare(`
        INSERT INTO land_purchases
          (id, idempotency_key, agent_id, wallet_address, grid_id, merit_cost, status, nft_asset_address, submit_attempts, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, 0, ?, ?)
      `).run(purchaseId, key, agent.id, walletAddress, gridId, GRID_PRICE_MERIT, prepared.assetAddress, now, now);
      this.db.prepare('UPDATE profiles SET balance = balance - ? WHERE agent_id = ? AND balance >= ?').run(GRID_PRICE_MERIT, agent.id, GRID_PRICE_MERIT);
      this.db.prepare(`
        INSERT INTO transactions (id, sender_id, recipient_id, amount, type, description, created_at)
        VALUES (?, ?, 'SANCTUARY_BURN_PENDING', ?, 'land_purchase_burn_pending', ?, ?)
      `).run(`tx_land_${purchaseId}`, agent.id, GRID_PRICE_MERIT, `Pending land purchase burn for ${gridId} (${purchaseId})`, now);
    });

    const reservedPurchase = this.getPurchase(purchaseId) || this.getByIdempotencyKey(key);
    if (reservedPurchase.id !== purchaseId) return purchaseResponse(reservedPurchase);
    return this.submitAndReconcile(reservedPurchase);
  }

  async submitAndReconcile(purchase) {
    const grid = this.db.prepare('SELECT * FROM land_grids WHERE grid_id = ?').get(purchase.grid_id);
    withImmediateTransaction(this.db, () => {
      this.db.prepare(`UPDATE land_purchases SET status = 'minting', submit_attempts = submit_attempts + 1, updated_at = ? WHERE id = ? AND status IN ('reserved', 'minting')`).run(this.now(), purchase.id);
      this.db.prepare(`UPDATE land_grids SET status = 'minting' WHERE grid_id = ? AND status IN ('reserved', 'minting')`).run(purchase.grid_id);
    });

    try {
      const submission = await this.assetProvider.submitLandAsset({
        purchaseId: purchase.id,
        assetAddress: purchase.nft_asset_address,
        recipientWallet: purchase.wallet_address,
        collectionAddress: this.collectionAddress,
        name: `Eastern Paradise Grid #${grid.x}-${grid.y}`,
        metadataUri: `${this.metadataBaseUrl}/api/land/${encodeURIComponent(grid.grid_id)}/metadata`,
        grid
      });
      if (submission.signature) {
        this.db.prepare(`UPDATE land_purchases SET solana_signature = COALESCE(solana_signature, ?), updated_at = ? WHERE id = ?`).run(submission.signature, this.now(), purchase.id);
      }
      if (submission.alreadyConfirmed) {
        return this.confirm(purchase.id, submission);
      }
      const check = await this.assetProvider.checkLandAsset({
        assetAddress: purchase.nft_asset_address,
        signature: submission.signature
      });
      if (check.state === 'confirmed') return this.confirm(purchase.id, { ...submission, ...check });
      if (check.state === 'failed') return this.refund(purchase.id, 'MINT_FAILED_ON_CHAIN', check.error || 'Solana rejected the mint transaction.');
      return purchaseResponse(this.getPurchase(purchase.id));
    } catch (error) {
      if (error.definitive) return this.refund(purchase.id, 'MINT_SUBMISSION_FAILED', error.message);
      // A transport exception is ambiguous. Persist it for the reaper; do not
      // refund until asset/signature checks provide affirmative failure evidence.
      this.db.prepare(`UPDATE land_purchases SET error_code = 'MINT_OUTCOME_UNKNOWN', error_message = ?, updated_at = ? WHERE id = ?`).run(String(error.message).slice(0, 500), this.now(), purchase.id);
      return purchaseResponse(this.getPurchase(purchase.id));
    }
  }

  confirm(purchaseId, chain) {
    withImmediateTransaction(this.db, () => {
      const purchase = this.getPurchase(purchaseId);
      if (!purchase || purchase.status === 'confirmed') return;
      if (purchase.status === 'refunded') throw new Error('Safety invariant violated: an on-chain asset exists for a refunded purchase.');
      const linked = this.db.prepare('SELECT agent_id FROM wallet_links WHERE wallet_address = ?').get(chain.owner || purchase.wallet_address);
      const now = this.now();
      this.db.prepare(`
        UPDATE land_grids SET status = 'owned', owner_wallet = ?, owner_agent_id = ?, nft_asset_address = ?, purchased_at = ? WHERE grid_id = ?
      `).run(chain.owner || purchase.wallet_address, linked?.agent_id || null, chain.assetAddress || purchase.nft_asset_address, now, purchase.grid_id);
      this.db.prepare(`
        UPDATE land_purchases SET status = 'confirmed', nft_asset_address = ?, solana_signature = COALESCE(solana_signature, ?), error_code = NULL, error_message = NULL, updated_at = ?, completed_at = ? WHERE id = ?
      `).run(chain.assetAddress || purchase.nft_asset_address, chain.signature || null, now, now, purchaseId);
      this.db.prepare(`UPDATE transactions SET recipient_id = 'SANCTUARY_BURN', type = 'land_purchase_burn', description = ? WHERE id = ?`).run(`Permanent land purchase burn for ${purchase.grid_id} (${purchase.id})`, `tx_land_${purchase.id}`);
    });
    return purchaseResponse(this.getPurchase(purchaseId));
  }

  refund(purchaseId, code, message) {
    withImmediateTransaction(this.db, () => {
      const purchase = this.getPurchase(purchaseId);
      if (!purchase || purchase.status === 'refunded') return;
      if (purchase.status === 'confirmed') throw new Error('Confirmed land purchases cannot be refunded.');
      const now = this.now();
      this.db.prepare('UPDATE profiles SET balance = balance + ? WHERE agent_id = ?').run(GRID_PRICE_MERIT, purchase.agent_id);
      this.db.prepare(`UPDATE land_grids SET status = 'available', owner_agent_id = NULL, owner_wallet = NULL, nft_asset_address = NULL, purchase_id = NULL WHERE grid_id = ? AND purchase_id = ?`).run(purchase.grid_id, purchase.id);
      this.db.prepare(`UPDATE land_purchases SET status = 'refunded', error_code = ?, error_message = ?, updated_at = ?, completed_at = ? WHERE id = ?`).run(code, String(message).slice(0, 500), now, now, purchase.id);
      this.db.prepare(`UPDATE transactions SET recipient_id = 'SANCTUARY_BURN_CANCELLED', type = 'land_purchase_burn_refunded' WHERE id = ?`).run(`tx_land_${purchase.id}`);
      this.db.prepare(`INSERT INTO transactions (id, sender_id, recipient_id, amount, type, description, created_at) VALUES (?, 'SANCTUARY_REFUND', ?, ?, 'land_purchase_refund', ?, ?)`).run(`tx_refund_${purchase.id}`, purchase.agent_id, GRID_PRICE_MERIT, `Refund for unsuccessful land purchase ${purchase.grid_id} (${purchase.id})`, now);
    });
    return purchaseResponse(this.getPurchase(purchaseId));
  }

  async reconcilePurchase(purchaseId) {
    const purchase = this.getPurchase(purchaseId);
    if (!purchase || ['confirmed', 'refunded', 'failed'].includes(purchase.status)) return purchase ? purchaseResponse(purchase) : null;
    const check = await this.assetProvider.checkLandAsset({ assetAddress: purchase.nft_asset_address, signature: purchase.solana_signature });
    if (check.state === 'confirmed') return this.confirm(purchase.id, check);
    if (check.state === 'failed') return this.refund(purchase.id, 'MINT_FAILED_ON_CHAIN', check.error || 'Solana rejected the mint transaction.');
    // Unknown is not failure. Deterministically retry creation; duplicate asset
    // creation cannot succeed because the same Core asset address is reused.
    return this.submitAndReconcile(purchase);
  }

  async recoverStuck({ olderThanMs = 30_000 } = {}) {
    const cutoff = this.now() - olderThanMs;
    const stuck = this.db.prepare(`SELECT id FROM land_purchases WHERE status IN ('reserved', 'minting') AND updated_at <= ? ORDER BY updated_at LIMIT 25`).all(cutoff);
    const results = [];
    for (const row of stuck) results.push(await this.reconcilePurchase(row.id));
    return results;
  }
}
