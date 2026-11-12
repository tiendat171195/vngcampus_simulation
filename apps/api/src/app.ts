import type { HealthResponse } from '@campus/shared';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

/** Builds the HTTP app without binding a port, so tests can drive it with `app.inject()`. */
export function buildApp(options: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(options);

  app.get('/api/health', async (): Promise<HealthResponse> => {
    return { status: 'ok', service: 'api', time: new Date().toISOString() };
  });

  return app;
}
