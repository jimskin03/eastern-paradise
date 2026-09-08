import { SYNC_TABLES } from '../sync-config.js';
import { shouldRetainCloudRow } from './filters.js';
import { ensureCloudSchema } from './schema.js';

export async function restoreFromCloud({ db, cloudClient }) {
  if (!cloudClient) return;

  try {
    console.log('[Database:Cloud] Synchronizing tables from Turso cloud...');
    await ensureCloudSchema(cloudClient);

    // Temporarily disable foreign keys during restore so existing records can restore cleanly
    db.exec('PRAGMA foreign_keys = OFF;');
    try {
      for (const table of SYNC_TABLES) {
        try {
          const res = await cloudClient.execute(`SELECT * FROM ${table}`);
          if (res.rows && res.rows.length > 0) {
            let restoredCount = 0;
            for (const row of res.rows) {
              if (!shouldRetainCloudRow(table, row)) continue;

              const cols = Object.keys(row);
              const placeholders = cols.map(() => '?').join(', ');
              const query = `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
              try {
                db.prepare(query).run(...Object.values(row));
                restoredCount++;
              } catch (rowErr) {
                console.warn(`[Database:Cloud] Skip record in ${table}:`, rowErr.message);
              }
            }
            console.log(`[Database:Cloud] Restored ${restoredCount} records for table: ${table}`);
          }
        } catch (tableErr) {
          console.warn(`[Database:Cloud] Warning restoring table ${table}:`, tableErr.message);
        }
      }
    } finally {
      db.exec('PRAGMA foreign_keys = ON;');
      // Purge baseline sync log created during initial restore
      db.exec('DELETE FROM _sync_changes;');
    }
    console.log('[Database:Cloud] Initial cloud restore completed successfully.');
  } catch (err) {
    console.error('[Database:Cloud] Error during cloud restore:', err.message);
  }
}
