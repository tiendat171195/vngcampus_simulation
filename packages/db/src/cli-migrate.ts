/** `pnpm db:migrate`: applies pending migrations to DATABASE_URL. */
import { createDb } from './client';
import { migrateDatabase } from './migrate';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set (see .env.example).');
  process.exit(1);
}
const { db, close } = createDb(url, { maxConnections: 1 });
await migrateDatabase(db);
await close();
console.log('database is up to date');
