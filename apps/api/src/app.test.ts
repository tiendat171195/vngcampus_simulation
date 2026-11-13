import { type Db, importDepartments, parseDepartmentsCsv, users } from '@campus/db';
import {
  type BootstrapResponse,
  type DepartmentDto,
  type GuestSignUpResponse,
  healthResponseSchema,
  PRIVACY_NOTICE_VERSION,
  type PublicProfileDto,
  type SessionResponse,
  type UserDto,
} from '@campus/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppDeps } from './app';
import { REFRESH_COOKIE } from './routes/auth';
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

/** The refresh cookie set by a response, as a request cookie header. */
const refreshCookie = (response: { cookies: Array<{ name: string; value: string }> }) => {
  const cookie = response.cookies.find((c) => c.name === REFRESH_COOKIE);
  return cookie ? `${REFRESH_COOKIE}=${cookie.value}` : '';
};

async function signUp(name = 'Minh Anh') {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/guest',
    payload: { name, consent: PRIVACY_NOTICE_VERSION },
  });
  expect(response.statusCode).toBe(201);
  return {
    body: response.json() as GuestSignUpResponse,
    cookie: refreshCookie(response),
    response,
  };
}

describe('basics', () => {
  it('reports health in the shared shape', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(healthResponseSchema.parse(response.json()).service).toBe('api');
  });

  it('answers unknown routes with the standard error shape', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: 'not_found', message: expect.any(String) } });
  });

  it('serves the bootstrap document', async () => {
    const body = (
      await app.inject({ method: 'GET', url: '/api/v1/world/bootstrap' })
    ).json() as BootstrapResponse;
    expect(body).toMatchObject({ guestMode: 'full', realtimePath: '/rt' });
    expect(body.mapVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('guest sign-up', () => {
  it('creates an account, a recovery code and an HTTP-only refresh cookie scoped to auth', async () => {
    const { body, response } = await signUp('  Minh Anh  ');
    expect(body.user).toMatchObject({ displayName: 'Minh Anh', isGuest: true, role: 'player' });
    expect(body.recoveryCode).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    expect(body.expiresIn).toBe(900);
    const cookie = response.cookies.find((c) => c.name === REFRESH_COOKIE);
    expect(cookie).toMatchObject({ httpOnly: true, path: '/api/v1/auth', sameSite: 'Lax' });
  });

  it('rejects names that are empty, too long or contain markup', async () => {
    for (const name of ['', '   ', 'x'.repeat(25), '<b>hi</b>']) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/guest',
        payload: { name, consent: PRIVACY_NOTICE_VERSION },
      });
      expect(response.statusCode, name).toBe(400);
      expect(response.json().error.code).toBe('invalid_request');
    }
  });

  it('needs agreement to the current privacy notice', async () => {
    for (const consent of [undefined, 0, PRIVACY_NOTICE_VERSION + 1]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/guest',
        payload: { name: 'Chưa Đồng Ý', consent },
      });
      expect(response.statusCode, String(consent)).toBe(400);
    }
    const { body } = await signUp('Đã Đồng Ý');
    expect(body.user.consentVersion).toBe(PRIVACY_NOTICE_VERSION);
  });

  it('issues access tokens that the published keys verify', async () => {
    const { body } = await signUp('Kiểm Tra');
    const jwks = (await app.inject({ method: 'GET', url: '/api/v1/auth/jwks' })).json();
    const { payload } = await jwtVerify(body.accessToken, createLocalJWKSet(jwks), {
      issuer: 'campus-api',
      audience: 'campus',
    });
    expect(payload).toMatchObject({
      sub: body.user.id,
      name: 'Kiểm Tra',
      role: 'player',
      guest: true,
    });
  });

  it('limits how fast one address can create accounts', async () => {
    const strict = await testApp(db, { rateLimitScale: 1 });
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      const response = await strict.app.inject({
        method: 'POST',
        url: '/api/v1/auth/guest',
        payload: { name: `Người ${i}`, consent: PRIVACY_NOTICE_VERSION },
      });
      codes.push(response.statusCode);
    }
    expect(codes.slice(0, 10).every((code) => code === 201)).toBe(true);
    expect(codes[10]).toBe(429);
    await strict.app.close();
  });

  it('is refused when guests are turned off', async () => {
    const closed = await testApp(db, { guestMode: 'off' });
    const response = await closed.app.inject({
      method: 'POST',
      url: '/api/v1/auth/guest',
      payload: { name: 'A', consent: PRIVACY_NOTICE_VERSION },
    });
    expect(response.statusCode).toBe(403);
    await closed.app.close();
  });
});

describe('profile', () => {
  it('needs a valid access token', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/me' })).statusCode).toBe(401);
    const bad = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: 'Bearer nonsense' },
    });
    expect(bad.statusCode).toBe(401);
  });

  it('returns the profile and renames, with a new token carrying the new name', async () => {
    const { body } = await signUp('Tên Cũ');
    const auth = { authorization: `Bearer ${body.accessToken}` };
    const me = (
      await app.inject({ method: 'GET', url: '/api/v1/me', headers: auth })
    ).json() as UserDto;
    expect(me.displayName).toBe('Tên Cũ');

    const renamed = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: auth,
      payload: { displayName: 'Tên Mới' },
    });
    const session = renamed.json() as SessionResponse;
    expect(session.user.displayName).toBe('Tên Mới');
    expect((await deps.keys.verify(session.accessToken)).name).toBe('Tên Mới');

    const invalid = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: auth,
      payload: { role: 'admin' },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('saves an avatar and puts it in the new token; refuses anything that is not one', async () => {
    const { body } = await signUp('Áo Mới');
    const auth = { authorization: `Bearer ${body.accessToken}` };
    expect(body.user.avatar).toBe('');
    const avatar = 'v1.b2.s3.h4-5.t1-c.p2-4.f1-1.a3';
    const saved = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: auth,
      payload: { avatar },
    });
    expect(saved.statusCode).toBe(200);
    const session = saved.json() as SessionResponse;
    expect(session.user.avatar).toBe(avatar);
    expect((await deps.keys.verify(session.accessToken)).avatar).toBe(avatar);

    for (const bad of ['v1.b9.s3.h4-5.t1-c.p2-4.f1-1.a3', '<img>', 'x'.repeat(40)]) {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/me',
        headers: auth,
        payload: { avatar: bad },
      });
      expect(response.statusCode, bad).toBe(400);
    }
  });
});

describe('sessions', () => {
  it('rotates the refresh token on every use', async () => {
    const { cookie, body } = await signUp();
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie },
    });
    expect(first.statusCode).toBe(200);
    expect((first.json() as SessionResponse).user.id).toBe(body.user.id);
    const next = refreshCookie(first);
    expect(next).not.toBe(cookie);
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: next },
    });
    expect(second.statusCode).toBe(200);
  });

  it('treats a reused refresh token as stolen and signs the whole family out', async () => {
    const { cookie } = await signUp();
    const rotated = refreshCookie(
      await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie } }),
    );
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie },
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe('session_reused');
    // The legitimate holder of the newest token is signed out too.
    const owner = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: rotated },
    });
    expect(owner.statusCode).toBe(401);
  });

  it('logs out', async () => {
    const { cookie } = await signUp();
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie } }))
        .statusCode,
    ).toBe(204);
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie } }))
        .statusCode,
    ).toBe(401);
  });

  it('refuses a banned account on refresh', async () => {
    const { cookie, body } = await signUp('Bị Khoá');
    await db.update(users).set({ status: 'banned' }).where(eq(users.id, body.user.id));
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('recovery codes', () => {
  it('signs the same guest in on another device, however the code is typed', async () => {
    const { body } = await signUp('Hai Máy');
    const typed = body.recoveryCode.toLowerCase().replace(/-/g, ' ');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/guest/recover',
      payload: { code: typed },
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as SessionResponse).user.id).toBe(body.user.id);
    expect(refreshCookie(response)).not.toBe('');
  });

  it('rejects a wrong code, and an old code once a new one is made', async () => {
    const { body } = await signUp();
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/guest/recover',
      payload: { code: 'AAAAA-AAAAA-AAAAA' },
    });
    expect(wrong.statusCode).toBe(401);

    const fresh = await app.inject({
      method: 'POST',
      url: '/api/v1/me/recovery-code',
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    const { recoveryCode } = fresh.json() as { recoveryCode: string };
    expect(recoveryCode).not.toBe(body.recoveryCode);
    const old = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/guest/recover',
      payload: { code: body.recoveryCode },
    });
    expect(old.statusCode).toBe(401);
    const current = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/guest/recover',
      payload: { code: recoveryCode },
    });
    expect(current.statusCode).toBe(200);
  });
});

describe('profile and colleagues', () => {
  it('imports departments once, however often the file is loaded', async () => {
    const rows = parseDepartmentsCsv('name,parent\nKhối Công nghệ,\nPhòng Nền tảng,Khối Công nghệ');
    expect(await importDepartments(db, rows)).toEqual({ added: 2, total: 2 });
    expect(await importDepartments(db, rows)).toEqual({ added: 0, total: 2 });

    const { body } = await signUp('Xem Phòng Ban');
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/departments',
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    const departments = list.json() as DepartmentDto[];
    expect(departments.map((d) => d.name)).toEqual(['Khối Công nghệ', 'Phòng Nền tảng']);
    expect(departments[1]?.parentId).toBe(departments[0]?.id);
    expect((await app.inject({ method: 'GET', url: '/api/v1/departments' })).statusCode).toBe(401);
  });

  it('saves department, title and the online-list choice, and shows them on the card', async () => {
    const { body } = await signUp('Có Hồ Sơ');
    const auth = { authorization: `Bearer ${body.accessToken}` };
    const departments = (
      await app.inject({ method: 'GET', url: '/api/v1/departments', headers: auth })
    ).json() as DepartmentDto[];
    const department = departments[0] as DepartmentDto;

    const saved = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: auth,
      payload: { departmentId: department.id, title: '  Kỹ sư phần mềm ', hidePresence: true },
    });
    expect(saved.statusCode).toBe(200);
    const session = saved.json() as SessionResponse;
    expect(session.user).toMatchObject({
      departmentId: department.id,
      title: 'Kỹ sư phần mềm',
      hidePresence: true,
    });
    expect((await deps.keys.verify(session.accessToken)).hidden).toBe(true);

    const viewer = await signUp('Người Xem Thẻ');
    const card = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${body.user.id}`,
      headers: { authorization: `Bearer ${viewer.body.accessToken}` },
    });
    expect(card.json()).toEqual({
      id: body.user.id,
      displayName: 'Có Hồ Sơ',
      isGuest: true,
      avatar: '',
      department: department.name,
      title: 'Kỹ sư phần mềm',
    } satisfies PublicProfileDto);

    // Clearing works; nonsense does not.
    const cleared = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: auth,
      payload: { departmentId: null, title: '' },
    });
    expect((cleared.json() as SessionResponse).user).toMatchObject({
      departmentId: null,
      title: null,
    });
    for (const payload of [
      { departmentId: '01900000-0000-7000-8000-000000000000' },
      { departmentId: 'abc' },
      { title: '<b>Sếp</b>' },
      { title: 'x'.repeat(41) },
      { hidePresence: 'yes' },
    ]) {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/me',
        headers: auth,
        payload,
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it('shows no card for banned people, unknown ids, or to someone signed out', async () => {
    const { body } = await signUp('Bị Ẩn');
    const viewer = await signUp('Tò Mò');
    const auth = { authorization: `Bearer ${viewer.body.accessToken}` };
    await db.update(users).set({ status: 'banned' }).where(eq(users.id, body.user.id));
    for (const id of [body.user.id, 'guest:abc', '01900000-0000-7000-8000-000000000000']) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/users/${id}`,
        headers: auth,
      });
      expect(response.statusCode, id).toBe(404);
    }
    const signedOut = await app.inject({
      method: 'GET',
      url: `/api/v1/users/${viewer.body.user.id}`,
    });
    expect(signedOut.statusCode).toBe(401);
  });
});
