import { audit, autofillTomorrow, readSettings, writeSettings } from '@campus/core';
import { announcements, missions, missionTemplates, users, uuidv7 } from '@campus/db';
import { campusIndex } from '@campus/map-data/campus';
import {
  type AnnouncementDto,
  announcementInputSchema,
  can,
  type LocalizedText,
  missionDefinitionSchema,
  type OperationalSettings,
  settingsPatchSchema,
  sumRewardsPoints,
  type TemplateDetailDto,
  type TemplateDto,
  templateInputSchema,
} from '@campus/shared';
import { asc, desc, eq, gt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { ApiError } from '../errors';
import { definitionOf, parse } from './adminMissions';
import { requireStaff, staffOf } from './staff';

type TemplateRow = typeof missionTemplates.$inferSelect;
type AnnouncementRow = typeof announcements.$inferSelect;

const idParams = z.object({ id: z.uuid() });
const createTemplateBody = templateInputSchema
  .extend({ definition: z.unknown().optional(), missionId: z.uuid().optional() })
  .strict()
  .refine((body) => (body.definition === undefined) !== (body.missionId === undefined), {
    message: 'Cần đúng một trong definition hoặc missionId.',
  });
const updateTemplateBody = templateInputSchema
  .partial()
  .extend({ definition: z.unknown().optional() })
  .strict();

function templateDto(row: TemplateRow): TemplateDto {
  const parsed = missionDefinitionSchema.safeParse(row.definition);
  const raw = row.definition as { title?: LocalizedText; objectives?: unknown[] };
  return {
    id: row.id,
    name: row.name,
    tags: row.tags,
    active: row.active,
    lastUsedOn: row.lastUsedOn,
    title: parsed.success ? parsed.data.title : (raw.title ?? { vi: row.name }),
    objectives: parsed.success ? parsed.data.objectives.length : (raw.objectives?.length ?? 0),
    points: parsed.success ? sumRewardsPoints(parsed.data.rewards) : 0,
    broken: !parsed.success,
    createdAt: row.createdAt.toISOString(),
  };
}

function announcementState(row: AnnouncementRow, now = new Date()): AnnouncementDto['state'] {
  if (row.cancelledAt) return 'cancelled';
  if (now < row.startsAt) return 'scheduled';
  return now < row.endsAt ? 'live' : 'ended';
}

/**
 * Templates, autofill, announcements and settings (docs/08 §4.5 and §5). Changes reach the
 * realtime server through the database within a few seconds.
 */
export async function adminOpsRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const { db, keys } = deps;
  const asEditor = { preHandler: requireStaff(db, keys, 'missions') };
  const asAnnouncer = { preHandler: requireStaff(db, keys, 'announcements') };
  const asAdmin = { preHandler: requireStaff(db, keys, 'config') };

  const loadTemplate = async (id: string) => {
    const [row] = await db.select().from(missionTemplates).where(eq(missionTemplates.id, id));
    if (!row) throw new ApiError(404, 'not_found', 'Không có mẫu này.');
    return row;
  };

  // ---------- templates ----------

  app.get('/admin/templates', asEditor, async (): Promise<TemplateDto[]> => {
    const rows = await db
      .select()
      .from(missionTemplates)
      .orderBy(desc(missionTemplates.active), asc(missionTemplates.name));
    return rows.map(templateDto);
  });

  app.get('/admin/templates/:id', asEditor, async (request): Promise<TemplateDetailDto> => {
    const row = await loadTemplate(parse(idParams, request.params).id);
    return { ...templateDto(row), definition: row.definition };
  });

  app.post('/admin/templates', asEditor, async (request, reply): Promise<TemplateDto> => {
    const body = parse(createTemplateBody, request.body);
    const staff = staffOf(request);
    let definition: unknown = body.definition;
    if (body.missionId) {
      const [mission] = await db
        .select({ definition: missions.definition })
        .from(missions)
        .where(eq(missions.id, body.missionId));
      if (!mission) throw new ApiError(404, 'not_found', 'Không có nhiệm vụ này.');
      definition = mission.definition;
    }
    const checked = definitionOf(definition);
    const [row] = await db
      .insert(missionTemplates)
      .values({
        id: uuidv7(),
        name: body.name,
        tags: body.tags,
        active: body.active,
        definition: checked,
        createdBy: staff.id,
      })
      .returning();
    if (!row) throw new ApiError(500, 'internal', 'Không lưu được.');
    await audit(db, {
      actorId: staff.id,
      action: 'template.create',
      entityType: 'template',
      entityId: row.id,
      diff: body.missionId ? { fromMission: body.missionId } : {},
    });
    reply.status(201);
    return templateDto(row);
  });

  app.patch('/admin/templates/:id', asEditor, async (request): Promise<TemplateDto> => {
    const row = await loadTemplate(parse(idParams, request.params).id);
    const body = parse(updateTemplateBody, request.body);
    const staff = staffOf(request);
    const [updated] = await db
      .update(missionTemplates)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.tags !== undefined ? { tags: body.tags } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.definition !== undefined ? { definition: definitionOf(body.definition) } : {}),
      })
      .where(eq(missionTemplates.id, row.id))
      .returning();
    await audit(db, {
      actorId: staff.id,
      action: 'template.update',
      entityType: 'template',
      entityId: row.id,
      diff: { ...body, definition: body.definition === undefined ? undefined : 'changed' },
    });
    return templateDto(updated ?? row);
  });

  app.delete('/admin/templates/:id', asEditor, async (request) => {
    const row = await loadTemplate(parse(idParams, request.params).id);
    await db.delete(missionTemplates).where(eq(missionTemplates.id, row.id));
    await audit(db, {
      actorId: staffOf(request).id,
      action: 'template.delete',
      entityType: 'template',
      entityId: row.id,
      diff: { name: row.name },
    });
    return { ok: true };
  });

  /** Fills tomorrow now instead of waiting for 23:00 (the same rules as the nightly job). */
  app.post('/admin/missions/autofill', asEditor, async (request) => {
    const missionId = await autofillTomorrow(db, campusIndex, new Date(), { force: true });
    if (missionId)
      await audit(db, {
        actorId: staffOf(request).id,
        action: 'mission.autofill.request',
        entityType: 'mission',
        entityId: missionId,
      });
    return { missionId };
  });

  // ---------- announcements ----------

  const announcementDto = async (rows: AnnouncementRow[]): Promise<AnnouncementDto[]> => {
    const authorIds = [...new Set(rows.flatMap((row) => (row.createdBy ? [row.createdBy] : [])))];
    const names = new Map<string, string>();
    for (const id of authorIds) {
      const [author] = await db
        .select({ name: users.displayName })
        .from(users)
        .where(eq(users.id, id));
      if (author) names.set(id, author.name);
    }
    return rows.map((row) => ({
      id: row.id,
      level: row.level,
      text: row.text as LocalizedText,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      state: announcementState(row),
      createdByName: row.createdBy ? (names.get(row.createdBy) ?? null) : null,
    }));
  };

  app.get('/admin/announcements', asAnnouncer, async (): Promise<AnnouncementDto[]> => {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const rows = await db
      .select()
      .from(announcements)
      .where(gt(announcements.endsAt, weekAgo))
      .orderBy(desc(announcements.startsAt))
      .limit(100);
    return announcementDto(rows);
  });

  app.post('/admin/announcements', asAnnouncer, async (request, reply) => {
    const body = parse(announcementInputSchema, request.body);
    const staff = staffOf(request);
    // Covering the whole game is for maintenance; only admins may do it (docs/08 §5).
    if (body.level === 'fullscreen' && !can(staff.role, 'config'))
      throw new ApiError(403, 'forbidden', 'Chỉ quản trị viên được phát thông báo toàn màn hình.');
    const startsAt = body.startsAt ? new Date(body.startsAt) : new Date();
    if (startsAt.getTime() < Date.now() - 60_000)
      throw new ApiError(400, 'in_the_past', 'Giờ phát đã qua.');
    const [row] = await db
      .insert(announcements)
      .values({
        id: uuidv7(),
        level: body.level,
        text: body.text,
        startsAt,
        endsAt: new Date(startsAt.getTime() + body.minutes * 60_000),
        createdBy: staff.id,
      })
      .returning();
    if (!row) throw new ApiError(500, 'internal', 'Không lưu được.');
    await audit(db, {
      actorId: staff.id,
      action: 'announcement.create',
      entityType: 'announcement',
      entityId: row.id,
      diff: { level: body.level, startsAt: startsAt.toISOString(), minutes: body.minutes },
    });
    reply.status(201);
    return (await announcementDto([row]))[0];
  });

  app.post('/admin/announcements/:id/cancel', asAnnouncer, async (request) => {
    const { id } = parse(idParams, request.params);
    const [row] = await db
      .update(announcements)
      .set({ cancelledAt: new Date() })
      .where(eq(announcements.id, id))
      .returning();
    if (!row) throw new ApiError(404, 'not_found', 'Không có thông báo này.');
    await audit(db, {
      actorId: staffOf(request).id,
      action: 'announcement.cancel',
      entityType: 'announcement',
      entityId: id,
    });
    return (await announcementDto([row]))[0];
  });

  // ---------- settings and kill switches ----------

  app.get('/admin/settings', asAdmin, async (): Promise<OperationalSettings> => readSettings(db));

  app.put('/admin/settings', asAdmin, async (request): Promise<OperationalSettings> => {
    const patch = parse(settingsPatchSchema, request.body);
    return writeSettings(db, patch, staffOf(request).id);
  });
}
