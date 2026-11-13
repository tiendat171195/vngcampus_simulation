import { departments, users } from '@campus/db';
import type { DepartmentDto, PublicProfileDto } from '@campus/shared';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { ApiError } from '../errors';
import { requireUser } from './guard';

const userParams = z.object({ id: z.uuid() });

/** Colleagues and departments, for signed-in people only (docs/07 §4). */
export async function directoryRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const { db } = deps;
  const guard = { preHandler: requireUser(deps.keys) };

  app.get('/departments', guard, async (_request, reply): Promise<DepartmentDto[]> => {
    reply.header('cache-control', 'private, max-age=300');
    return db
      .select({ id: departments.id, name: departments.name, parentId: departments.parentId })
      .from(departments)
      .orderBy(asc(departments.name));
  });

  /** The profile card: what anyone may see about a colleague, nothing more. */
  app.get('/users/:id', guard, async (request): Promise<PublicProfileDto> => {
    const parsed = userParams.safeParse(request.params);
    if (!parsed.success) throw new ApiError(404, 'not_found', 'Không tìm thấy người này.');
    const [row] = await db
      .select({ user: users, department: departments.name })
      .from(users)
      .leftJoin(departments, eq(departments.id, users.departmentId))
      .where(eq(users.id, parsed.data.id));
    if (!row || row.user.status === 'banned')
      throw new ApiError(404, 'not_found', 'Không tìm thấy người này.');
    return {
      id: row.user.id,
      displayName: row.user.displayName,
      isGuest: row.user.isGuest,
      avatar: row.user.avatar,
      department: row.department,
      title: row.user.title,
    };
  });
}
