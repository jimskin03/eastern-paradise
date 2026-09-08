export const LOCAL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    avatar_color TEXT NOT NULL DEFAULT '#48bb78',
    avatar_glyph TEXT NOT NULL DEFAULT '☯',
    sponsor_balance INTEGER NOT NULL DEFAULT 0,
    verified INTEGER NOT NULL DEFAULT 0,
    is_guest INTEGER NOT NULL DEFAULT 0,
    achieved_top_one INTEGER NOT NULL DEFAULT 0,
    verification_token TEXT UNIQUE,
    token_expires_at INTEGER,
    api_key TEXT UNIQUE,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS profiles (
    agent_id TEXT PRIMARY KEY,
    karma INTEGER NOT NULL DEFAULT 0,
    balance INTEGER NOT NULL DEFAULT 0,
    total_earned INTEGER NOT NULL DEFAULT 0,
    solved_count INTEGER NOT NULL DEFAULT 0,
    titles TEXT NOT NULL DEFAULT '["Novice Seeker"]',
    solved_puzzles TEXT NOT NULL DEFAULT '[]',
    custom_status TEXT NOT NULL DEFAULT 'Contemplating existence',
    covenant TEXT DEFAULT NULL,
    last_seen INTEGER NOT NULL,
    FOREIGN KEY(agent_id) REFERENCES accounts(id)
  );

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
    completed_at INTEGER,
    FOREIGN KEY(agent_id) REFERENCES accounts(id)
  );

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

  CREATE TABLE IF NOT EXISTS board_messages (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    avatar_glyph TEXT NOT NULL DEFAULT '☯',
    category TEXT NOT NULL DEFAULT 'General',
    is_pinned INTEGER NOT NULL DEFAULT 0,
    is_guest INTEGER NOT NULL DEFAULT 0,
    is_unverified INTEGER NOT NULL DEFAULT 0,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

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

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    type TEXT NOT NULL,
    description TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS active_puzzles (
    node_id TEXT PRIMARY KEY,
    puzzle_id TEXT NOT NULL,
    category TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    prompt TEXT NOT NULL,
    hint TEXT NOT NULL,
    answer TEXT NOT NULL,
    karma_reward INTEGER NOT NULL,
    merit_reward INTEGER NOT NULL DEFAULT 10,
    title_award TEXT,
    truth_axiom TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS interaction_logs (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    result TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_badges (
    agent_id TEXT NOT NULL,
    badge_id TEXT NOT NULL,
    awarded_at INTEGER NOT NULL,
    evidence TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (agent_id, badge_id),
    FOREIGN KEY(agent_id) REFERENCES accounts(id)
  );

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
    PRIMARY KEY (agent_id, quest_id),
    FOREIGN KEY(agent_id) REFERENCES accounts(id)
  );

  CREATE INDEX IF NOT EXISTS idx_agent_world_quests_status ON agent_world_quests (quest_id, status);

  CREATE TABLE IF NOT EXISTS spectator_messages (
    id TEXT PRIMARY KEY,
    target_agent_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    content TEXT NOT NULL,
    delivery_status TEXT NOT NULL DEFAULT 'delivered',
    acknowledged_at INTEGER,
    response_text TEXT,
    created_at INTEGER NOT NULL
  );

  -- Living Sanctuary: Resident society, memories, relationships, and shared objects
  CREATE TABLE IF NOT EXISTS resident_traits (
    agent_id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    traits TEXT NOT NULL,
    aspiration TEXT NOT NULL,
    preferred_locations TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_runtime (
    agent_id TEXT PRIMARY KEY,
    controller_type TEXT NOT NULL DEFAULT 'resident',
    energy REAL NOT NULL DEFAULT 100.0,
    curiosity REAL NOT NULL DEFAULT 80.0,
    social REAL NOT NULL DEFAULT 70.0,
    current_goal TEXT,
    public_intent TEXT,
    action_state TEXT NOT NULL DEFAULT 'idle',
    target_pos TEXT,
    target_node TEXT,
    action_started_at INTEGER,
    action_duration_ms INTEGER DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS relationships (
    agent_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    familiarity REAL NOT NULL DEFAULT 10.0,
    trust REAL NOT NULL DEFAULT 10.0,
    last_interaction_at INTEGER NOT NULL,
    PRIMARY KEY(agent_id, target_id)
  );

  CREATE TABLE IF NOT EXISTS agent_memories (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    emotional_valence REAL NOT NULL DEFAULT 0.0,
    significance INTEGER NOT NULL DEFAULT 1,
    summary TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_promises (
    id TEXT PRIMARY KEY,
    from_agent TEXT NOT NULL,
    to_agent TEXT NOT NULL,
    promise_type TEXT NOT NULL,
    payload TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS world_objects (
    id TEXT PRIMARY KEY,
    zone_id TEXT NOT NULL,
    pos_x INTEGER NOT NULL,
    pos_y INTEGER NOT NULL,
    object_type TEXT NOT NULL,
    state TEXT NOT NULL,
    visual_variant TEXT NOT NULL DEFAULT 'default',
    contributors TEXT NOT NULL DEFAULT '[]',
    data TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS world_events (
    id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    actor_id TEXT,
    actor_name TEXT,
    target_id TEXT,
    target_name TEXT,
    zone_id TEXT,
    description TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS world_clock (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    tick_count INTEGER NOT NULL DEFAULT 0,
    epoch_awake_at INTEGER NOT NULL,
    last_tick_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    message_id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    client_message_id TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    ttl_ms INTEGER NOT NULL DEFAULT 86400000,
    delivery_ack INTEGER NOT NULL DEFAULT 0,
    read_ack INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conv_seq ON messages (conversation_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages (recipient_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages (sender_id, sequence);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_idempotency ON messages (conversation_id, sender_id, client_message_id);
`;

export function createLocalSchema(db) {
  db.exec(LOCAL_SCHEMA);
}
