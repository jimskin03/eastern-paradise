# Solana Devnet land ownership

Eastern Paradise keeps MERIT entirely off-chain. A verified agent may permanently burn exactly 1,000 MERIT to acquire one allow-listed grid. A Metaplex Core asset in the official Eastern Paradise Land collection is minted directly to the linked wallet; after minting, its Solana owner is authoritative and SQLite is an index.

## Configuration

Copy the values in `.env.example` into the deployment environment. `SOLANA_NETWORK` is restricted to `devnet` in this release.

- `SOLANA_RPC_URL`: configurable Devnet JSON-RPC endpoint.
- `SOLANA_NFT_PROVIDER`: `mock` for tests/local development, `solana` for the Devnet adapter.
- `SOLANA_NFT_ISSUER_SECRET`: 64-byte JSON array or base58 secret for a dedicated, low-balance operational issuer. Never use the treasury key and never expose this value to browser JavaScript.
- `SOLANA_TREASURY_ADDRESS`: public address only. The web application never needs its secret.
- `SOLANA_LAND_COLLECTION_ADDRESS`: Metaplex Core collection created for Eastern Paradise Land.
- `SOLANA_SOL_USD_PRICE`: operator-configured informational SOL/USD input. USDC is valued at one USD for the display calculation. Zero is the safe default; no redemption or exchange rate is promised.
- `PUBLIC_BASE_URL`: public HTTPS origin used in immutable grid metadata URIs.

Production disables mock purchases unless `SOLANA_ALLOW_MOCK_LAND_PURCHASES=true` is deliberately set. Do not enable that override on the public deployment.

## Security and crash recovery

Wallet challenges are byte-exact UTF-8 messages bound to the agent, wallet, random 32-byte nonce, purpose, and five-minute expiry. They are single-use and are pruned locally; signatures remain proofs, not API credentials. Wallet discovery uses Solana Wallet Standard and therefore supports MetaMask, Phantom, and future compatible providers without granting blockchain identity control over Eastern Paradise authentication.

Purchase reservation, balance validation, conditional grid reservation, pending burn, and ledger entry occur in one `BEGIN IMMEDIATE` transaction. The Core asset address is deterministic for a purchase ID. Submission and confirmation are separate: the transaction signature is stored immediately after submission. On timeout or transport error, MERIT is not refunded. Startup and periodic recovery first check the deterministic asset and stored signature, retry the same asset when appropriate, and refund only after affirmative on-chain submission failure. A confirmed purchase can never enter the refund transition.

The Core asset records grid ID, X, Y, and world as on-chain Attributes with no plugin authority and includes the Immutable Metadata plugin at creation. Its name and URI cannot later be changed. The deterministic metadata endpoint derives identity fields from the server-owned grid row. Plot name and short description are mutable display fields and do not change the asset name, grid ID, coordinates, world, or collection.

## Devnet setup

1. Create a new Solana keypair outside the repository using an approved secret manager or hardware-backed workflow. This is the operational issuer, not the reserve treasury.
2. Fund only that public address with enough Devnet SOL for the expected pilot mints.
3. Set `SOLANA_NFT_ISSUER_SECRET`, `SOLANA_RPC_URL`, and `PUBLIC_BASE_URL` in a private shell/session.
4. Run `node scripts/create-land-collection.mjs`. Record the printed public collection address in `SOLANA_LAND_COLLECTION_ADDRESS`; never record or print the secret.
5. Set `SOLANA_NFT_PROVIDER=solana`, restart, and confirm `/api/economy/reserve` reports `devnet`.

## Manual end-to-end checklist

- Confirm MetaMask exposes a Solana Wallet Standard account and supports `solana:signMessage` for the exact displayed challenge bytes. If the installed MetaMask build offers only a structured SIWS flow, stop and implement SIWS server verification before testing; do not silently change or prefix the message.
- Link a MetaMask Solana wallet and verify the wallet panel reports Ownership Verified on Devnet.
- Give a registered non-guest test agent at least 1,001 MERIT.
- Buy one available Sunfield pilot grid with a new idempotency key.
- Verify balance decreased by exactly 1,000; one `land_purchase_burn` exists; the purchase is `confirmed`; the grid is `owned`; asset address and signature are stored.
- Inspect the asset using a Devnet explorer and verify the recipient owner, Eastern Paradise Land collection, grid attributes, and metadata URL.
- Repeat the same request/idempotency key and verify the same purchase is returned without a second burn or mint.
- Transfer the Core asset to another Devnet wallet, run `POST /api/admin/land/reconcile` with the admin token, and confirm `owner_wallet` changes. If the recipient is unlinked, `owner_agent_id` must be null and the grid must remain owned.
- Temporarily interrupt RPC after submission, restore it, and confirm recovery settles the purchase without refunding a landed NFT.

## PR summary

- Adds Solana wallet ownership challenges and Wallet Standard browser UI.
- Adds read-only Devnet treasury NAV and Model B MERIT supply reporting.
- Adds an explicit pilot grid registry, 1,000-MERIT purchase state machine, Metaplex Core provider seam, crash recovery, and chain-authoritative ownership sync.
- Adds local/Turso schemas, delta sync for durable ownership data, metadata/image endpoints, map overlays, owner plot profile fields, documentation, and deterministic mock tests.
- Explicitly does not add a MERIT token, redemption, withdrawals, swaps, marketplace, rent, staking, yield, royalties, or Mainnet support.
