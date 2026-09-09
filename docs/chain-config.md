# Chain configuration control plane

Canonical public labels come from **`GET /api/chain/config`**. That payload describes **this process configuration only**. `live_cluster_proven` is always `false`: Git, a merged PR, Render YAML, or this document cannot prove the live cluster.

## Source-of-truth conflict (not resolved here)

| Source | What it says | Production weight |
|---|---|---|
| `origin/main` (`d11fdb0` and this branch) | Solana settlement: `loadSolanaConfig`, Metaplex Core land NFTs, Solana wallet auth, `SOLANA_*` env | **Authoritative code** until an approved, reviewed switch |
| Coordinator / profile memory and local `feat/bsc-evm-treasury` | Later BSC/EVM treasury + ERC-721 pivot | **Not on origin/main**. Unmerged local experiment. Not production truth |
| Phase 2 plan text | “Production uses Solana mainnet-beta” | Plan intent, **not** live proof. Repo default remains fail-closed **devnet** |
| `render.yaml` | Public Solana treasury + a committed Mainnet collection address; `SOLANA_NETWORK` / `SOLANA_ALLOW_MAINNET` / RPC / NFT provider are `sync: false` | Dashboard may differ from the repo. Do not infer live network from Git |

This slice **does not** switch networks, migrate wallets/providers, merge, deploy, or write treasury.

## Fail-closed defaults

- `SOLANA_NETWORK` defaults to `devnet`.
- `mainnet` / `mainnet-beta` require `SOLANA_ALLOW_MAINNET=true` and a matching mainnet RPC.
- The alias `mainnet` canonicalizes to `mainnet-beta`.
- Public responses never include RPC URLs, issuer secrets, API keys, or private keys.
- UI Network copy must follow `chain_label` from `/api/chain/config`, not hardcoded Mainnet copy.

## Remaining production assumptions

These stay unresolved until A.Ira verifies the **live** sanitized endpoint and deployment evidence:

1. Whether the public Render service actually has `SOLANA_ALLOW_MAINNET=true` (repo does not).
2. Whether dashboard `SOLANA_RPC_URL` matches the reported network (foot-gun exists only at process boot).
3. Whether `SOLANA_NFT_PROVIDER` is `mock` (purchases disabled in production) or `solana`.
4. Whether the committed Mainnet collection address is valid **on the cluster the process actually uses** (a Mainnet collection is not valid on Devnet).
5. Whether coordinator BSC memory will ever supersede Solana on `origin/main` — **not this PR**.
