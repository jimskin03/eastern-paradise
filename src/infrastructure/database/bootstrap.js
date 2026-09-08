import { initializeDeltaTracking } from './delta-tracking.js';
import { runSafeMigrations } from './migrations.js';
import { createLocalSchema } from './schema.js';

export function initializeDatabase({ db, dbPath, configureCloud }) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
  `);

  createLocalSchema(db);
  runSafeMigrations(db);

  const clockRow = db.prepare('SELECT id FROM world_clock WHERE id = 1').get();
  if (!clockRow) {
    db.prepare('INSERT INTO world_clock (id, tick_count, epoch_awake_at, last_tick_at) VALUES (1, 0, ?, ?)').run(Date.now(), Date.now());
  }

  console.log('[Database] Eastern Paradise SQLite initialized at:', dbPath);

  // Cloud configuration historically occurs after local bootstrap and before trigger setup.
  const cloudClient = configureCloud();
  initializeDeltaTracking(db);

  return cloudClient;
}
