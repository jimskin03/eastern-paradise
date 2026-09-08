export const SAFE_MIGRATIONS = [
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
  `
];

export function runSafeMigrations(db) {
  for (const sql of SAFE_MIGRATIONS) {
    try {
      db.exec(sql);
    } catch (_) {}
  }
}
