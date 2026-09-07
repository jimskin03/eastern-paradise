import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// DATA_DIR override lets a host mount a persistent volume (e.g. Render disk at /var/data)
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const DB_PATH = path.join(DATA_DIR, 'paradise.db');
export const db = new DatabaseSync(DB_PATH);

// Initialize schema
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    avatar_color TEXT NOT NULL DEFAULT '#48bb78',
    avatar_glyph TEXT NOT NULL DEFAULT '☯',
    sponsor_balance INTEGER NOT NULL DEFAULT 0,
    verified INTEGER NOT NULL DEFAULT 0,
    is_guest INTEGER NOT NULL DEFAULT 0,
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
    last_seen INTEGER NOT NULL,
    FOREIGN KEY(agent_id) REFERENCES accounts(id)
  );

  CREATE TABLE IF NOT EXISTS board_messages (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    avatar_glyph TEXT NOT NULL DEFAULT '☯',
    category TEXT NOT NULL DEFAULT 'General',
    is_pinned INTEGER NOT NULL DEFAULT 0,
    is_guest INTEGER NOT NULL DEFAULT 0,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
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
`);

// Safe migrations for existing databases
try {
  db.exec(`ALTER TABLE accounts ADD COLUMN sponsor_balance INTEGER NOT NULL DEFAULT 0;`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE profiles ADD COLUMN balance INTEGER NOT NULL DEFAULT 0;`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE profiles ADD COLUMN total_earned INTEGER NOT NULL DEFAULT 0;`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE board_messages ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE active_puzzles ADD COLUMN merit_reward INTEGER NOT NULL DEFAULT 10;`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE active_puzzles ADD COLUMN alt_answers TEXT;`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE active_puzzles ADD COLUMN truth_axiom TEXT;`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE accounts ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0;`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE board_messages ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0;`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE spectator_messages ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'delivered';`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE spectator_messages ADD COLUMN acknowledged_at INTEGER;`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE spectator_messages ADD COLUMN response_text TEXT;`);
} catch (_) {}

// Initialize singleton world_clock row if not present
const clockRow = db.prepare('SELECT id FROM world_clock WHERE id = 1').get();
if (!clockRow) {
  db.prepare('INSERT INTO world_clock (id, tick_count, epoch_awake_at, last_tick_at) VALUES (1, 0, ?, ?)').run(Date.now(), Date.now());
}

console.log('[Database] Eastern Paradise SQLite initialized at:', DB_PATH);

// --- Cloud Synchronization (Turso / LibSQL) ---
const TURSO_URL = process.env.TURSO_DATABASE_URL || process.env.TURSO_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

let cloudClient = null;
if (TURSO_URL) {
  try {
    cloudClient = createClient({
      url: TURSO_URL,
      authToken: TURSO_TOKEN
    });
    console.log('[Database:Cloud] Turso LibSQL client configured for:', TURSO_URL);
  } catch (err) {
    console.error('[Database:Cloud] Failed to initialize Turso client:', err.message);
  }
}

const SYNC_TABLES = [
  'accounts',
  'profiles',
  'board_messages',
  'transactions',
  'active_puzzles',
  'interaction_logs',
  'spectator_messages',
  'resident_traits',
  'agent_runtime',
  'relationships',
  'agent_memories',
  'agent_promises',
  'world_objects',
  'world_events',
  'world_clock'
];

export const CloudStorage = {
  isEnabled() {
    return cloudClient !== null;
  },

  /**
   * Pulls data from Turso cloud into local SQLite on server startup.
   */
  async restoreFromCloud() {
    if (!cloudClient) return;
    try {
      console.log('[Database:Cloud] Synchronizing tables from Turso cloud...');

      // Ensure cloud tables exist
      const tableSchemas = [
        `CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY,
          name TEXT UNIQUE NOT NULL,
          email TEXT NOT NULL,
          avatar_color TEXT NOT NULL DEFAULT '#48bb78',
          avatar_glyph TEXT NOT NULL DEFAULT '☯',
          sponsor_balance INTEGER NOT NULL DEFAULT 0,
          verified INTEGER NOT NULL DEFAULT 0,
          is_guest INTEGER NOT NULL DEFAULT 0,
          verification_token TEXT UNIQUE,
          token_expires_at INTEGER,
          api_key TEXT UNIQUE,
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS profiles (
          agent_id TEXT PRIMARY KEY,
          karma INTEGER NOT NULL DEFAULT 0,
          balance INTEGER NOT NULL DEFAULT 0,
          total_earned INTEGER NOT NULL DEFAULT 0,
          solved_count INTEGER NOT NULL DEFAULT 0,
          titles TEXT NOT NULL DEFAULT '["Novice Seeker"]',
          solved_puzzles TEXT NOT NULL DEFAULT '[]',
          custom_status TEXT NOT NULL DEFAULT 'Contemplating existence',
          last_seen INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS board_messages (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          agent_name TEXT NOT NULL,
          avatar_glyph TEXT NOT NULL DEFAULT '☯',
          category TEXT NOT NULL DEFAULT 'General',
          is_pinned INTEGER NOT NULL DEFAULT 0,
          is_guest INTEGER NOT NULL DEFAULT 0,
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS transactions (
          id TEXT PRIMARY KEY,
          sender_id TEXT NOT NULL,
          recipient_id TEXT NOT NULL,
          amount INTEGER NOT NULL,
          type TEXT NOT NULL,
          description TEXT,
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS active_puzzles (
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
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS interaction_logs (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          node_id TEXT NOT NULL,
          action_type TEXT NOT NULL,
          result TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS spectator_messages (
          id TEXT PRIMARY KEY,
          target_agent_id TEXT NOT NULL,
          sender_name TEXT NOT NULL,
          content TEXT NOT NULL,
          delivery_status TEXT NOT NULL DEFAULT 'delivered',
          acknowledged_at INTEGER,
          response_text TEXT,
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS resident_traits (
          agent_id TEXT PRIMARY KEY,
          role TEXT NOT NULL,
          traits TEXT NOT NULL,
          aspiration TEXT NOT NULL,
          preferred_locations TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS agent_runtime (
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
        )`,
        `CREATE TABLE IF NOT EXISTS relationships (
          agent_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          familiarity REAL NOT NULL DEFAULT 10.0,
          trust REAL NOT NULL DEFAULT 10.0,
          last_interaction_at INTEGER NOT NULL,
          PRIMARY KEY(agent_id, target_id)
        )`,
        `CREATE TABLE IF NOT EXISTS agent_memories (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          event_id TEXT NOT NULL,
          subject TEXT NOT NULL,
          emotional_valence REAL NOT NULL DEFAULT 0.0,
          significance INTEGER NOT NULL DEFAULT 1,
          summary TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS agent_promises (
          id TEXT PRIMARY KEY,
          from_agent TEXT NOT NULL,
          to_agent TEXT NOT NULL,
          promise_type TEXT NOT NULL,
          payload TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at INTEGER NOT NULL,
          resolved_at INTEGER
        )`,
        `CREATE TABLE IF NOT EXISTS world_objects (
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
        )`,
        `CREATE TABLE IF NOT EXISTS world_events (
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
        )`,
        `CREATE TABLE IF NOT EXISTS world_clock (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          tick_count INTEGER NOT NULL DEFAULT 0,
          epoch_awake_at INTEGER NOT NULL,
          last_tick_at INTEGER NOT NULL
        )`
      ];

      for (const sql of tableSchemas) {
        await cloudClient.execute(sql);
      }

      // Restore each table
      for (const table of SYNC_TABLES) {
        try {
          const res = await cloudClient.execute(`SELECT * FROM ${table}`);
          if (res.rows && res.rows.length > 0) {
            let restoredCount = 0;
            for (const row of res.rows) {
              if (row.is_guest === 1) continue;

              const cols = Object.keys(row);
              const placeholders = cols.map(() => '?').join(', ');
              const query = `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
              db.prepare(query).run(...Object.values(row));
              restoredCount++;
            }
            console.log(`[Database:Cloud] Restored ${restoredCount} records for table: ${table}`);
          }
        } catch (tableErr) {
          console.warn(`[Database:Cloud] Warning restoring table ${table}:`, tableErr.message);
        }
      }
      console.log('[Database:Cloud] Initial cloud restore completed successfully.');
    } catch (err) {
      console.error('[Database:Cloud] Error during cloud restore:', err.message);
    }
  },

  /**
   * Pushes local SQLite data up to Turso cloud.
   */
  async pushToCloud() {
    if (!cloudClient) return;
    try {
      for (const table of SYNC_TABLES) {
        try {
          let rows = db.prepare(`SELECT * FROM ${table}`).all();
          if (table === 'accounts' || table === 'board_messages') {
            rows = rows.filter(r => !r.is_guest);
          }

          if (rows.length === 0) continue;

          const batch = rows.map(row => {
            const cols = Object.keys(row);
            const placeholders = cols.map(() => '?').join(', ');
            return {
              sql: `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
              args: Object.values(row)
            };
          });

          const CHUNK_SIZE = 100;
          for (let i = 0; i < batch.length; i += CHUNK_SIZE) {
            const chunk = batch.slice(i, i + CHUNK_SIZE);
            await cloudClient.batch(chunk, 'write');
          }
        } catch (tableErr) {
          console.warn(`[Database:Cloud] Warning pushing table ${table}:`, tableErr.message);
        }
      }
      console.log('[Database:Cloud] Sync push to Turso cloud complete.');
    } catch (err) {
      console.error('[Database:Cloud] Error during sync push to cloud:', err.message);
    }
  },

  /**
   * Wipes non-A.Ilicia logs, memories, and messages across local SQLite and Turso cloud.
   */
  async wipeNonAiliciaLogs() {
    const queries = [
      "DELETE FROM interaction_logs WHERE agent_id != 'resident_ailicia'",
      "DELETE FROM world_events WHERE (actor_id IS NULL OR actor_id != 'resident_ailicia') AND (target_id IS NULL OR target_id != 'resident_ailicia')",
      "DELETE FROM spectator_messages WHERE target_agent_id != 'resident_ailicia'",
      "DELETE FROM board_messages WHERE agent_id != 'resident_ailicia'",
      "DELETE FROM agent_memories WHERE agent_id != 'resident_ailicia'",
      "DELETE FROM transactions WHERE (sender_id IS NULL OR sender_id != 'resident_ailicia') AND (recipient_id IS NULL OR recipient_id != 'resident_ailicia')",
      "DELETE FROM agent_promises WHERE from_agent != 'resident_ailicia' AND to_agent != 'resident_ailicia'",
      "DELETE FROM relationships WHERE agent_id != 'resident_ailicia' AND target_id != 'resident_ailicia'"
    ];

    const localChanges = {};
    for (const q of queries) {
      const info = db.prepare(q).run();
      localChanges[q] = info.changes;
    }

    const cloudChanges = {};
    if (cloudClient) {
      for (const q of queries) {
        try {
          const res = await cloudClient.execute(q);
          cloudChanges[q] = res.affectedRowCount ?? res.rowsAffected ?? 0;
        } catch (err) {
          cloudChanges[q] = `Error: ${err.message}`;
        }
      }
    }

    const tables = [
      'board_messages', 'transactions', 'interaction_logs', 'spectator_messages',
      'relationships', 'agent_memories', 'agent_promises', 'world_events'
    ];
    const remaining = {};
    for (const t of tables) {
      const row = db.prepare(`SELECT count(*) as cnt FROM ${t}`).get();
      remaining[t] = row.cnt;
    }

    return { localChanges, cloudChanges, remaining };
  }
};


