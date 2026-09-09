# Chain configuration control plane

Canonical public labels come from **`GET /api/chain/config`**. That payload describes **this process configuration only**. `live_cluster_proven` is always `false`: Git, a merged PR, Render YAML, or this document cannot prove the live cluster.

## Decision (Gregy666)

Exact decision recorded for Phase 2:

> Solana mainnet-beta is the canonical production target for Phase 2. Proceed with the plan’s Solana 2T-1/2T-2 implementation, while retaining explicit mainnet safeguards, fail-closed devnet-safe local/test defaults, sanitized public output, and consistency validation. Do not deploy, alter production secrets/config, merge, or execute treasury writes.

Safeguards retained in this branch:

- Production **target** is `mainnet-beta` (`production_target`), not a live cluster claim.
- Repository/local defaults remain fail-closed **devnet**.
- `SOLANA_NETWORK=mainnet-beta` requires `SOLANA_ALLOW_MAINNET=true` and a matching mainnet RPC.
- Public output never includes RPC URLs, issuer secrets, or API keys.
- Consistency validation rejects contradictory network/label/RPC combinations.
- No deploy, production secret/config change, merge, or treasury write is performed by this slice.

## Source-of-truth

| Source | What it says | Production weight |
|---|---|---|
| `origin/main` | Solana settlement: `loadSolanaConfig`, Metaplex Core land NFTs, Solana wallet auth, `SOLANA_*` env | **Authoritative code** |
| Coordinator / local `feat/bsc-evm-treasury` | Later BSC/EVM treasury + ERC-721 pivot | **Not on origin/main**. Not production truth |
| Phase 2 / Gregy666 decision | Canonical production **target** is Solana mainnet-beta | Plan intent, **not** live proof |
| `render.yaml` | Public Solana treasury + committed collection; network flags are `sync: false` | Dashboard may differ from Git |

## Fail-closed defaults

- `SOLANA_NETWORK` defaults to `devnet`.
- `mainnet` / `mainnet-beta` require `SOLANA_ALLOW_MAINNET=true` and a matching mainnet RPC.
- The alias `mainnet` canonicalizes to `mainnet-beta`.
- UI Network copy must follow `chain_label` from `/api/chain/config`.

## 2T-2 control plane

- `GET /api/economy/balance` and `GET /api/economy/transactions` require authentication.
- Unauthenticated `?agent_id=` ledger access is rejected.
- Roles are deny-by-default: `player`, `treasury_viewer`, `treasury_operator`, `admin`.
- Mint/burn HTTP routes do not execute treasury writes.
- Per-action rate limits use a privacy-safe account hash, never raw API keys.
- Idempotency-Key prevents duplicate spend/transfer effects.
- `economy_audit` is append-only and stores no credentials.
