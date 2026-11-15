import { pruneAccounts } from '@campus/core';
import { auditLogs, type Db, sessions, users, uuidv7, walletLedger } from '@campus/db';
import type { SessionResponse } from '@campus/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppDeps } from './app';
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

const inject = (options: InjectOptions) =>
  app.inject(options) as unknown as Promise<LightMyRequestResponse>;

async function guest(name: string) {
  const response = await inject({
    method: 'POST',
    url: '/api/v1/auth/guest',
    payload: { name, consent: 1 },
  });
  const body = response.json() as SessionResponse;
  const cookie = response.cookies.find((c) => c.name === REFRESH_COOKIE);
  return {
    id: body.user.id,
    auth: { authorization: `Bearer ${body.accessToken}` },
    cookie: `${REFRESH_COOKIE}=${cookie?.value}`,
  };
}

async function staff(role: 'editor' | 'admin') {
  const [user] = await db
    .insert(users)
    .values({ id: uuidv7(), displayName: `${role} xoá`, isGuest: false, role })
    .returning();
  if (!user) throw new Error('no user');
  return {
    id: user.id,
    auth: { authorization: `Bearer ${await deps.keys.sign(claimsFor(user, 's'))}` },
  };
}

describe('deleting an account', () => {
  it('needs an explicit yes, then removes the account, what belongs to it and the session', async () => {
    const me = await guest('Muốn Xoá');
    await db.insert(walletLedger).values({
      id: uuidv7(),
      userId: me.id,
      currency: 'points',
      delta: 10,
      reason: 'mission',
      refType: 'test',
      refId: me.id,
    });
    const refused = await inject({
      method: 'DELETE',
      url: '/api/v1/me',
      headers: me.auth,
      payload: {},
    });
    expect(refused.statusCode).toBe(400);

    const deleted = await inject({
      method: 'DELETE',
      url: '/api/v1/me',
      headers: me.auth,
      payload: { confirm: true },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.cookies.find((c) => c.name === REFRESH_COOKIE)?.value).toBe('');
    expect(await db.select().from(users).where(eq(users.id, me.id))).toEqual([]);
    expect(await db.select().from(walletLedger).where(eq(walletLedger.userId, me.id))).toEqual([]);
    const refresh = await inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: me.cookie },
    });
    expect(refresh.statusCode).toBe(401);
    const [entry] = await db.select().from(auditLogs).where(eq(auditLogs.entityId, me.id));
    expect(entry).toMatchObject({ action: 'user.delete', actorId: null, diff: { by: 'self' } });
  });

  it('can be done for someone by an administrator, not by an editor, and never to oneself', async () => {
    const someone = await guest('Nhờ Xoá');
    const editor = await staff('editor');
    const admin = await staff('admin');
    const url = `/api/v1/admin/users/${someone.id}`;
    expect((await inject({ method: 'DELETE', url, headers: editor.auth })).statusCode).toBe(403);
    expect(
      (
        await inject({
          method: 'DELETE',
          url: `/api/v1/admin/users/${admin.id}`,
          headers: admin.auth,
        })
      ).statusCode,
    ).toBe(400);
    expect((await inject({ method: 'DELETE', url, headers: admin.auth })).statusCode).toBe(200);
    expect((await inject({ method: 'DELETE', url, headers: admin.auth })).statusCode).toBe(404);
    const [entry] = await db.select().from(auditLogs).where(eq(auditLogs.entityId, someone.id));
    expect(entry).toMatchObject({ actorId: admin.id, diff: { by: 'admin' } });
  });
});

describe('retention', () => {
  it('deletes guests idle for 30 days and sessions ended 30 days ago, nothing else', async () => {
    const now = new Date();
    const days = (n: number) => new Date(now.getTime() - n * 86_400_000);
    const idle = uuidv7();
    const recent = uuidv7();
    const member = uuidv7();
    await db.insert(users).values([
      {
        id: idle,
        displayName: 'Khách Cũ',
        isGuest: true,
        createdAt: days(60),
        lastSeenAt: days(31),
      },
      {
        id: recent,
        displayName: 'Khách Mới',
        isGuest: true,
        createdAt: days(60),
        lastSeenAt: days(5),
      },
      {
        id: member,
        displayName: 'Nhân Viên',
        isGuest: false,
        createdAt: days(400),
        lastSeenAt: days(200),
      },
    ]);
    const session = (expiresAt: Date, revokedAt: Date | null = null) => ({
      id: uuidv7(),
      userId: member,
      familyId: uuidv7(),
      refreshHash: uuidv7(),
      expiresAt,
      revokedAt,
    });
    await db
      .insert(sessions)
      .values([session(days(31)), session(days(-10), days(40)), session(days(-10))]);

    expect(await pruneAccounts(db, now)).toEqual({ guests: 1, sessions: 2 });
    const left = await db.select({ id: users.id }).from(users);
    expect(left.map((u) => u.id)).toEqual(expect.arrayContaining([recent, member]));
    expect(left.map((u) => u.id)).not.toContain(idle);
    expect(await db.select().from(sessions).where(eq(sessions.userId, member))).toHaveLength(1);
  });
});
