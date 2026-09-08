import { SYNC_TABLES, TABLE_PK } from './sync-config.js';

export function initializeDeltaTracking(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _sync_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      row_pk TEXT NOT NULL,
      op TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sync_changes_tbl_id ON _sync_changes (table_name, id);
  `);

  for (const table of SYNC_TABLES) {
    const pkDef = TABLE_PK[table];
    if (!pkDef) continue;

    if (Array.isArray(pkDef)) {
      const newPk = `NEW.${pkDef[0]} || ':::' || NEW.${pkDef[1]}`;
      const oldPk = `OLD.${pkDef[0]} || ':::' || OLD.${pkDef[1]}`;
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_${table}_sync_ins AFTER INSERT ON ${table}
        BEGIN
          INSERT INTO _sync_changes (table_name, row_pk, op, created_at)
          VALUES ('${table}', ${newPk}, 'UPSERT', CAST(strftime('%s', 'now') AS INTEGER) * 1000);
        END;

        CREATE TRIGGER IF NOT EXISTS trg_${table}_sync_upd AFTER UPDATE ON ${table}
        BEGIN
          INSERT INTO _sync_changes (table_name, row_pk, op, created_at)
          VALUES ('${table}', ${newPk}, 'UPSERT', CAST(strftime('%s', 'now') AS INTEGER) * 1000);
        END;

        CREATE TRIGGER IF NOT EXISTS trg_${table}_sync_del AFTER DELETE ON ${table}
        BEGIN
          INSERT INTO _sync_changes (table_name, row_pk, op, created_at)
          VALUES ('${table}', ${oldPk}, 'DELETE', CAST(strftime('%s', 'now') AS INTEGER) * 1000);
        END;
      `);
    } else {
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_${table}_sync_ins AFTER INSERT ON ${table}
        BEGIN
          INSERT INTO _sync_changes (table_name, row_pk, op, created_at)
          VALUES ('${table}', CAST(NEW.${pkDef} AS TEXT), 'UPSERT', CAST(strftime('%s', 'now') AS INTEGER) * 1000);
        END;

        CREATE TRIGGER IF NOT EXISTS trg_${table}_sync_upd AFTER UPDATE ON ${table}
        BEGIN
          INSERT INTO _sync_changes (table_name, row_pk, op, created_at)
          VALUES ('${table}', CAST(NEW.${pkDef} AS TEXT), 'UPSERT', CAST(strftime('%s', 'now') AS INTEGER) * 1000);
        END;

        CREATE TRIGGER IF NOT EXISTS trg_${table}_sync_del AFTER DELETE ON ${table}
        BEGIN
          INSERT INTO _sync_changes (table_name, row_pk, op, created_at)
          VALUES ('${table}', CAST(OLD.${pkDef} AS TEXT), 'DELETE', CAST(strftime('%s', 'now') AS INTEGER) * 1000);
        END;
      `);
    }
  }
}
