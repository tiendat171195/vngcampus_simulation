import { activeSanctions, applySanction, audit, liftSanction } from '@campus/core';
import { auditLogs, sanctions, userStats, users } from '@campus/db';
import {
  type AdminMeDto,
  type AdminUserDetailDto,
  type AdminUserDto,
  type AuditEntryDto,
  permissionsOf,
  type Role,
  type SanctionDto,
} from '@campus/shared';
import { desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { ApiError } from '../errors';
import { requireStaff, staffOf } from './staff';
import type { UserRow } from './users';

const listQuery = z.object({
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const idParams = z.object({ id: z.uuid() });
const roleBody = z.object({ role: z.enum(['player', 'editor', 'moderator', 'admin']) }).strict();
const sanctionBody = z
  .object({
    type: z.enum(['mute', 'ban']),
    reason: z.string().trim().min(3).max(300),
    /** Length in hours; null for until lifted. */
    hours: z
      .number()
      .int()
      .min(1)
      .max(24 * 365)
      .nullable(),
  })
  .strict();
const auditQuery = z.object({ all: z.enum(['0', '1']).default('0') });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success)
    throw new ApiError(
      400,
      'invalid_request',
      'Dữ liệu gửi lên không hợp lệ.',
      z.flattenError(parsed.error),
    );
  return parsed.data;
}

const toSanction = (row: typeof sanctions.$inferSelect): SanctionDto => ({
  id: row.id,
  type: row.type,
  reason: row.reason,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt?.toISOString() ?? null,
  revokedAt: row.revokedAt?.toISOString() ?? null,
  createdBy: row.createdBy,
});

const toAdminUser = (user: UserRow, active: SanctionDto[]): AdminUserDto => ({
  id: user.id,
  displayName: user.displayName,
  email: user.email,
  isGuest: user.isGuest,
  role: user.role as Role,
  status: user.status,
  createdAt: user.createdAt.toISOString(),
  lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
  active,
});

/** Users, roles, sanctions and the audit log (docs/08 §2–3, §6). */
export async function adminRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const { db, keys } = deps;
  const as = (permission: Parameters<typeof requireStaff>[2]) => ({
    preHandler: requireStaff(db, keys, permission),
  });

  app.get('/admin/me', as('dashboard'), async (request): Promise<AdminMeDto> => {
    const staff = staffOf(request);
    return {
      id: staff.id,
      displayName: staff.displayName,
      email: staff.email,
      role: staff.role as Role,
      permissions: permissionsOf(staff.role),
    };
  });

  app.get('/admin/users', as('moderation'), async (request): Promise<AdminUserDto[]> => {
    const { q, limit, offset } = parse(listQuery, request.query);
    const where: SQL | undefined = q
      ? or(ilike(users.displayName, `%${q}%`), ilike(users.email, `%${q}%`))
      : undefined;
    const rows = await db
      .select()
      .from(users)
      .where(where)
      .orderBy(desc(users.lastSeenAt), desc(users.createdAt))
      .limit(limit)
      .offset(offset);
    const active = rows.length
      ? await activeSanctions(
          db,
          new Date(),
          rows.map((row) => row.id),
        )
      : [];
    return rows.map((row) =>
      toAdminUser(row, active.filter((s) => s.userId === row.id).map(toSanction)),
    );
  });

  app.get('/admin/users/:id', as('moderation'), async (request): Promise<AdminUserDetailDto> => {
    const { id } = parse(idParams, request.params);
    const [user] = await db.select().from(users).where(eq(users.id, id));
    if (!user) throw new ApiError(404, 'not_found', 'Không tìm thấy người này.');
    const history = await db
      .select()
      .from(sanctions)
      .where(eq(sanctions.userId, id))
      .orderBy(desc(sanctions.startsAt));
    const active = await activeSanctions(db, new Date(), [id]);
    const [stats] = await db.select().from(userStats).where(eq(userStats.userId, id));
    return {
      ...toAdminUser(user, active.map(toSanction)),
      sanctions: history.map(toSanction),
      stats: {
        points: stats?.points ?? 0,
        xp: stats?.xp ?? 0,
        level: stats?.level ?? 1,
        missionsCompleted: stats?.missionsCompleted ?? 0,
        streakCurrent: stats?.streakCurrent ?? 0,
      },
    };
  });

  app.patch('/admin/users/:id', as('roles'), async (request): Promise<AdminUserDto> => {
    const { id } = parse(idParams, request.params);
    const { role } = parse(roleBody, request.body);
    const staff = staffOf(request);
    if (id === staff.id) throw new ApiError(400, 'own_role', 'Không tự đổi vai trò của mình.');
    const [user] = await db.select().from(users).where(eq(users.id, id));
    if (!user) throw new ApiError(404, 'not_found', 'Không tìm thấy người này.');
    if (user.isGuest && role !== 'player')
      throw new ApiError(400, 'guest_staff', 'Tài khoản khách không thể làm quản trị.');
    const [updated] = await db.update(users).set({ role }).where(eq(users.id, id)).returning();
    await audit(db, {
      actorId: staff.id,
      action: 'user.role',
      entityType: 'user',
      entityId: id,
      diff: { from: user.role, to: role },
    });
    return toAdminUser(updated ?? user, []);
  });

  app.post('/admin/users/:id/sanctions', as('moderation'), async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const body = parse(sanctionBody, request.body);
    const staff = staffOf(request);
    if (id === staff.id) throw new ApiError(400, 'own_sanction', 'Không tự phạt chính mình.');
    const [user] = await db.select().from(users).where(eq(users.id, id));
    if (!user) throw new ApiError(404, 'not_found', 'Không tìm thấy người này.');
    if (user.role === 'admin' && staff.role !== 'admin')
      throw new ApiError(403, 'forbidden', 'Không thể phạt quản trị viên.');
    const result = await applySanction(db, { userId: id, ...body, actorId: staff.id });
    reply.status(201);
    return result;
  });

  app.delete('/admin/sanctions/:id', as('moderation'), async (request) => {
    const { id } = parse(idParams, request.params);
    const result = await liftSanction(db, { sanctionId: id, actorId: staffOf(request).id });
    if (!result) throw new ApiError(404, 'not_found', 'Án phạt không còn hiệu lực.');
    return result;
  });

  app.get('/admin/audit', as('dashboard'), async (request): Promise<AuditEntryDto[]> => {
    const staff = staffOf(request);
    const { all } = parse(auditQuery, request.query);
    const everyone = all === '1' && permissionsOf(staff.role).includes('auditAll');
    const rows = await db
      .select({ entry: auditLogs, actorName: users.displayName })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(everyone ? undefined : eq(auditLogs.actorId, staff.id))
      .orderBy(desc(auditLogs.createdAt))
      .limit(200);
    return rows.map(({ entry, actorName }) => ({
      id: entry.id,
      actorId: entry.actorId,
      actorName,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      diff: entry.diff,
      createdAt: entry.createdAt.toISOString(),
    }));
  });
}
