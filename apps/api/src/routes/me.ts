import { deleteAccount } from '@campus/core';
import { authIdentities, departments, users } from '@campus/db';
import {
  AVATAR_MAX_LENGTH,
  displayNameSchema,
  isAvatar,
  PRIVACY_NOTICE_VERSION,
  type SessionResponse,
  type UserDto,
} from '@campus/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { ACCESS_TOKEN_SECONDS } from '../auth/keys';
import { newRecoveryCode } from '../auth/recovery';
import { sha256 } from '../auth/sessions';
import { ApiError } from '../errors';
import { parse } from './adminMissions';
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH } from './auth';
import { claimsOf, requireUser } from './guard';
import { claimsFor, toUserDto } from './users';

const patchBody = z
  .object({
    displayName: displayNameSchema.optional(),
    avatar: z.string().max(AVATAR_MAX_LENGTH).refine(isAvatar, 'Avatar không hợp lệ.').optional(),
    departmentId: z.uuid().nullable().optional(),
    title: z
      .string()
      .trim()
      .max(40)
      .refine((value) => !/[<>]/.test(value), 'Chức danh không được chứa < hoặc >.')
      .transform((value) => value || null)
      .nullable()
      .optional(),
    hidePresence: z.boolean().optional(),
  })
  .strict();
const consentBody = z.object({ version: z.literal(PRIVACY_NOTICE_VERSION) }).strict();

export async function meRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const { db, keys } = deps;
  const guard = { preHandler: requireUser(keys) };

  const load = async (id: string) => {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    if (!user) throw new ApiError(404, 'not_found', 'Không tìm thấy tài khoản.');
    return user;
  };

  app.get(
    '/me',
    guard,
    async (request): Promise<UserDto> => toUserDto(await load(claimsOf(request).sub)),
  );

  /** Changes the profile; returns a fresh access token because name and avatar travel in it. */
  /**
   * Deletes the signed-in account and everything in it (docs/09 §8: the right to erasure). The
   * body must say so explicitly, so a stray request cannot do it.
   */
  app.delete('/me', guard, async (request, reply) => {
    parse(z.object({ confirm: z.literal(true) }).strict(), request.body);
    await deleteAccount(db, { userId: claimsOf(request).sub, by: 'self', actorId: null });
    reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    return { deleted: true };
  });

  app.patch('/me', guard, async (request): Promise<SessionResponse> => {
    const claims = claimsOf(request);
    const parsed = patchBody.safeParse(request.body ?? {});
    if (!parsed.success)
      throw new ApiError(
        400,
        'invalid_request',
        'Dữ liệu gửi lên không hợp lệ.',
        z.flattenError(parsed.error),
      );
    if (parsed.data.displayName !== undefined) {
      // A company account is called what the company calls it, so nobody can pose as a
      // colleague (docs/09 §6).
      if (!claims.guest)
        throw new ApiError(
          403,
          'name_from_provider',
          'Tên của tài khoản công ty lấy từ hệ thống đăng nhập.',
        );
      await db
        .update(users)
        .set({ displayName: parsed.data.displayName })
        .where(eq(users.id, claims.sub));
    }
    const { avatar, departmentId, title, hidePresence } = parsed.data;
    if (departmentId) {
      const [known] = await db
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.id, departmentId));
      if (!known) throw new ApiError(400, 'unknown_department', 'Không có phòng ban này.');
    }
    const changes = {
      ...(avatar !== undefined ? { avatar } : {}),
      ...(departmentId !== undefined ? { departmentId } : {}),
      ...(title !== undefined ? { title } : {}),
      ...(hidePresence !== undefined ? { hidePresence } : {}),
    };
    if (Object.keys(changes).length > 0)
      await db.update(users).set(changes).where(eq(users.id, claims.sub));
    const user = await load(claims.sub);
    return {
      accessToken: await keys.sign(claimsFor(user, claims.sid)),
      expiresIn: ACCESS_TOKEN_SECONDS,
      user: toUserDto(user),
    };
  });

  /** Records agreement to the current privacy notice. */
  app.post('/me/consent', guard, async (request): Promise<UserDto> => {
    const parsed = consentBody.safeParse(request.body ?? {});
    if (!parsed.success)
      throw new ApiError(400, 'invalid_request', 'Phiên bản thông báo không đúng.');
    await db
      .update(users)
      .set({ consentVersion: parsed.data.version })
      .where(eq(users.id, claimsOf(request).sub));
    return toUserDto(await load(claimsOf(request).sub));
  });

  /** A new recovery code for a guest; the previous one stops working. */
  app.post('/me/recovery-code', guard, async (request): Promise<{ recoveryCode: string }> => {
    const claims = claimsOf(request);
    const recoveryCode = newRecoveryCode();
    const updated = await db
      .update(authIdentities)
      .set({ secretHash: sha256(recoveryCode) })
      .where(and(eq(authIdentities.userId, claims.sub), eq(authIdentities.provider, 'guest')))
      .returning({ id: authIdentities.id });
    if (updated.length === 0)
      throw new ApiError(400, 'not_guest', 'Chỉ tài khoản khách mới có mã khôi phục.');
    return { recoveryCode };
  });
}
