/** Shapes exchanged with the REST API (docs/07-backend-data.md §4). */

export interface UserDto {
  id: string;
  displayName: string;
  isGuest: boolean;
  role: 'player' | 'editor' | 'moderator' | 'admin';
  avatar: string;
  locale: string;
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
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
