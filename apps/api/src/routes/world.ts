import { campusMap } from '@campus/map-data/campus';
import { type BootstrapResponse, PRIVACY_NOTICE_VERSION } from '@campus/shared';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';

export async function worldRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  /** What a client needs before joining (docs/07 §4); public, cacheable briefly. */
  app.get('/world/bootstrap', async (_request, reply): Promise<BootstrapResponse> => {
    reply.header('cache-control', 'public, max-age=30');
    return {
      mapVersion: campusMap.version,
      guestMode: deps.guestMode,
      realtimePath: '/rt',
      providers: (deps.oidc?.providers ?? []).map(({ id, label }) => ({ id, label })),
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
    };
  });
}
