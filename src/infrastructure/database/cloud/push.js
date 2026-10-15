import { withImmediateTransaction } from '../transactions.js';
import { TABLE_PK } from '../sync-config.js';
import { shouldRetainCloudRow } from './filters.js';

function createDeleteStatement(tableName, rowPk, pkDef) {
  if (Array.isArray(pkDef)) {
    const [part1, part2] = rowPk.split(':::');
    return {
      sql: `DELETE FROM ${tableName} WHERE ${pkDef[0]} = ? AND ${pkDef[1]} = ?`,
      args: [part1, part2]
    };
  }

  return {
    sql: `DELETE FROM ${tableName} WHERE ${pkDef} = ?`,
    args: [rowPk]
  };
}

export async function pushToCloud({ db, cloudClient }) {
  if (!cloudClient) return { synced: 0 };

  try {
    // Snapshot the queue boundary so writes arriving during network I/O remain
    // pending. Coalesce across the entire backlog, not just 500 trigger entries:
    // a busy resident can otherwise upload the same row in many successive flushes.
    const boundary = db.prepare('SELECT MAX(id) AS id FROM _sync_changes').get().id;
    if (boundary == null) return { synced: 0 };
    const pending = db.prepare(`
      SELECT table_name, row_pk, MAX(id) AS id
      FROM _sync_changes WHERE id <= ?
      GROUP BY table_name, row_pk
      ORDER BY MIN(id)
      LIMIT 100
    `);
    const acknowledge = db.prepare(`
      DELETE FROM _sync_changes WHERE table_name = ? AND row_pk = ? AND id <= ?
    `);
    let synced = 0;

    for (;;) {
      const entries = pending.all(boundary);
      if (entries.length === 0) break;
      const statements = [];
      for (const { table_name, row_pk } of entries) {
        const pkDef = TABLE_PK[table_name];
        let row;
        if (Array.isArray(pkDef)) {
          const [part1, part2] = row_pk.split(':::');
          row = db.prepare(`SELECT * FROM ${table_name} WHERE ${pkDef[0]} = ? AND ${pkDef[1]} = ?`).get(part1, part2);
        } else {
          row = db.prepare(`SELECT * FROM ${table_name} WHERE ${pkDef} = ?`).get(row_pk);
        }

        // Use current state, including a row reinserted after an older DELETE.
        if (!row) {
          statements.push(createDeleteStatement(table_name, row_pk, pkDef));
        } else if (shouldRetainCloudRow(table_name, row)) {
          const cols = Object.keys(row);
          const placeholders = cols.map(() => '?').join(', ');
          statements.push({
            sql: `INSERT OR REPLACE INTO ${table_name} (${cols.join(', ')}) VALUES (${placeholders})`,
            args: Object.values(row)
          });
        }
      }

      if (statements.length > 0) await cloudClient.batch(statements, 'write');
      // Ack each successful batch, so a later failure does not resend earlier
      // batches. Never acknowledge changes made while this batch was in flight.
      withImmediateTransaction(db, () => {
        for (const entry of entries) acknowledge.run(entry.table_name, entry.row_pk, entry.id);
      });
      synced += statements.length;
    }

    console.log(`[Database:Cloud] Delta sync pushed ${synced} changes to Turso cloud.`);
    return { synced };
  } catch (err) {
    console.error('[Database:Cloud] Error during delta sync push to cloud:', err.message);
    throw err;
  }
}
