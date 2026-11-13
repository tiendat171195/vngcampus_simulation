import type { Db } from '@campus/db';
import type { HealthResponse } from '@campus/shared';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { AccessClaims, KeyRing } from './auth/keys';
import type { OidcProvider } from './auth/oidc';
import { ApiError, sendError } from './errors';
import { adminRoutes } from './routes/admin';
import { adminMissionRoutes } from './routes/adminMissions';
import { authRoutes } from './routes/auth';
import { directoryRoutes } from './routes/directory';
import { meRoutes } from './routes/me';
import { oidcRoutes } from './routes/oidc';
import { progressRoutes } from './routes/progress';
import { worldRoutes } from './routes/world';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireUser` for authenticated routes. */
    auth?: AccessClaims;
  }
}

export interface AppDeps {
  db: Db;
  keys: KeyRing;
  guestMode: 'off' | 'limited' | 'full';
  /** Send the refresh cookie over HTTPS only (production). */
  secureCookies: boolean;
  /** Multiplies every per-route rate limit; tests raise it to make many accounts. */
  rateLimitScale?: number;
  /** Company sign-in (docs/07 §5.2); without it only guests can sign in. */
  oidc?: {
    providers: OidcProvider[];
    /** Origin people use, where providers send them back. */
    publicUrl: string;
    /** Allowed email domains; empty allows any. */
    emailDomains: string[];
    adminEmails: string[];
  };
}

/** Builds the HTTP app without binding a port, so tests can drive it with `app.inject()`. */
export async function buildApp(
  deps: AppDeps,
  options: FastifyServerOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify(options);
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) return sendError(reply, error);
    if ((error as { statusCode?: number }).statusCode === 429) {
      return sendError(
        reply,
        new ApiError(429, 'rate_limited', 'Thao tác quá nhanh, thử lại sau.'),
      );
    }
    request.log.error(error);
    return sendError(reply, new ApiError(500, 'internal', 'Có lỗi xảy ra.'));
  });
  app.setNotFoundHandler((_request, reply) =>
    sendError(reply, new ApiError(404, 'not_found', 'Không tìm thấy.')),
  );

  app.get('/api/health', async (): Promise<HealthResponse> => {
    return { status: 'ok', service: 'api', time: new Date().toISOString() };
  });

  await app.register(
    async (v1) => {
      await authRoutes(v1, deps);
      await oidcRoutes(v1, deps);
      await meRoutes(v1, deps);
      await directoryRoutes(v1, deps);
      await progressRoutes(v1, deps);
      await adminRoutes(v1, deps);
      await adminMissionRoutes(v1, deps);
      await worldRoutes(v1, deps);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
