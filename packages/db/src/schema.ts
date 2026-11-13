/**
 * Database tables (docs/07-backend-data.md §2). Change a table here, then run `pnpm db:generate`
 * to write the migration and `pnpm db:migrate` to apply it. Migrations only ever add (expand),
 * so the previous release keeps working while a new one rolls out (docs/09 §4).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
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
