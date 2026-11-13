import type { ApiErrorBody, SessionResponse } from '@campus/shared';

/**
 * The admin talks to the same API as the game, with the same sign-in: the refresh cookie set
 * when signing in on the game works here too (same host), and the access token stays in memory.
 */
let token: { value: string; expiresAt: number } | null = null;
let refreshing: Promise<string | null> | null = null;

async function exchange(): Promise<string | null> {
  const response = await fetch('/api/v1/auth/refresh', {
    method: 'POST',
    credentials: 'same-origin',
  }).catch(() => null);
  if (!response?.ok) {
    token = null;
    return null;
  }
  const session = (await response.json()) as SessionResponse;
  token = { value: session.accessToken, expiresAt: Date.now() + session.expiresIn * 1000 };
  return token.value;
}

/** A valid access token, refreshing it when it is about to run out; null when signed out. */
async function accessToken(): Promise<string | null> {
  if (token && token.expiresAt - Date.now() > 60_000) return token.value;
  // The game in another tab rotates the same refresh token: never exchange two at once.
  refreshing ??= (
    navigator.locks ? navigator.locks.request('campus.auth.refresh', exchange) : exchange()
  ).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Calls the API as the signed-in staff member; throws ApiFailure with the server's message. */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const bearer = await accessToken();
  if (!bearer) throw new ApiFailure(401, 'unauthorized', 'Cần đăng nhập.');
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${bearer}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  if (!response) throw new ApiFailure(0, 'offline', 'Không kết nối được máy chủ.');
  const data = (await response.json().catch(() => null)) as T | ApiErrorBody | null;
  if (!response.ok) {
    const error = (data as ApiErrorBody | null)?.error;
    throw new ApiFailure(
      response.status,
      error?.code ?? 'error',
      error?.message ?? 'Có lỗi xảy ra.',
    );
  }
  return data as T;
}

/** Where to sign in: the game (it shares the session with the admin). */
export function gameUrl(): string {
  const { protocol, hostname, port } = window.location;
  // In development the admin runs on 5174 and the game on 5173.
  return port === '5174' ? `${protocol}//${hostname}:5173/` : '/';
}
