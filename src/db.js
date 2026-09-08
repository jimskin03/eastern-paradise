import { initializeDatabase } from './infrastructure/database/bootstrap.js';
import { createCloudClient } from './infrastructure/database/cloud/client.js';
import { createCloudStorage } from './infrastructure/database/cloud/storage.js';
import { createLocalDatabase, DB_PATH } from './infrastructure/database/connection.js';

export { DB_PATH };
export { TABLE_PK } from './infrastructure/database/sync-config.js';

export const db = createLocalDatabase();

const cloudClient = initializeDatabase({
  db,
  dbPath: DB_PATH,
  configureCloud: createCloudClient
});

export const CloudStorage = createCloudStorage({ db, cloudClient });
