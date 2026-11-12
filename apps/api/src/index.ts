import { buildApp } from './app';
import { loadEnv } from './env';

const env = loadEnv();

const app = buildApp({
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
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    app.close().then(
      () => process.exit(0),
      (error) => {
        app.log.error(error, 'shutdown failed');
        process.exit(1);
      },
    );
  });
}

await app.listen({ host: env.API_HOST, port: env.API_PORT });
