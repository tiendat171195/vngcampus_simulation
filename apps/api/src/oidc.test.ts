import type { Db } from '@campus/db';
import { users } from '@campus/db';
import { type MockIdp, type MockLogin, startMockIdp } from '@campus/mock-idp';
import {
  type BootstrapResponse,
  type GuestSignUpResponse,
  PRIVACY_NOTICE_VERSION,
  type SessionResponse,
} from '@campus/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { decodeJwt } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOidcProvider } from './auth/oidc';
import { REFRESH_COOKIE } from './routes/auth';
import { freshDatabase, testApp } from './testing';

let db: Db;
let close: () => Promise<void>;
let app: FastifyInstance;
let idp: MockIdp;

beforeAll(async () => {
  ({ db, close } = await freshDatabase());
  idp = await startMockIdp();
  ({ app } = await testApp(db, {
    oidc: {
      providers: [
        createOidcProvider({
          id: 'oidc',
          label: 'Mock',
          issuer: idp.issuer,
          clientId: idp.clientId,
          clientSecret: idp.clientSecret,
        }),
      ],
      publicUrl: 'http://localhost:5173',
      emailDomains: ['vng.com.vn'],
      adminEmails: ['sep@vng.com.vn'],
    },
  }));
});
afterAll(async () => {
  await app.close();
  await idp.close();
  await close();
});

const cookieOf = (response: { cookies: Array<{ name: string; value: string }> }, name: string) => {
  const cookie = response.cookies.find((c) => c.name === name && c.value);
  return cookie ? `${name}=${cookie.value}` : '';
};

/**
 * Goes through the whole round trip as a browser would: start → the provider's sign-in form →
 * back to the callback. `cookie` is the browser's refresh cookie, if it has one.
 */
async function signInWith(
  login: MockLogin,
  options: { cookie?: string; consent?: number | null; query?: string; tamper?: boolean } = {},
) {
  const consent = options.consent === undefined ? PRIVACY_NOTICE_VERSION : options.consent;
  const query = options.query ?? `return=%2Fplay%3Fx%3D1${consent ? `&consent=${consent}` : ''}`;
  const start = await app.inject({
    method: 'GET',
    url: `/api/v1/auth/oidc/oidc/start?${query}`,
    headers: options.cookie ? { cookie: options.cookie } : {},
  });
  expect(start.statusCode).toBe(302);
  const flow = cookieOf(start, 'campus_oidc');
  const authorize = new URL(String(start.headers.location));
  expect(authorize.origin).toBe(idp.issuer);

  const form = new URLSearchParams(authorize.searchParams);
  form.set('email', login.email);
  form.set('name', login.name);
  if (login.emailVerified !== false) form.set('email_verified', 'true');
  const answer = await fetch(`${idp.issuer}/authorize`, {
    method: 'POST',
    body: form,
    redirect: 'manual',
  });
  const back = new URL(String(answer.headers.get('location')));
  expect(back.pathname).toBe('/api/v1/auth/oidc/oidc/callback');
  if (options.tamper) back.searchParams.set('state', 'not-the-state');

  const callback = await app.inject({
    method: 'GET',
    url: `${back.pathname}${back.search}`,
    headers: { cookie: [flow, options.cookie].filter(Boolean).join('; ') },
  });
  expect(callback.statusCode).toBe(302);
  return {
    location: String(callback.headers.location),
    cookie: cookieOf(callback, REFRESH_COOKIE),
  };
}

async function session(cookie: string): Promise<SessionResponse> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/refresh',
    headers: { cookie },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as SessionResponse;
}

async function guest(name: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/guest',
    payload: { name, consent: PRIVACY_NOTICE_VERSION },
  });
  expect(response.statusCode).toBe(201);
  return {
    body: response.json() as GuestSignUpResponse,
    cookie: cookieOf(response, REFRESH_COOKIE),
  };
}

describe('company sign-in', () => {
  it('is offered in the bootstrap document', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/world/bootstrap' });
    const body = response.json() as BootstrapResponse;
    expect(body.providers).toEqual([{ id: 'oidc', label: 'Mock' }]);
    expect(body.privacyNoticeVersion).toBe(PRIVACY_NOTICE_VERSION);
  });

  it('creates a company account named by the provider and returns where the person was', async () => {
    const { location, cookie } = await signInWith({
      email: 'Lan.Nguyen@VNG.com.vn',
      name: '  Nguyễn <Thị> Lan  ',
    });
    expect(location).toBe('/play?x=1');
    const { user, accessToken } = await session(cookie);
    expect(user).toMatchObject({
      displayName: 'Nguyễn Thị Lan',
      email: 'lan.nguyen@vng.com.vn',
      isGuest: false,
      role: 'player',
      consentVersion: PRIVACY_NOTICE_VERSION,
    });
    expect(decodeJwt(accessToken)).toMatchObject({ guest: false, name: 'Nguyễn Thị Lan' });
  });

  it('signs the same person into the same account, with the name the provider has now', async () => {
    const first = await session(
      (await signInWith({ email: 'hai@vng.com.vn', name: 'Hải' })).cookie,
    );
    const again = await session(
      (await signInWith({ email: 'hai@vng.com.vn', name: 'Trần Hải' })).cookie,
    );
    expect(again.user.id).toBe(first.user.id);
    expect(again.user.displayName).toBe('Trần Hải');
  });

  it('turns a guest into a company account, keeping it, and retires the guest sign-in', async () => {
    const visitor = await guest('Khách Tò Mò');
    const { cookie } = await signInWith(
      { email: 'to.mo@vng.com.vn', name: 'Tô Mơ' },
      { cookie: visitor.cookie },
    );
    const { user } = await session(cookie);
    expect(user.id).toBe(visitor.body.user.id);
    expect(user).toMatchObject({ isGuest: false, displayName: 'Tô Mơ' });

    // The old guest session and the recovery code no longer open the account.
    const old = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: visitor.cookie },
    });
    expect(old.statusCode).toBe(401);
    const recover = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/guest/recover',
      payload: { code: visitor.body.recoveryCode },
    });
    expect(recover.statusCode).toBe(401);
  });

  it('switches a guest to the company account that person already has', async () => {
    const owner = await session(
      (await signInWith({ email: 'da.co@vng.com.vn', name: 'Đã Có' })).cookie,
    );
    const visitor = await guest('Lại Là Khách');
    const { cookie } = await signInWith(
      { email: 'da.co@vng.com.vn', name: 'Đã Có' },
      { cookie: visitor.cookie },
    );
    expect((await session(cookie)).user.id).toBe(owner.user.id);
    const old = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: visitor.cookie },
    });
    expect(old.statusCode).toBe(401);
  });

  it('turns away other domains, unverified addresses and tampered answers', async () => {
    const outsider = await signInWith({ email: 'someone@gmail.com', name: 'Ngoài' });
    expect(outsider.location).toBe('/play?x=1&auth_error=domain');
    expect(outsider.cookie).toBe('');

    const unverified = await signInWith({
      email: 'chua@vng.com.vn',
      name: 'Chưa Xác Minh',
      emailVerified: false,
    });
    expect(unverified.location).toContain('auth_error=unverified');

    const tampered = await signInWith({ email: 'gia@vng.com.vn', name: 'Giả' }, { tamper: true });
    expect(tampered.location).toContain('auth_error=failed');
    expect(tampered.cookie).toBe('');
  });

  it('needs the cookie from the start of the same attempt', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/oidc/oidc/callback?code=x&state=y',
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/?auth_error=expired');
  });

  it('only sends people back to paths on this site', async () => {
    for (const target of [
      '//evil.example',
      'https://evil.example/',
      '/\\evil.example',
      '/\t/evil.example',
      '/\n/evil.example',
      '/a\\..\\/evil.example',
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/oidc/oidc/start?return=${encodeURIComponent(target)}`,
      });
      expect(response.statusCode).toBe(302);
      const { location } = await signInWith(
        { email: 'quay.ve@vng.com.vn', name: 'Quay Về' },
        { query: `return=${encodeURIComponent(target)}` },
      );
      expect(location, target).toBe('/');
    }
  });

  it('makes the listed people administrators', async () => {
    const { user } = await session(
      (await signInWith({ email: 'sep@vng.com.vn', name: 'Sếp' })).cookie,
    );
    expect(user.role).toBe('admin');
  });

  it('refuses banned accounts', async () => {
    const { user } = await session(
      (await signInWith({ email: 'bi.khoa@vng.com.vn', name: 'Bị Khoá' })).cookie,
    );
    await db.update(users).set({ status: 'banned' }).where(eq(users.id, user.id));
    const again = await signInWith({ email: 'bi.khoa@vng.com.vn', name: 'Bị Khoá' });
    expect(again.location).toContain('auth_error=banned');
    expect(again.cookie).toBe('');
  });

  it('leaves consent unrecorded when the person did not agree before leaving', async () => {
    const { cookie } = await signInWith(
      { email: 'chua.dong.y@vng.com.vn', name: 'Chưa Đồng Ý' },
      { consent: null },
    );
    const { user, accessToken } = await session(cookie);
    expect(user.consentVersion).toBeNull();

    const agree = await app.inject({
      method: 'POST',
      url: '/api/v1/me/consent',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { version: PRIVACY_NOTICE_VERSION },
    });
    expect(agree.statusCode).toBe(200);
    expect(agree.json().consentVersion).toBe(PRIVACY_NOTICE_VERSION);
  });

  it('keeps company accounts under the name the company knows them by', async () => {
    const { accessToken } = await session(
      (await signInWith({ email: 'ten.that@vng.com.vn', name: 'Tên Thật' })).cookie,
    );
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { displayName: 'Giám Đốc' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('name_from_provider');
  });
});
