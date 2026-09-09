# BSC/EVM migration and rollback

Eastern Paradise uses BSC/EVM for wallet linking, the reserve, and land settlement.

## Networks and safety gates

- Default: BSC testnet (`chainId=97`, USDC has 18 decimals).
- Mainnet (`chainId=56`) is rejected unless `BSC_NETWORK=mainnet` **and** `BSC_ALLOW_MAINNET=true` are explicitly set.
- The configured RPC is checked with `eth_chainId`; mismatch aborts reserve reads and signing flows.
- BUSD is not supported. The configured USDC addresses are the Binance-Peg contracts in the migration fact sheet.

## Wallet authentication

`POST /api/wallet/challenge` returns an address-bound, nonce-bound challenge containing the expected chain ID. The client signs the exact UTF-8 message with `personal_sign`; verification recovers the signer with EIP-191 rules, compares the checksummed address, enforces expiry and consumes the challenge once. A submitted `chain_id` must equal the server's configured chain.

## Reserve and minting

Native BNB and BEP-20 USDC balances are read as `bigint` values and formatted with 18 decimals. Land uses an ERC-721-compatible issuer EOA (`BSC_NFT_ISSUER_PRIVATE_KEY`) separate from the treasury address. The issuer is only used when `BSC_NFT_PROVIDER=evm`; no private key is committed or returned by an API.

## Testnet-first rollout

1. Deploy with `BSC_NETWORK=testnet`, the official testnet RPC, `BSC_NFT_PROVIDER=mock`, and no mainnet opt-in.
2. Exercise challenge/verify, chain mismatch, reserve reads, idempotent land mint, ambiguous RPC recovery, and issuer-only minting against testnet.
3. Configure the real ERC-721 collection and issuer only after review; keep `BSC_ALLOW_MAINNET=false`.
4. Mainnet is an explicit change: update network/RPC/token address and set `BSC_ALLOW_MAINNET=true` in a reviewed deployment change.

## Rollback

- Stop land purchases by setting `BSC_ALLOW_MOCK_LAND_PURCHASES=false` and use `BSC_NFT_PROVIDER=mock` only for non-production recovery tests.
- Do not retry an ambiguous mint blindly. Reconcile by purchase id and transaction hash; the same deterministic asset key prevents duplicate settlement.
- If RPC chain verification fails, keep the service up but show a stale/zero reserve; correct the RPC before enabling settlement.
- Preserve the SQLite/Turso ledger and purchase rows. Roll back application code to the previous release only after recording any confirmed transaction hashes; never attempt an on-chain reversal automatically.

The former Solana implementation remains only as historical compatibility code for old fixtures; production server wiring and Render configuration are BSC-only.
