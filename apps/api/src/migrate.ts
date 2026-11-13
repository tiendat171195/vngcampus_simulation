import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDb, migrateDatabase } from '@campus/db';
import { loadEnv } from './env';

/**
 * Applies pending migrations and exits: the deploy step before a new API starts in production
 * (docs/09 §4). Migrations only ever add, so the running version keeps working meanwhile.
 */
const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL, { maxConnections: 1 });
const bundled = fileURLToPath(new URL('./drizzle', import.meta.url));
try {
  await migrateDatabase(db, existsSync(bundled) ? bundled : undefined);
  console.log('migrations applied');
} finally {
  await close();
}
