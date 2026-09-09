CREATE TABLE IF NOT EXISTS wallet_links (
  agent_id TEXT NOT NULL,
  chain TEXT NOT NULL DEFAULT 'solana',
  wallet_address TEXT NOT NULL UNIQUE,
  verified_at INTEGER NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (agent_id, wallet_address)
);

CREATE TABLE IF NOT EXISTS wallet_challenges (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  message TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS land_grids (
  grid_id TEXT PRIMARY KEY,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  zone_id TEXT,
  status TEXT NOT NULL DEFAULT 'unavailable',
  owner_agent_id TEXT,
  owner_wallet TEXT,
  nft_asset_address TEXT UNIQUE,
  purchase_id TEXT,
  purchased_at INTEGER,
  plot_name TEXT,
  plot_description TEXT,
  UNIQUE(x, y)
);

CREATE TABLE IF NOT EXISTS land_purchases (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  agent_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  grid_id TEXT NOT NULL,
  merit_cost INTEGER NOT NULL DEFAULT 1000,
  status TEXT NOT NULL,
  nft_asset_address TEXT,
  solana_signature TEXT,
  error_code TEXT,
  error_message TEXT,
  submit_attempts INTEGER NOT NULL DEFAULT 0,
  last_recovery_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
