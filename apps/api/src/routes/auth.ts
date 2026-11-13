import { authIdentities, users, uuidv7 } from '@campus/db';
import {
  displayNameSchema,
  type GuestSignUpResponse,
  PRIVACY_NOTICE_VERSION,
  type SessionResponse,
} from '@campus/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { ACCESS_TOKEN_SECONDS } from '../auth/keys';
import { newRecoveryCode, normaliseRecoveryCode } from '../auth/recovery';
import {
  endSession,
  type IssuedSession,
  REFRESH_TOKEN_DAYS,
  rotateSession,
  sha256,
  startSession,
} from '../auth/sessions';
import { ApiError } from '../errors';
import { claimsFor, toUserDto, type UserRow } from './users';

export const REFRESH_COOKIE = 'campus_refresh';
const COOKIE_PATH = '/api/v1/auth';

/** The refresh token lives in an HTTP-only cookie that only the auth routes receive. */
export function setRefreshCookie(reply: FastifyReply, session: IssuedSession, secure: boolean) {
  return reply.setCookie(REFRESH_COOKIE, session.refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: COOKIE_PATH,
    maxAge: REFRESH_TOKEN_DAYS * 86_400,
  });
}

const guestBody = z.object({
  name: displayNameSchema,
  /** The privacy notice version shown next to the button; an account needs consent first. */
  consent: z.literal(PRIVACY_NOTICE_VERSION, {
    error: 'Cần đồng ý với thông báo quyền riêng tư.',
  }),
});
const recoverBody = z.object({ code: z.string().min(10).max(40) });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success)
    throw new ApiError(
      400,
      'invalid_request',
      'Dữ liệu gửi lên không hợp lệ.',
      z.flattenError(parsed.error),
    );
  return parsed.data;
}

export async function authRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const { db, keys } = deps;
  const limit = (max: number) => Math.round(max * (deps.rateLimitScale ?? 1));

  const setCookie = (reply: FastifyReply, session: IssuedSession) =>
    setRefreshCookie(reply, session, deps.secureCookies);
  const clearCookie = (reply: FastifyReply) =>
    reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });

  const respond = async (user: UserRow, session: IssuedSession): Promise<SessionResponse> => ({
    accessToken: await keys.sign(claimsFor(user, session.sessionId)),
    expiresIn: ACCESS_TOKEN_SECONDS,
    user: toUserDto(user),
  });

  const userAgent = (request: FastifyRequest) => String(request.headers['user-agent'] ?? '');

  app.get('/auth/jwks', async (_request, reply) => {
    reply.header('cache-control', 'public, max-age=300');
    return keys.jwks;
  });

  app.post(
    '/auth/guest',
    { config: { rateLimit: { max: limit(10), timeWindow: '1 minute' } } },
    async (request, reply): Promise<GuestSignUpResponse> => {
      if (deps.guestMode === 'off')
        throw new ApiError(403, 'guests_disabled', 'Cần đăng nhập bằng tài khoản công ty.');
      const { name, consent } = parse(guestBody, request.body);
      const recoveryCode = newRecoveryCode();
      const user = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(users)
          .values({ id: uuidv7(), displayName: name, isGuest: true, consentVersion: consent })
          .returning();
        if (!created) throw new ApiError(500, 'internal', 'Không tạo được tài khoản.');
        await tx.insert(authIdentities).values({
          id: uuidv7(),
          userId: created.id,
          provider: 'guest',
          subject: uuidv7(),
          secretHash: sha256(recoveryCode),
        });
        return created;
      });
      const session = await startSession(db, user.id, userAgent(request));
      setCookie(reply, session);
      reply.status(201);
      return { ...(await respond(user, session)), recoveryCode };
    },
  );

  app.post(
    '/auth/guest/recover',
    { config: { rateLimit: { max: limit(5), timeWindow: '1 minute' } } },
    async (request, reply): Promise<SessionResponse> => {
      const { code } = parse(recoverBody, request.body);
      const [row] = await db
        .select({ user: users })
        .from(authIdentities)
        .innerJoin(users, eq(users.id, authIdentities.userId))
        .where(
          and(
            eq(authIdentities.provider, 'guest'),
            eq(authIdentities.secretHash, sha256(normaliseRecoveryCode(code))),
          ),
        );
      if (!row) throw new ApiError(401, 'invalid_code', 'Mã khôi phục không đúng.');
      if (row.user.status === 'banned') throw new ApiError(403, 'banned', 'Tài khoản đã bị khoá.');
      const session = await startSession(db, row.user.id, userAgent(request));
      setCookie(reply, session);
      return respond(row.user, session);
    },
  );

  app.post(
    '/auth/refresh',
    // Per address, and a whole office may share one public IP: a thousand people refreshing
    // every 15 minutes is about 70 a minute. Refresh tokens cannot be guessed, so this only
    // caps load.
    { config: { rateLimit: { max: limit(300), timeWindow: '1 minute' } } },
    async (request, reply): Promise<SessionResponse> => {
      const token = request.cookies[REFRESH_COOKIE];
      if (!token) throw new ApiError(401, 'no_session', 'Chưa đăng nhập.');
      const result = await rotateSession(db, token, userAgent(request));
      if (!result.ok) {
        clearCookie(reply);
        throw new ApiError(
          401,
          result.reason === 'reused' ? 'session_reused' : 'no_session',
          'Phiên đăng nhập đã hết hạn.',
        );
      }
      const [user] = await db.select().from(users).where(eq(users.id, result.userId));
      if (!user || user.status === 'banned') {
        clearCookie(reply);
        throw new ApiError(403, 'banned', 'Tài khoản đã bị khoá.');
      }
      await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, user.id));
      setCookie(reply, result.session);
      return respond(user, result.session);
    },
  );

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE];
    if (token) await endSession(db, token);
    clearCookie(reply);
    return reply.status(204).send();
  });
}
