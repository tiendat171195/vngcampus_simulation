import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDb, migrateDatabase } from '@campus/db';
import { buildApp } from './app';
import { createKeyRing } from './auth/keys';
import { createOidcProvider, type OidcProvider } from './auth/oidc';
import { loadEnv } from './env';
import { startJobs } from './jobs';

const env = loadEnv();
const { db, close } = createDb(env.DATABASE_URL);

// Production applies migrations as a separate deploy step (docs/09 §4); development keeps the
// local database current on its own. The bundle carries the migrations in dist/drizzle.
if (env.NODE_ENV !== 'production') {
  const bundled = fileURLToPath(new URL('./drizzle', import.meta.url));
  await migrateDatabase(db, existsSync(bundled) ? bundled : undefined);
}

const providers: OidcProvider[] = [];
if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
  providers.push(
    createOidcProvider({
      id: 'google',
      label: 'Google',
      issuer: 'https://accounts.google.com',
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    }),
  );
if (env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET)
  providers.push(
    createOidcProvider({
      id: 'oidc',
      label: env.OIDC_LABEL,
      issuer: env.OIDC_ISSUER,
      clientId: env.OIDC_CLIENT_ID,
      clientSecret: env.OIDC_CLIENT_SECRET,
    }),
  );

const app = await buildApp(
  {
    db,
    keys: await createKeyRing(env.JWT_PRIVATE_KEY),
    guestMode: env.GUEST_MODE,
    rateLimitScale: env.RATE_LIMIT_SCALE,
    oidc: {
      providers,
      publicUrl: env.PUBLIC_URL,
      emailDomains: env.AUTH_EMAIL_DOMAINS,
      adminEmails: env.ADMIN_EMAILS,
    },
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

const stopJobs = startJobs(db, (message) => app.log.info(message));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    stopJobs();
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
