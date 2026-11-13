/**
 * Database tables (docs/07-backend-data.md §2). Change a table here, then run `pnpm db:generate`
 * to write the migration and `pnpm db:migrate` to apply it. Migrations only ever add (expand),
 * so the previous release keeps working while a new one rolls out (docs/09 §4).
 */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const ROLES = ['player', 'editor', 'moderator', 'admin'] as const;
export type Role = (typeof ROLES)[number];
export const USER_STATUSES = ['active', 'muted', 'banned'] as const;
export const PROVIDERS = ['guest', 'google', 'microsoft', 'oidc', 'zalo'] as const;
export type Provider = (typeof PROVIDERS)[number];

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
};

/** Departments people can say they belong to (P3.4); imported from a CSV file. */
export const departments = pgTable('departments', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull().unique(),
  parentId: uuid('parent_id').references((): AnyPgColumn => departments.id, {
    onDelete: 'set null',
  }),
  ...timestamps,
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  displayName: text('display_name').notNull(),
  email: text('email').unique(),
  isGuest: boolean('is_guest').notNull().default(true),
  role: text('role', { enum: ROLES }).notNull().default('player'),
  status: text('status', { enum: USER_STATUSES }).notNull().default('active'),
  /** Avatar configuration string (P3.3). */
  avatar: text('avatar').notNull().default(''),
  locale: text('locale').notNull().default('vi'),
  /** Chosen by the person, optional (docs/09 §8: collect the minimum). */
  departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
  /** Job title as the person writes it, optional. */
  title: text('title'),
  /** Keep this person out of the online directory (P3.4). */
  hidePresence: boolean('hide_presence').notNull().default(false),
  /** Version of the privacy notice the person accepted. */
  consentVersion: integer('consent_version'),
  ...timestamps,
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
});

export const authIdentities = pgTable(
  'auth_identities',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: PROVIDERS }).notNull(),
    /** The provider's id for the person; for guests a random id. */
    subject: text('subject').notNull(),
    /** Guests: SHA-256 of the recovery code that signs them in on another device. */
    secretHash: text('secret_hash'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('auth_identities_provider_subject').on(table.provider, table.subject),
    uniqueIndex('auth_identities_secret_hash').on(table.secretHash),
    index('auth_identities_user').on(table.userId),
  ],
);

/**
 * Refresh-token sessions. Tokens rotate on every use; all sessions descended from one sign-in
 * share a family, which is revoked as a whole if an already-used token comes back (theft).
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    /** SHA-256 of the refresh token; the token itself is never stored. */
    refreshHash: text('refresh_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    userAgent: text('user_agent').notNull().default(''),
    ...timestamps,
  },
  (table) => [index('sessions_user').on(table.userId), index('sessions_family').on(table.familyId)],
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
});

// ---------- missions (docs/07 §2.2) ----------

export const MISSION_KINDS = ['daily', 'weekly', 'event', 'onboarding'] as const;
export const PUBLISH_STATUSES = ['draft', 'published', 'archived'] as const;

export const missions = pgTable(
  'missions',
  {
    id: uuid('id').primaryKey(),
    kind: text('kind', { enum: MISSION_KINDS }).notNull(),
    publishStatus: text('publish_status', { enum: PUBLISH_STATUSES }).notNull().default('draft'),
    title: jsonb('title').notNull(),
    description: jsonb('description').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    /** Vietnam calendar day of a daily mission. */
    dailyDate: date('daily_date'),
    /** The whole validated MissionDefinition (objectives, rewards…). */
    definition: jsonb('definition').notNull(),
    mapVersion: text('map_version').notNull(),
    autoFilled: boolean('auto_filled').notNull().default(false),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One published daily mission per day.
    uniqueIndex('missions_one_daily_per_day')
      .on(table.dailyDate)
      .where(sql`${table.kind} = 'daily' and ${table.publishStatus} = 'published'`),
    index('missions_window').on(table.startsAt, table.endsAt),
  ],
);

export const missionProgress = pgTable(
  'mission_progress',
  {
    missionId: uuid('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Per objective: { current, done, data }. */
    state: jsonb('state').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    rank: integer('rank'),
    isPreview: boolean('is_preview').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.missionId, table.userId] }),
    index('mission_progress_completed').on(table.missionId, table.completedAt),
  ],
);

export const quizQuestions = pgTable('quiz_questions', {
  id: text('id').primaryKey(),
  text: jsonb('text').notNull(),
  choices: jsonb('choices').notNull(),
  correctIndex: integer('correct_index').notNull(),
  explanation: jsonb('explanation'),
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  active: boolean('active').notNull().default(true),
  ...timestamps,
});

// ---------- rewards (docs/07 §2.3) ----------

export const CURRENCIES = ['points', 'xp'] as const;

/** Every change to points and xp, never edited. The unique key makes each grant happen once. */
export const walletLedger = pgTable(
  'wallet_ledger',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    currency: text('currency', { enum: CURRENCIES }).notNull(),
    delta: integer('delta').notNull(),
    reason: text('reason').notNull(),
    /** What the grant is for, e.g. ('mission', <mission id>) or ('streak', '7:2026-11-16'). */
    refType: text('ref_type').notNull(),
    refId: text('ref_id').notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('wallet_ledger_once').on(table.userId, table.currency, table.refType, table.refId),
    // Weekly and monthly leaderboards add up recent points.
    index('wallet_ledger_recent').on(table.currency, table.createdAt),
  ],
);

export const userStats = pgTable('user_stats', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  points: integer('points').notNull().default(0),
  xp: integer('xp').notNull().default(0),
  level: integer('level').notNull().default(1),
  streakCurrent: integer('streak_current').notNull().default(0),
  streakBest: integer('streak_best').notNull().default(0),
  /** Last Vietnam day a daily mission was completed. */
  lastDailyDate: date('last_daily_date'),
  missionsCompleted: integer('missions_completed').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Written once by the finalize job when a mission has ended (docs/06 §6); also its marker. */
export const missionStats = pgTable('mission_stats', {
  missionId: uuid('mission_id')
    .primaryKey()
    .references(() => missions.id, { onDelete: 'cascade' }),
  participants: integer('participants').notNull(),
  completions: integer('completions').notNull(),
  medianDurationMs: integer('median_duration_ms'),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Leaderboards as they stood at the end of a period (docs/06 §7). */
export const leaderboardSnapshots = pgTable(
  'leaderboard_snapshots',
  {
    board: text('board').notNull(),
    period: text('period').notNull(),
    rank: integer('rank').notNull(),
    subjectId: text('subject_id').notNull(),
    score: integer('score').notNull(),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.board, table.period, table.rank] })],
);

// ---------- operations (docs/07 §2.4) ----------

/** `warn` restricts nothing: the person is told once, and it shows on their record. */
export const SANCTION_TYPES = ['mute', 'ban', 'warn'] as const;

/** Mutes and bans; in force from `startsAt` until `endsAt` (null: until lifted). */
export const sanctions = pgTable(
  'sanctions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type', { enum: SANCTION_TYPES }).notNull(),
    reason: text('reason').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (table) => [
    index('sanctions_user').on(table.userId),
    index('sanctions_active').on(table.revokedAt, table.endsAt),
  ],
);

/** Every staff action: who did what to what, and what changed (docs/08 §2). */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    diff: jsonb('diff').notNull().default(sql`'{}'::jsonb`),
    ...timestamps,
  },
  (table) => [index('audit_logs_actor').on(table.actorId, table.createdAt)],
);

/** Missions kept to reuse, and to fill empty days (docs/08 §4.5). */
export const missionTemplates = pgTable('mission_templates', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  /** A MissionDefinition; its dates are replaced when it is used. */
  definition: jsonb('definition').notNull(),
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  /** Offered to the empty-day filler. */
  active: boolean('active').notNull().default(true),
  lastUsedOn: date('last_used_on'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
});

export const ANNOUNCEMENT_LEVELS = ['ticker', 'popup', 'fullscreen'] as const;

/** Messages from the team to everyone in the campus, now or at a set time (docs/08 §5). */
export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id').primaryKey(),
    level: text('level', { enum: ANNOUNCEMENT_LEVELS }).notNull(),
    text: jsonb('text').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('announcements_window').on(table.startsAt, table.endsAt)],
);

// ---------- moderation and analytics (P5.4, docs/08 §6–7) ----------

export const REPORT_REASONS = [
  'harassment',
  'spam',
  'offensive_name',
  'cheating',
  'other',
] as const;
export const REPORT_STATUSES = ['open', 'dismissed', 'warned', 'muted', 'banned'] as const;

/**
 * A player's report about another. `context` holds the few chat lines around it that the
 * reporter saw (docs/05 §8): the only chat ever written to the database, kept for moderation.
 */
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey(),
    reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),
    targetUserId: uuid('target_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: text('reason', { enum: REPORT_REASONS }).notNull(),
    note: text('note').notNull().default(''),
    context: jsonb('context').notNull().default(sql`'[]'::jsonb`),
    status: text('status', { enum: REPORT_STATUSES }).notNull().default('open'),
    resolution: text('resolution'),
    handledBy: uuid('handled_by').references(() => users.id, { onDelete: 'set null' }),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('reports_status').on(table.status, table.createdAt),
    index('reports_target').on(table.targetUserId),
  ],
);

/**
 * Analytics, counted as they happen and never stored per person (docs/07 §8): one row per day,
 * metric and dimension (a device kind, a histogram bucket…).
 */
export const analyticsDaily = pgTable(
  'analytics_daily',
  {
    day: date('day').notNull(),
    metric: text('metric').notNull(),
    dimension: text('dimension').notNull().default(''),
    value: bigint('value', { mode: 'number' }).notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.day, table.metric, table.dimension] })],
);

/**
 * Who was around on which day, as a salted hash: enough to count daily users and how many come
 * back, not to tell who. Kept 90 days.
 */
export const activityDays = pgTable(
  'activity_days',
  {
    day: date('day').notNull(),
    userHash: text('user_hash').notNull(),
  },
  (table) => [primaryKey({ columns: [table.day, table.userHash] })],
);
