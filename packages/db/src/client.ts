import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export interface DbOptions {
  /** Upper bound on pooled connections for this process. */
  maxConnections?: number;
}

/**
 * Opens a connection pool. Call `close()` on shutdown so the process can exit.
 * Nothing connects until the first query runs.
 */
export function createDb(connectionString: string, options: DbOptions = {}) {
  const sql = postgres(connectionString, { max: options.maxConnections ?? 10 });
  const db = drizzle(sql, { schema });
  return { db, close: () => sql.end({ timeout: 5 }) };
}

export type Db = ReturnType<typeof createDb>['db'];
