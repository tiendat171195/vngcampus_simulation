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

/** Points, level and streak (docs/06 §7). */
export interface StatsDto {
  points: number;
  xp: number;
  level: number;
  /** Xp where the current level started and where the next one starts. */
  levelFrom: number;
  levelTo: number;
  streakCurrent: number;
  streakBest: number;
  missionsCompleted: number;
}

export interface MissionHistoryItem {
  missionId: string;
  kind: string;
  title: { vi: string; en?: string };
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  rank: number | null;
}

export interface LeaderboardEntry {
  rank: number;
  id: string;
  name: string;
  score: number;
  members?: number;
}

export interface LeaderboardDto {
  board: 'points' | 'mission' | 'departments';
  /** Period key: `all`, a month `2026-11`, a week's Monday `2026-11-09`, or a mission id. */
  period: string;
  rows: LeaderboardEntry[];
  /** The asking person's line when below the top rows. */
  me: LeaderboardEntry | null;
}

export interface CommunityGoalDto {
  completions: number;
  target: number | null;
}
