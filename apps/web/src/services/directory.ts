import type { ApiErrorBody, DepartmentDto, PublicProfileDto } from '@campus/shared';
import { accessToken } from './auth';

/** A signed-in request to the API: the parsed body, or a message to show when it failed. */
async function authed<T>(method: string, path: string, body?: unknown): Promise<T | string> {
  const token = await accessToken();
  if (!token) return 'Phiên đăng nhập đã hết, hãy tải lại trang.';
  try {
    const response = await fetch(`/api/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await response.json().catch(() => null)) as T | ApiErrorBody | null;
    if (response.ok && data !== null) return data as T;
    return (data as ApiErrorBody | null)?.error?.message ?? 'Có lỗi xảy ra, thử lại sau.';
  } catch {
    return 'Không kết nối được máy chủ.';
  }
}

let departments: Promise<DepartmentDto[] | string> | null = null;

/** The department list, loaded once per visit. */
export function loadDepartments(): Promise<DepartmentDto[] | string> {
  departments ??= authed<DepartmentDto[]>('GET', '/departments').then((result) => {
    if (typeof result === 'string') departments = null;
    return result;
  });
  return departments;
}

/** A colleague's profile card. */
export const loadProfile = (userId: string) =>
  authed<PublicProfileDto>('GET', `/users/${encodeURIComponent(userId)}`);

/** A new recovery code for this guest account; the previous one stops working. */
export const newRecoveryCode = () => authed<{ recoveryCode: string }>('POST', '/me/recovery-code');
