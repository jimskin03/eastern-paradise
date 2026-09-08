import { createClient } from '@libsql/client';

export function createCloudClient() {
  const tursoUrl = process.env.TURSO_DATABASE_URL || process.env.TURSO_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  if (!tursoUrl) return null;

  try {
    const client = createClient({
      url: tursoUrl,
      authToken: tursoToken
    });
    console.log('[Database:Cloud] Turso LibSQL client configured for:', tursoUrl);
    return client;
  } catch (err) {
    console.error('[Database:Cloud] Failed to initialize Turso client:', err.message);
    return null;
  }
}
