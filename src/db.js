import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

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
    created_at INTEGER NOT NULL
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
  db.exec(`ALTER TABLE accounts ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0;`);
} catch (_) {}
try {
  db.exec(`ALTER TABLE board_messages ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0;`);
} catch (_) {}

console.log('[Database] Eastern Paradise SQLite initialized at:', DB_PATH);

