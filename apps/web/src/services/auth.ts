// No zod and no heavy imports: the splash screen uses this module and must stay small.
import type { ApiErrorBody, SessionResponse, UserDto } from '@campus/shared';

const BASE = '/api/v1';
/** Ask for a new access token this long before the current one runs out. */
const MARGIN_MS = 60_000;
/** Refresh tokens rotate on every use, so two tabs must never exchange one at the same time. */
const REFRESH_LOCK = 'campus.auth.refresh';

interface Held {
  token: string;
  /** `Date.now()` at which the token stops being accepted. */
  expiresAt: number;
  user: UserDto;
}

export type SignInResult =
  | { ok: true; user: UserDto }
  /** `unreachable`: the API did not answer; the campus can still be explored alone. */
  | { ok: false; reason: 'unreachable' | 'refused'; message: string };

let held: Held | null = null;
let refreshing: Promise<Held | null> | null = null;

type Reply<T> = { status: number; body: T | ApiErrorBody | null } | null;

async function call<T>(method: string, path: string, body?: unknown): Promise<Reply<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (held && path !== '/auth/refresh') headers.authorization = `Bearer ${held.token}`;
  try {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as T | ApiErrorBody) : null };
  } catch {
    return null;
  }
}

function errorMessage(reply: Reply<unknown>): string {
  const body = reply?.body as Partial<ApiErrorBody> | null | undefined;
  return body?.error?.message ?? 'Máy chủ đang bận, thử lại sau ít phút.';
}

function hold(session: SessionResponse): Held {
  held = {
    token: session.accessToken,
    expiresAt: Date.now() + session.expiresIn * 1000,
    user: session.user,
  };
  return held;
}

async function exchange(): Promise<Held | null> {
  const reply = await call<SessionResponse>('POST', '/auth/refresh');
  if (reply?.status === 200) return hold(reply.body as SessionResponse);
  // Only a definite "no" forgets the session; a network hiccup keeps the old token for a retry.
  if (reply) held = null;
  return null;
}

/** Trades the refresh cookie for a new access token. One exchange at a time, across tabs too. */
function refresh(): Promise<Held | null> {
  refreshing ??= (async () => {
    try {
      const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
      return locks ? await locks.request(REFRESH_LOCK, exchange) : await exchange();
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** The signed-in user, or null before sign-in. */
export function currentUser(): UserDto | null {
  return held?.user ?? null;
}

/** A valid access token for the realtime server and the API, or null when signed out. */
export async function accessToken(): Promise<string | null> {
  if (held && held.expiresAt - Date.now() > MARGIN_MS) return held.token;
  return (await refresh())?.token ?? null;
}

/** A friendly default for someone who enters without typing a name. */
function guestName(): string {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  return `Khách ${Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

/**
 * Signs this browser in: resumes the session its cookie remembers, or creates a guest account
 * (docs/07-backend-data.md §3). A `name` different from the account's renames it; null keeps
 * whatever the account is called.
 */
export async function signIn(name: string | null): Promise<SignInResult> {
  let session = held && held.expiresAt - Date.now() > MARGIN_MS ? held : await refresh();
  if (!session) {
    const reply = await call<SessionResponse>('POST', '/auth/guest', { name: name ?? guestName() });
    if (!reply) return { ok: false, reason: 'unreachable', message: errorMessage(reply) };
    if (reply.status !== 201) return { ok: false, reason: 'refused', message: errorMessage(reply) };
    // The recovery code in this reply is offered again from the profile (P3.4).
    session = hold(reply.body as SessionResponse);
  }
  if (name !== null && session.user.displayName !== name) {
    const reply = await call<SessionResponse>('PATCH', '/me', { displayName: name });
    if (reply?.status === 200) session = hold(reply.body as SessionResponse);
  }
  return { ok: true, user: session.user };
}

/** Ends the session on this device. */
export async function signOut(): Promise<void> {
  await call('POST', '/auth/logout');
  held = null;
}
