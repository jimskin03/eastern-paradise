import { db } from '../src/db.js';
import { createCloudClient } from '../src/infrastructure/database/cloud/client.js';
import { ensureCloudSchema } from '../src/infrastructure/database/cloud/schema.js';
import { pushToCloud } from '../src/infrastructure/database/cloud/push.js';

async function main() {
  console.log('--- Eastern Paradise Turso Sync Utility ---');

  const tursoUrl = process.env.TURSO_DATABASE_URL || process.env.TURSO_URL;
  if (!tursoUrl) {
    console.error('Error: Neither TURSO_DATABASE_URL nor TURSO_URL is set in environment.');
    console.log('Usage:');
    console.log('  TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run turso:sync');
    process.exit(1);
  }

  const client = createCloudClient();
  if (!client) {
    console.error('Error: Failed to create Turso LibSQL client.');
    process.exit(1);
  }

  console.log('1. Ensuring cloud schemas (including puzzle_interaction_logs)...');
  try {
    await ensureCloudSchema(client);
    console.log('   Cloud schemas verified and applied successfully.');
  } catch (err) {
    console.error('   Failed to apply cloud schemas:', err.message);
    process.exit(1);
  }

  console.log('2. Pushing pending delta changes from local SQLite to Turso...');
  try {
    const result = await pushToCloud({ db, cloudClient: client });
    console.log(`   Delta push completed. Synced records: ${result?.synced ?? 0}`);
  } catch (err) {
    console.error('   Delta push failed:', err.message);
    process.exit(1);
  }

  console.log('3. Verifying remote puzzle_interaction_logs table on Turso...');
  try {
    const check = await client.execute("SELECT COUNT(*) as count FROM puzzle_interaction_logs");
    console.log(`   puzzle_interaction_logs table exists on Turso (current rows: ${check.rows[0]?.count ?? 0}).`);
  } catch (err) {
    console.log('   Notice:', err.message);
  }

  console.log('✅ Turso synchronization completed successfully.');
  process.exit(0);
}

main().catch(err => {
  console.error('Unhandled error during Turso sync:', err);
  process.exit(1);
});
