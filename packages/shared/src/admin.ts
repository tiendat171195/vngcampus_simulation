/**
 * Who may do what in the admin (docs/08 §2). The API checks these on every request; the admin
 * app only uses them to hide what would be refused anyway.
 */
export const STAFF_ROLES = ['editor', 'moderator', 'admin'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export type Role = 'player' | StaffRole;

export const PERMISSIONS = {
  dashboard: ['editor', 'moderator', 'admin'],
  missions: ['editor', 'admin'],
  announcements: ['editor', 'admin'],
  moderation: ['moderator', 'admin'],
  /** Changing roles. */
  roles: ['admin'],
  config: ['admin'],
  /** Everyone's audit entries; others see their own. */
  auditAll: ['admin'],
} as const satisfies Record<string, readonly StaffRole[]>;
export type Permission = keyof typeof PERMISSIONS;

export const can = (role: string, permission: Permission) =>
  (PERMISSIONS[permission] as readonly string[]).includes(role);

export const permissionsOf = (role: string) =>
  (Object.keys(PERMISSIONS) as Permission[]).filter((permission) => can(role, permission));

export interface AdminMeDto {
  id: string;
  displayName: string;
  email: string | null;
  role: Role;
  permissions: Permission[];
}

export interface SanctionDto {
  id: string;
  type: 'mute' | 'ban' | 'warn';
  reason: string;
  startsAt: string;
  endsAt: string | null;
  revokedAt: string | null;
  createdBy: string | null;
}

export interface AdminUserDto {
  id: string;
  displayName: string;
  email: string | null;
  isGuest: boolean;
  role: Role;
  status: 'active' | 'muted' | 'banned';
  createdAt: string;
  lastSeenAt: string | null;
  /** Sanctions in force now. */
  active: SanctionDto[];
}

export interface AdminUserDetailDto extends AdminUserDto {
  sanctions: SanctionDto[];
  stats: {
    points: number;
    xp: number;
    level: number;
    missionsCompleted: number;
    streakCurrent: number;
  };
}

export interface AuditEntryDto {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  diff: unknown;
  createdAt: string;
}

/** Where a mission is in its life (docs/06 §6), from its publish status and the clock. */
export type MissionState = 'draft' | 'scheduled' | 'running' | 'ended' | 'archived';

export interface AdminMissionSummary {
  id: string;
  kind: string;
  title: { vi: string; en?: string };
  publishStatus: 'draft' | 'published' | 'archived';
  state: MissionState;
  startsAt: string;
  endsAt: string;
  dailyDate: string | null;
  autoFilled: boolean;
  version: number;
}

export interface AdminMissionDto extends AdminMissionSummary {
  /** The MissionDefinition as stored. */
  definition: unknown;
}

export interface PublishCheckDto {
  errors: string[];
  warnings: string[];
}

export interface AdminQuestionDto {
  id: string;
  text: { vi: string; en?: string };
  choices: Array<{ vi: string; en?: string }>;
  correctIndex: number;
  explanation?: { vi: string; en?: string };
  tags: string[];
  active: boolean;
}
