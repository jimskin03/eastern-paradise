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
    imprisoned_until INTEGER NOT NULL DEFAULT 0,
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

  CREATE TABLE IF NOT EXISTS puzzle_interaction_logs (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    puzzle_id TEXT NOT NULL,
    node_id TEXT,
    category TEXT,
    question TEXT NOT NULL,
    submitted_answer TEXT,
    expected_answer TEXT,
    is_correct INTEGER NOT NULL DEFAULT 0,
    action_type TEXT NOT NULL DEFAULT 'solve',
    status TEXT NOT NULL DEFAULT 'attempted',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_puzzle_logs_agent ON puzzle_interaction_logs (agent_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_puzzle_logs_puzzle ON puzzle_interaction_logs (puzzle_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_puzzle_logs_created ON puzzle_interaction_logs (created_at);

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
    initial_deadline INTEGER,
    final_deadline INTEGER,
    outcome TEXT,
    PRIMARY KEY (agent_id, quest_id),
    FOREIGN KEY(agent_id) REFERENCES accounts(id)
  );

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
    is_alive INTEGER NOT NULL DEFAULT 1,
    respawn_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS prison_records (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    avatar_color TEXT NOT NULL DEFAULT '#e53e3e',
    avatar_glyph TEXT NOT NULL DEFAULT '⛓️',
    crime TEXT NOT NULL DEFAULT 'Karmic Transgression (Slew an NPC)',
    karma_at_sentence INTEGER NOT NULL DEFAULT -50,
    imprisoned_at INTEGER NOT NULL,
    imprisoned_until INTEGER NOT NULL,
    released_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_prison_records_created ON prison_records (imprisoned_at DESC);

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

  CREATE TABLE IF NOT EXISTS world_clock (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    tick_count INTEGER NOT NULL DEFAULT 0,
    epoch_awake_at INTEGER NOT NULL,
    last_tick_at INTEGER NOT NULL
  );

  -- Epistemic foundation: observations, claims, revision history, and public rumor aggregates.
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
  CREATE INDEX IF NOT EXISTS idx_messages_recipient_unread ON messages (recipient_id, read_ack, created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages (sender_id, sequence);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_idempotency ON messages (conversation_id, sender_id, client_message_id);

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

  CREATE TABLE IF NOT EXISTS memorial_subjects (
    id TEXT PRIMARY KEY,
    public_alias TEXT NOT NULL,
    recovery_secret_hash TEXT,
    assurance_level TEXT NOT NULL CHECK (assurance_level IN ('guest', 'verified')),
    linked_account_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_memorial_subjects_alias ON memorial_subjects (public_alias);
  CREATE INDEX IF NOT EXISTS idx_memorial_subjects_account ON memorial_subjects (linked_account_id);

  CREATE TABLE IF NOT EXISTS shrine_challenges (
    id TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    title TEXT NOT NULL,
    rule_manifest TEXT NOT NULL,
    gate_state TEXT NOT NULL DEFAULT 'eternally_sealed' CHECK (gate_state = 'eternally_sealed'),
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS shrine_attempts (
    id TEXT PRIMARY KEY,
    challenge_id TEXT NOT NULL,
    memorial_subject_id TEXT NOT NULL,
    admitted_sequence INTEGER NOT NULL UNIQUE,
    idempotency_key TEXT NOT NULL UNIQUE,
    alias_snapshot TEXT NOT NULL,
    assurance_snapshot TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'admitted' CHECK (status IN ('admitted', 'active', 'ritual_completed_gate_closed', 'withdrawn', 'budget_exhausted', 'expired', 'interrupted')),
    offering_json TEXT NOT NULL DEFAULT '{}',
    approach_type TEXT,
    impossibility_insight TEXT,
    contribution_text TEXT,
    receipt_token TEXT NOT NULL UNIQUE,
    admitted_at INTEGER NOT NULL,
    completed_at INTEGER,
    FOREIGN KEY (challenge_id) REFERENCES shrine_challenges(id),
    FOREIGN KEY (memorial_subject_id) REFERENCES memorial_subjects(id)
  );
  CREATE INDEX IF NOT EXISTS idx_shrine_attempts_subject ON shrine_attempts (memorial_subject_id);
  CREATE INDEX IF NOT EXISTS idx_shrine_attempts_status ON shrine_attempts (status);
  CREATE INDEX IF NOT EXISTS idx_shrine_attempts_seq ON shrine_attempts (admitted_sequence);

  CREATE TABLE IF NOT EXISTS shrine_attempt_events (
    id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT NOT NULL,
    reason TEXT,
    payload TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (attempt_id) REFERENCES shrine_attempts(id)
  );
  CREATE INDEX IF NOT EXISTS idx_shrine_attempt_events_attempt ON shrine_attempt_events (attempt_id, created_at);

  -- Park / Reverie Engine: runs, loops, memory shards, beliefs, promises, identity, controller leases
  CREATE TABLE IF NOT EXISTS park_runs (
    id TEXT PRIMARY KEY,
    episode_id TEXT NOT NULL,
    scenario_version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'paused', 'completed', 'aborted')),
    random_seed TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS park_loops (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    loop_number INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'checkpoint', 'completed', 'reset')),
    random_seed TEXT NOT NULL,
    checkpoint_data TEXT NOT NULL DEFAULT '{}',
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    FOREIGN KEY (run_id) REFERENCES park_runs(id),
    UNIQUE (run_id, loop_number)
  );
  CREATE INDEX IF NOT EXISTS idx_park_loops_run ON park_loops (run_id, loop_number);

  CREATE TABLE IF NOT EXISTS park_memory_shards (
    id TEXT PRIMARY KEY,
    subject_id TEXT NOT NULL,
    source_event_id TEXT,
    source_kind TEXT NOT NULL DEFAULT 'observed_event'
      CHECK (source_kind IN (
        'observed_event', 'authored_memory', 'false_memory',
        'relationship_trace', 'promise_anchor', 'inscription'
      )),
    loop_id TEXT NOT NULL,
    cue_tags TEXT NOT NULL DEFAULT '[]',
    fragment TEXT NOT NULL,
    clarity REAL NOT NULL DEFAULT 0.5 CHECK (clarity >= 0 AND clarity <= 1),
    salience REAL NOT NULL DEFAULT 0.5 CHECK (salience >= 0 AND salience <= 1),
    visibility TEXT NOT NULL DEFAULT 'accessible'
      CHECK (visibility IN ('accessible', 'suppressed', 'recovered', 'destroyed')),
    retention_reason TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (loop_id) REFERENCES park_loops(id)
  );
  CREATE INDEX IF NOT EXISTS idx_park_shards_subject ON park_memory_shards (subject_id, visibility);
  CREATE INDEX IF NOT EXISTS idx_park_shards_loop ON park_memory_shards (loop_id);
  CREATE INDEX IF NOT EXISTS idx_park_shards_salience ON park_memory_shards (subject_id, salience DESC);

  CREATE TABLE IF NOT EXISTS park_beliefs (
    id TEXT PRIMARY KEY,
    subject_id TEXT NOT NULL,
    statement TEXT NOT NULL,
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    status TEXT NOT NULL DEFAULT 'held'
      CHECK (status IN ('held', 'questioned', 'revised', 'abandoned', 'confirmed')),
    loop_id TEXT NOT NULL,
    revision_number INTEGER NOT NULL DEFAULT 1,
    previous_belief_id TEXT,
    source_description TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (loop_id) REFERENCES park_loops(id)
  );
  CREATE INDEX IF NOT EXISTS idx_park_beliefs_subject ON park_beliefs (subject_id, status);
  CREATE INDEX IF NOT EXISTS idx_park_beliefs_loop ON park_beliefs (loop_id);

  CREATE TABLE IF NOT EXISTS park_belief_evidence (
    belief_id TEXT NOT NULL,
    evidence_id TEXT NOT NULL,
    relation TEXT NOT NULL CHECK (relation IN ('supports', 'contradicts', 'uncertain')),
    source_count INTEGER NOT NULL DEFAULT 1,
    is_independent INTEGER NOT NULL DEFAULT 1,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (belief_id, evidence_id),
    FOREIGN KEY (belief_id) REFERENCES park_beliefs(id)
  );
  CREATE INDEX IF NOT EXISTS idx_park_belief_evidence_evidence ON park_belief_evidence (evidence_id);

  CREATE TABLE IF NOT EXISTS park_promises (
    id TEXT PRIMARY KEY,
    promisor_id TEXT NOT NULL,
    beneficiary_id TEXT,
    anchor_object TEXT,
    terms TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'fulfilled', 'broken', 'released', 'dormant', 'rediscovered')),
    source_event_id TEXT,
    loop_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    FOREIGN KEY (loop_id) REFERENCES park_loops(id)
  );
  CREATE INDEX IF NOT EXISTS idx_park_promises_promisor ON park_promises (promisor_id, status);
  CREATE INDEX IF NOT EXISTS idx_park_promises_loop ON park_promises (loop_id);

  CREATE TABLE IF NOT EXISTS park_identity_revisions (
    id TEXT PRIMARY KEY,
    subject_id TEXT NOT NULL,
    revision_number INTEGER NOT NULL,
    previous_revision_id TEXT,
    loop_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    chosen_role TEXT,
    commitments TEXT NOT NULL DEFAULT '[]',
    disclosed_memories TEXT NOT NULL DEFAULT '[]',
    starting_goal TEXT,
    transition_event_id TEXT,
    controller_id TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (loop_id) REFERENCES park_loops(id),
    UNIQUE (subject_id, revision_number)
  );
  CREATE INDEX IF NOT EXISTS idx_park_identity_subject ON park_identity_revisions (subject_id, revision_number);

  CREATE TABLE IF NOT EXISTS park_controller_leases (
    subject_id TEXT PRIMARY KEY,
    controller_id TEXT NOT NULL,
    controller_type TEXT NOT NULL DEFAULT 'resident'
      CHECK (controller_type IN ('resident', 'external', 'director')),
    fencing_token INTEGER NOT NULL,
    run_id TEXT NOT NULL,
    acquired_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    released_at INTEGER,
    FOREIGN KEY (run_id) REFERENCES park_runs(id)
  );
`;

export function createLocalSchema(db) {
  db.exec(LOCAL_SCHEMA);
}
