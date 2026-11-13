import { createDb, type Db, migrateDatabase } from '@campus/db';
import { sql } from 'drizzle-orm';
import { type AppDeps, buildApp } from './app';
import { createKeyRing } from './auth/keys';

/**
 * Integration tests run against a real PostgreSQL (`TEST_DATABASE_URL`, by default the local
 * `campus_test` database; `pnpm infra:up` starts one). The schema is rebuilt from the migrations
 * at the start, so the tests also prove the migrations apply cleanly.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://campus:campus@127.0.0.1:5432/campus_test';

export async function freshDatabase(): Promise<{ db: Db; close: () => Promise<void> }> {
  const handle = createDb(TEST_DATABASE_URL, { maxConnections: 4 });
  try {
    await handle.db.execute(sql`drop schema if exists drizzle cascade`);
    await handle.db.execute(sql`drop schema if exists public cascade`);
    await handle.db.execute(sql`create schema public`);
  } catch (error) {
    await handle.close();
    throw new Error(
      `Cannot reach the test database at ${TEST_DATABASE_URL}. Start PostgreSQL (pnpm infra:up) or set TEST_DATABASE_URL.\n${String(error)}`,
    );
  }
  await migrateDatabase(handle.db);
  return handle;
}

export async function testApp(db: Db, overrides: Partial<AppDeps> = {}) {
  const deps: AppDeps = {
    db,
    keys: await createKeyRing(),
    guestMode: 'full',
    secureCookies: false,
    rateLimitScale: 100,
    ...overrides,
  };
  return { app: await buildApp(deps), deps };
}
