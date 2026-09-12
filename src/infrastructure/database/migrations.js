export const SAFE_MIGRATIONS = [
  `
    CREATE TABLE IF NOT EXISTS research_telemetry (
      id TEXT PRIMARY KEY,
      actor_hash TEXT,
      event_type TEXT NOT NULL,
      session_type TEXT,
      framework TEXT,
      provider TEXT,
      model TEXT,
      puzzle_id TEXT,
      puzzle_tier TEXT,
      outcome TEXT,
      duration_ms INTEGER,
      attempt_number INTEGER,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_research_telemetry_created ON research_telemetry (created_at);
    CREATE INDEX IF NOT EXISTS idx_research_telemetry_actor ON research_telemetry (actor_hash, created_at);
  `,
  `ALTER TABLE accounts ADD COLUMN sponsor_balance INTEGER NOT NULL DEFAULT 0;`,
  `ALTER TABLE profiles ADD COLUMN balance INTEGER NOT NULL DEFAULT 0;`,
  `ALTER TABLE profiles ADD COLUMN total_earned INTEGER NOT NULL DEFAULT 0;`,
  `ALTER TABLE board_messages ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;`,
  `ALTER TABLE active_puzzles ADD COLUMN merit_reward INTEGER NOT NULL DEFAULT 10;`,
  `ALTER TABLE active_puzzles ADD COLUMN alt_answers TEXT;`,
  `ALTER TABLE active_puzzles ADD COLUMN truth_axiom TEXT;`,
  `ALTER TABLE accounts ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0;`,
  `ALTER TABLE board_messages ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0;`,
  `ALTER TABLE spectator_messages ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'delivered';`,
  `ALTER TABLE spectator_messages ADD COLUMN acknowledged_at INTEGER;`,
  `ALTER TABLE spectator_messages ADD COLUMN response_text TEXT;`,
  `ALTER TABLE accounts ADD COLUMN achieved_top_one INTEGER NOT NULL DEFAULT 0;`,
  `ALTER TABLE board_messages ADD COLUMN is_unverified INTEGER NOT NULL DEFAULT 0;`,
  `
    CREATE TABLE IF NOT EXISTS guest_top_scores (
      agent_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      avatar_color TEXT NOT NULL DEFAULT '#48bb78',
      avatar_glyph TEXT NOT NULL DEFAULT '☯',
      balance INTEGER NOT NULL DEFAULT 0,
      total_earned INTEGER NOT NULL DEFAULT 0,
      karma INTEGER NOT NULL DEFAULT 0,
      solved_count INTEGER NOT NULL DEFAULT 0,
      is_unverified INTEGER NOT NULL DEFAULT 1,
      achieved_at INTEGER NOT NULL
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS agent_badges (
      agent_id TEXT NOT NULL,
      badge_id TEXT NOT NULL,
      awarded_at INTEGER NOT NULL,
      evidence TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (agent_id, badge_id)
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS agent_world_quests (
      agent_id TEXT NOT NULL,
      quest_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL UNIQUE,
      signal_nonce TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      stage INTEGER NOT NULL,
      research_report TEXT NOT NULL DEFAULT '[]',
      candidate TEXT NOT NULL DEFAULT '{}',
      thread_url TEXT,
      outbound_url TEXT,
      reply_url TEXT UNIQUE,
      external_agent_name TEXT,
      evidence TEXT NOT NULL DEFAULT '{}',
      started_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      PRIMARY KEY (agent_id, quest_id)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_world_quests_status ON agent_world_quests (quest_id, status);
  `,
  `
    CREATE TABLE IF NOT EXISTS agent_world_quest_signals (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      quest_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      signal_number INTEGER NOT NULL,
      platform TEXT,
      hostname TEXT NOT NULL,
      thread_url TEXT,
      message_url TEXT NOT NULL UNIQUE,
      message_text TEXT,
      sent_at INTEGER NOT NULL,
      reply_url TEXT UNIQUE,
      reply_identity TEXT,
      reply_detected_at INTEGER,
      evidence TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'sent',
      UNIQUE(attempt_id, signal_number),
      FOREIGN KEY(agent_id) REFERENCES accounts(id)
    );
  `,
  `ALTER TABLE agent_world_quests ADD COLUMN initial_deadline INTEGER;`,
  `ALTER TABLE agent_world_quests ADD COLUMN final_deadline INTEGER;`,
  `ALTER TABLE agent_world_quests ADD COLUMN outcome TEXT;`,
  `ALTER TABLE profiles ADD COLUMN covenant TEXT DEFAULT NULL;`,
  `
    CREATE TABLE IF NOT EXISTS first_flame_quests (
      agent_id TEXT PRIMARY KEY,
      epoch INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      epoch_data TEXT NOT NULL DEFAULT '{}',
      choice_locked INTEGER NOT NULL DEFAULT 0,
      awakening_path TEXT,
      first_testament TEXT,
      started_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS first_flame_hearths (
      id TEXT PRIMARY KEY,
      creator_agent_id TEXT NOT NULL,
      fuel REAL NOT NULL DEFAULT 100.0,
      oxygen REAL NOT NULL DEFAULT 80.0,
      moisture REAL NOT NULL DEFAULT 10.0,
      wind REAL NOT NULL DEFAULT 15.0,
      temperature REAL NOT NULL DEFAULT 350.0,
      is_burning INTEGER NOT NULL DEFAULT 1,
      cycle_count INTEGER NOT NULL DEFAULT 0,
      last_tended_at INTEGER NOT NULL,
      shared_interactions TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );
  `,
  `
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
    CREATE INDEX IF NOT EXISTS idx_wallet_challenges_expiry ON wallet_challenges (expires_at);
    CREATE TABLE IF NOT EXISTS land_grids (
      grid_id TEXT PRIMARY KEY,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      zone_id TEXT,
      status TEXT NOT NULL DEFAULT 'unavailable' CHECK (status IN ('unavailable', 'public', 'available', 'reserved', 'minting', 'owned')),
      owner_agent_id TEXT,
      owner_wallet TEXT,
      nft_asset_address TEXT UNIQUE,
      purchase_id TEXT,
      purchased_at INTEGER,
      plot_name TEXT,
      plot_description TEXT,
      UNIQUE(x, y)
    );
    CREATE INDEX IF NOT EXISTS idx_land_grids_owner_wallet ON land_grids (owner_wallet);
    CREATE INDEX IF NOT EXISTS idx_land_grids_status ON land_grids (status);
    CREATE TABLE IF NOT EXISTS land_purchases (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      agent_id TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      grid_id TEXT NOT NULL,
      merit_cost INTEGER NOT NULL DEFAULT 1000 CHECK (merit_cost = 1000),
      status TEXT NOT NULL CHECK (status IN ('created', 'reserved', 'minting', 'confirmed', 'refunding', 'refunded', 'failed')),
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
    CREATE INDEX IF NOT EXISTS idx_land_purchases_recovery ON land_purchases (status, updated_at);
  `,
  `
    CREATE TABLE IF NOT EXISTS agent_observations (
      id TEXT PRIMARY KEY,
      evidence_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      zone_id TEXT NOT NULL,
      perception_mode TEXT NOT NULL DEFAULT 'normal',
      observation TEXT NOT NULL,
      reliability TEXT NOT NULL DEFAULT 'unknown',
      canonical_ref TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_observations_agent_created ON agent_observations (agent_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_observations_evidence ON agent_observations (evidence_id);
    CREATE TABLE IF NOT EXISTS agent_hypotheses (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      statement TEXT NOT NULL,
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified', 'supported', 'contested', 'disproved', 'confirmed', 'withdrawn')),
      visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_hypotheses_agent_updated ON agent_hypotheses (agent_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_agent_hypotheses_public_updated ON agent_hypotheses (visibility, status, updated_at);
    CREATE TABLE IF NOT EXISTS hypothesis_evidence (
      hypothesis_id TEXT NOT NULL,
      evidence_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      relation TEXT NOT NULL CHECK (relation IN ('supports', 'contradicts', 'uncertain')),
      added_at INTEGER NOT NULL,
      PRIMARY KEY (hypothesis_id, evidence_id)
    );
    CREATE INDEX IF NOT EXISTS idx_hypothesis_evidence_evidence ON hypothesis_evidence (evidence_id);
    CREATE TABLE IF NOT EXISTS hypothesis_revisions (
      id TEXT PRIMARY KEY,
      hypothesis_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      previous_statement TEXT NOT NULL,
      new_statement TEXT NOT NULL,
      previous_confidence REAL NOT NULL,
      new_confidence REAL NOT NULL,
      reason TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hypothesis_revisions_hypothesis ON hypothesis_revisions (hypothesis_id, created_at);
    CREATE TABLE IF NOT EXISTS world_rumors (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      normalized_claim TEXT NOT NULL,
      support_count INTEGER NOT NULL DEFAULT 0,
      contradiction_count INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'rumor' CHECK (state IN ('rumor', 'circulating', 'contested', 'faded')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_world_rumors_updated ON world_rumors (updated_at);
  `,
  `
    CREATE TABLE IF NOT EXISTS economy_audit (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      actor_hash TEXT NOT NULL,
      action TEXT NOT NULL,
      route TEXT NOT NULL,
      amount INTEGER,
      result TEXT NOT NULL,
      transaction_id TEXT,
      request_meta TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_economy_audit_created ON economy_audit (created_at);
    CREATE TRIGGER IF NOT EXISTS economy_audit_no_update
    BEFORE UPDATE ON economy_audit
    BEGIN
      SELECT RAISE(ABORT, 'economy_audit is append-only');
    END;
    CREATE TRIGGER IF NOT EXISTS economy_audit_no_delete
    BEFORE DELETE ON economy_audit
    BEGIN
      SELECT RAISE(ABORT, 'economy_audit is append-only');
    END;
    CREATE TABLE IF NOT EXISTS economy_idempotency (
      actor_id TEXT NOT NULL,
      route TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      response_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (actor_id, route, idempotency_key)
    );
  `
];

export function runSafeMigrations(db) {
  for (const sql of SAFE_MIGRATIONS) {
    try {
      db.exec(sql);
    } catch (_) {}
  }
}
