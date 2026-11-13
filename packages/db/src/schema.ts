/**
 * Database tables (docs/07-backend-data.md §2). Change a table here, then run `pnpm db:generate`
 * to write the migration and `pnpm db:migrate` to apply it. Migrations only ever add (expand),
 * so the previous release keeps working while a new one rolls out (docs/09 §4).
 */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
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
