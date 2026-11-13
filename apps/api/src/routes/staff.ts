import { type Db, users } from '@campus/db';
import { can, type Permission } from '@campus/shared';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { KeyRing } from '../auth/keys';
import { ApiError } from '../errors';
import { requireUser } from './guard';
import type { UserRow } from './users';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireStaff`: the staff member, read fresh from the database. */
    staff?: UserRow;
  }
}

/**
 * Pre-handler for admin routes (docs/08 §2). The role is read from the database on every request,
 * not trusted from the token, so a demotion takes effect at once; guests and banned accounts are
 * never staff.
 */
export function requireStaff(db: Db, keys: KeyRing, permission: Permission) {
  const signedIn = requireUser(keys);
  return async (request: FastifyRequest): Promise<void> => {
    await signedIn(request);
    const sub = request.auth?.sub ?? '';
    const [user] = await db.select().from(users).where(eq(users.id, sub));
    if (!user || user.isGuest || user.status === 'banned' || !can(user.role, permission))
      throw new ApiError(403, 'forbidden', 'Bạn không có quyền làm việc này.');
    request.staff = user;
  };
}

export const staffOf = (request: FastifyRequest): UserRow => {
  if (!request.staff) throw new ApiError(403, 'forbidden', 'Bạn không có quyền làm việc này.');
  return request.staff;
};
