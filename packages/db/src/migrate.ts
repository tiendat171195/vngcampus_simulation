import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Db } from './client';

/** Folder of SQL migrations written by drizzle-kit, shipped with this package. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

/** Brings the database schema up to date. Safe to run repeatedly. */
export async function migrateDatabase(db: Db, folder = MIGRATIONS_FOLDER): Promise<void> {
  await migrate(db, { migrationsFolder: folder });
}
