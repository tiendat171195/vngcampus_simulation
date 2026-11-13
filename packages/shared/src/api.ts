/** Shapes exchanged with the REST API (docs/07-backend-data.md §4). */

/**
 * Version of the privacy notice (docs/09 §8). Raising it asks everyone to agree again; the
 * version each person agreed to is stored with their account.
 */
export const PRIVACY_NOTICE_VERSION = 1;

/** Ways to sign in with a company account; `oidc` is any standards-compliant provider. */
export type SignInProvider = 'google' | 'oidc';

export interface UserDto {
  id: string;
  displayName: string;
  isGuest: boolean;
  role: 'player' | 'editor' | 'moderator' | 'admin';
  avatar: string;
  locale: string;
  /** Company address, for accounts signed in through a provider. */
  email: string | null;
  /** Privacy notice version this person agreed to; null if never. */
  consentVersion: number | null;
  /** Chosen from GET /departments; optional. */
  departmentId: string | null;
  /** Job title as the person wrote it; optional. */
  title: string | null;
  /** Kept out of the online list (still seen in the world by people nearby). */
  hidePresence: boolean;
}

export interface DepartmentDto {
  id: string;
  name: string;
  parentId: string | null;
}

/** What anyone signed in may see about a colleague (the profile card). */
export interface PublicProfileDto {
  id: string;
  displayName: string;
  isGuest: boolean;
  avatar: string;
  department: string | null;
  title: string | null;
}

export interface SessionResponse {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  user: UserDto;
}

export interface GuestSignUpResponse extends SessionResponse {
  /** Shown once: signs the same guest in on another device. */
  recoveryCode: string;
}

export interface BootstrapResponse {
  mapVersion: string;
  guestMode: 'off' | 'limited' | 'full';
  realtimePath: string;
  /** Sign-in buttons to offer, in order. */
  providers: Array<{ id: SignInProvider; label: string }>;
  privacyNoticeVersion: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
