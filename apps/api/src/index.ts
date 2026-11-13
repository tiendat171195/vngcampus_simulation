import { createDb, migrateDatabase } from '@campus/db';
import { buildApp } from './app';
import { createKeyRing } from './auth/keys';
import { loadEnv } from './env';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);

// Production applies migrations as a separate deploy step (docs/09 §4); development keeps the
// local database current on its own.
if (env.NODE_ENV !== 'production') await migrateDatabase(db);

const app = await buildApp(
  {
    db,
    keys: await createKeyRing(env.JWT_PRIVATE_KEY),
    guestMode: env.GUEST_MODE,
    secureCookies: env.NODE_ENV === 'production',
  },
  {
    trustProxy: true,
    logger:
      env.NODE_ENV === 'development'
        ? {
            level: env.LOG_LEVEL,
            transport: {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            },
          }
        : { level: env.LOG_LEVEL },
  },
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    Promise.all([app.close(), close()]).then(
      () => process.exit(0),
      (error) => {
        app.log.error(error, 'shutdown failed');
        process.exit(1);
      },
    );
  });
}

await app.listen({ host: env.API_HOST, port: env.API_PORT });
