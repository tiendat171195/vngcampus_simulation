import { settleExpiredSanctions } from '@campus/core';
import { type Db, sanctions, sessions, users, uuidv7 } from '@campus/db';
import type { AdminMeDto, AdminUserDetailDto, AdminUserDto, AuditEntryDto } from '@campus/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppDeps } from './app';
import { startSession } from './auth/sessions';
import { REFRESH_COOKIE } from './routes/auth';
import { claimsFor } from './routes/users';
import { freshDatabase, testApp } from './testing';

let db: Db;
let close: () => Promise<void>;
let app: FastifyInstance;
let deps: AppDeps;

beforeAll(async () => {
  ({ db, close } = await freshDatabase());
  ({ app, deps } = await testApp(db));
});
afterAll(async () => {
  await app.close();
  await close();
});

/** A user with a role, and an access token for them. */
async function person(
  name: string,
  role: 'player' | 'editor' | 'moderator' | 'admin',
  isGuest = false,
) {
  const id = uuidv7();
  const [user] = await db
    .insert(users)
    .values({ id, displayName: name, isGuest, role, email: isGuest ? null : `${id}@vng.com.vn` })
    .returning();
  if (!user) throw new Error('no user');
  const token = await deps.keys.sign(claimsFor(user, 'test'));
  return { id, token, auth: { authorization: `Bearer ${token}` } };
}

const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  auth: Record<string, string>,
  payload?: object,
) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: auth,
    ...(payload ? { payload } : {}),
  }) as unknown as Promise<LightMyRequestResponse>;

describe('admin access', () => {
  it('follows the role table, read from the database rather than the token', async () => {
    const player = await person('Người Chơi', 'player');
    const editor = await person('Biên Tập', 'editor');
    const moderator = await person('Kiểm Duyệt', 'moderator');
    const guest = await person('Khách', 'editor', true);

    expect((await call('GET', '/admin/me', player.auth)).statusCode).toBe(403);
    expect((await call('GET', '/admin/me', guest.auth)).statusCode).toBe(403);
    expect((await call('GET', '/admin/me', {})).statusCode).toBe(401);
    const me = (await call('GET', '/admin/me', editor.auth)).json() as AdminMeDto;
    expect(me.permissions).toEqual(['dashboard', 'missions', 'announcements']);
    expect((await call('GET', '/admin/users', editor.auth)).statusCode).toBe(403);
    expect((await call('GET', '/admin/users', moderator.auth)).statusCode).toBe(200);

    // Demoted in the database: the old token, which still says "moderator", no longer works.
    await db.update(users).set({ role: 'player' }).where(eq(users.id, moderator.id));
    expect((await call('GET', '/admin/users', moderator.auth)).statusCode).toBe(403);
  });
});

describe('users and roles', () => {
  it('finds people by name or email, and lets only admins change roles, with an audit entry', async () => {
    const admin = await person('Quản Trị', 'admin');
    const moderator = await person('Người Duyệt', 'moderator');
    const target = await person('Tìm Thấy Tôi', 'player');
    const guest = await person('Khách Lạ', 'player', true);

    const found = (
      await call('GET', '/admin/users?q=thấy', moderator.auth)
    ).json() as AdminUserDto[];
    expect(found.map((user) => user.displayName)).toEqual(['Tìm Thấy Tôi']);

    expect(
      (await call('PATCH', `/admin/users/${target.id}`, moderator.auth, { role: 'editor' }))
        .statusCode,
    ).toBe(403);
    const promoted = await call('PATCH', `/admin/users/${target.id}`, admin.auth, {
      role: 'editor',
    });
    expect((promoted.json() as AdminUserDto).role).toBe('editor');
    expect(
      (await call('PATCH', `/admin/users/${admin.id}`, admin.auth, { role: 'player' })).statusCode,
    ).toBe(400);
    expect(
      (await call('PATCH', `/admin/users/${guest.id}`, admin.auth, { role: 'editor' })).statusCode,
    ).toBe(400);
    expect(
      (await call('PATCH', `/admin/users/${target.id}`, admin.auth, { role: 'god' })).statusCode,
    ).toBe(400);

    const log = (await call('GET', '/admin/audit?all=1', admin.auth)).json() as AuditEntryDto[];
    expect(log[0]).toMatchObject({
      action: 'user.role',
      entityId: target.id,
      actorName: 'Quản Trị',
      diff: { from: 'player', to: 'editor' },
    });
    // Others see only their own entries.
    expect((await call('GET', '/admin/audit?all=1', moderator.auth)).json()).toEqual([]);
  });
});

describe('sanctions', () => {
  it('mute and ban at once, sign a banned person out, and lift again', async () => {
    const moderator = await person('Trực Ban', 'moderator');
    const admin = await person('Sếp Lớn', 'admin');
    const target = await person('Nói Nhiều', 'player');
    const session = await startSession(db, target.id, 'test');

    const mute = await call('POST', `/admin/users/${target.id}/sanctions`, moderator.auth, {
      type: 'mute',
      reason: 'Spam chat',
      hours: 1,
    });
    expect(mute.statusCode).toBe(201);
    expect(mute.json()).toMatchObject({ status: 'muted' });
    const ban = await call('POST', `/admin/users/${target.id}/sanctions`, moderator.auth, {
      type: 'ban',
      reason: 'Quấy rối',
      hours: null,
    });
    expect(ban.json()).toMatchObject({ status: 'banned' });

    const detail = (
      await call('GET', `/admin/users/${target.id}`, moderator.auth)
    ).json() as AdminUserDetailDto;
    expect(detail.status).toBe('banned');
    expect(detail.active.map((s) => s.type).sort()).toEqual(['ban', 'mute']);
    const [revoked] = await db.select().from(sessions).where(eq(sessions.id, session.sessionId));
    expect(revoked?.revokedAt).not.toBeNull();
    const refresh = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: `${REFRESH_COOKIE}=${session.refreshToken}` },
    });
    expect(refresh.statusCode).toBe(401);

    // Lifting the ban leaves the mute.
    const banId = (ban.json() as { id: string }).id;
    expect(
      (await call('DELETE', `/admin/sanctions/${banId}`, moderator.auth)).json(),
    ).toMatchObject({ status: 'muted' });
    expect((await call('DELETE', `/admin/sanctions/${banId}`, moderator.auth)).statusCode).toBe(
      404,
    );

    // Nobody sanctions themselves, and moderators do not sanction admins.
    expect(
      (
        await call('POST', `/admin/users/${moderator.id}/sanctions`, moderator.auth, {
          type: 'mute',
          reason: 'Tự phạt',
          hours: 1,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call('POST', `/admin/users/${admin.id}/sanctions`, moderator.auth, {
          type: 'mute',
          reason: 'Thử xem',
          hours: 1,
        })
      ).statusCode,
    ).toBe(403);
  });

  it('run out by themselves', async () => {
    const target = await person('Hết Hạn', 'player');
    await db.insert(sanctions).values({
      id: uuidv7(),
      userId: target.id,
      type: 'mute',
      reason: 'cũ',
      startsAt: new Date(Date.now() - 7_200_000),
      endsAt: new Date(Date.now() - 3_600_000),
    });
    await db.update(users).set({ status: 'muted' }).where(eq(users.id, target.id));
    await settleExpiredSanctions(db);
    const [user] = await db.select().from(users).where(eq(users.id, target.id));
    expect(user?.status).toBe('active');
  });
});
