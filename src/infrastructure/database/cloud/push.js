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
    const dirtyRows = db.prepare(`
      SELECT id, table_name, row_pk, op
      FROM _sync_changes
      ORDER BY id ASC
      LIMIT 500
    `).all();

    if (!dirtyRows || dirtyRows.length === 0) {
      return { synced: 0 };
    }

    const maxProcessedId = dirtyRows[dirtyRows.length - 1].id;
    const latestMap = new Map();
    for (const entry of dirtyRows) {
      const key = `${entry.table_name}:${entry.row_pk}`;
      latestMap.set(key, entry);
    }

    const statements = [];

    for (const entry of latestMap.values()) {
      const { table_name, row_pk, op } = entry;
      const pkDef = TABLE_PK[table_name];

      if (op === 'DELETE') {
        statements.push(createDeleteStatement(table_name, row_pk, pkDef));
        continue;
      }

      let row = null;
      if (Array.isArray(pkDef)) {
        const [part1, part2] = row_pk.split(':::');
        row = db.prepare(`SELECT * FROM ${table_name} WHERE ${pkDef[0]} = ? AND ${pkDef[1]} = ?`).get(part1, part2);
      } else {
        row = db.prepare(`SELECT * FROM ${table_name} WHERE ${pkDef} = ?`).get(row_pk);
      }

      if (!row) {
        statements.push(createDeleteStatement(table_name, row_pk, pkDef));
        continue;
      }

      if (!shouldRetainCloudRow(table_name, row)) continue;

      const cols = Object.keys(row);
      const placeholders = cols.map(() => '?').join(', ');
      statements.push({
        sql: `INSERT OR REPLACE INTO ${table_name} (${cols.join(', ')}) VALUES (${placeholders})`,
        args: Object.values(row)
      });
    }

    if (statements.length > 0) {
      const CHUNK_SIZE = 100;
      for (let i = 0; i < statements.length; i += CHUNK_SIZE) {
        const chunk = statements.slice(i, i + CHUNK_SIZE);
        await cloudClient.batch(chunk, 'write');
      }
    }

    db.prepare('DELETE FROM _sync_changes WHERE id <= ?').run(maxProcessedId);

    console.log(`[Database:Cloud] Delta sync pushed ${statements.length} changes to Turso cloud.`);
    return { synced: statements.length };
  } catch (err) {
    console.error('[Database:Cloud] Error during delta sync push to cloud:', err.message);
    throw err;
  }
}
