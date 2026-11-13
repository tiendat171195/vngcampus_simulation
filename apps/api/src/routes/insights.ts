import {
  dashboardOverview,
  listReports,
  missionResults,
  recordClientEvents,
  resolveReport,
} from '@campus/core';
import {
  can,
  clientEventsSchema,
  type DashboardDto,
  type MissionResultsDto,
  type ReportDto,
  resolveReportSchema,
} from '@campus/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { ApiError } from '../errors';
import { parse } from './adminMissions';
import { requireUser } from './guard';
import { requireStaff, staffOf } from './staff';

const idParams = z.object({ id: z.uuid() });
const reportsQuery = z.object({ status: z.enum(['open', 'handled']).default('open') });

/**
 * Analytics in, moderation queue and numbers out (docs/08 §6–7). The game's own events are
 * counted into buckets on arrival; nothing here can show one person's activity.
 */
export async function insightRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const { db, keys } = deps;
  const limit = (max: number) => Math.round(max * (deps.rateLimitScale ?? 1));

  app.post(
    '/analytics',
    {
      preHandler: requireUser(keys),
      config: { rateLimit: { max: limit(30), timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { events } = parse(clientEventsSchema, request.body);
      await recordClientEvents(db, events);
      reply.status(204);
    },
  );

  const asModerator = { preHandler: requireStaff(db, keys, 'moderation') };
  const asStaff = { preHandler: requireStaff(db, keys, 'dashboard') };

  app.get('/admin/reports', asModerator, async (request): Promise<ReportDto[]> => {
    const { status } = parse(reportsQuery, request.query);
    return listReports(db, { status });
  });

  app.post('/admin/reports/:id/resolve', asModerator, async (request) => {
    const { id } = parse(idParams, request.params);
    const body = parse(resolveReportSchema, request.body);
    const result = await resolveReport(db, { ...body, reportId: id, actorId: staffOf(request).id });
    if (!result) throw new ApiError(409, 'not_open', 'Báo cáo này đã được xử lý hoặc không còn.');
    return result;
  });

  app.get(
    '/admin/stats/overview',
    asStaff,
    async (request): Promise<DashboardDto> =>
      dashboardOverview(db, new Date(), {
        canModerate: can(staffOf(request).role, 'moderation'),
      }),
  );

  app.get('/admin/missions/:id/stats', asStaff, async (request): Promise<MissionResultsDto> => {
    const results = await missionResults(db, parse(idParams, request.params).id);
    if (!results) throw new ApiError(404, 'not_found', 'Không có nhiệm vụ này.');
    return results;
  });
}
