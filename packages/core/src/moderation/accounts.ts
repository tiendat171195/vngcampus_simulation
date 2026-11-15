import { type Db, sessions, users } from '@campus/db';
import { and, eq, isNotNull, lt, or, sql } from 'drizzle-orm';
import { audit } from './sanctions';

/** Guest accounts nobody used for this long are deleted (docs/09 §8, privacy page). */
export const INACTIVE_GUEST_DAYS = 30;
/** Ended sessions (expired or revoked) are kept this long, for reuse detection, then deleted. */
export const ENDED_SESSION_DAYS = 30;

/**
 * Deletes an account and everything that belongs to it (profile, progress, points, sessions,
 * sanctions, reports about them); what they did as staff stays with the author left empty. The
 * audit entry holds no personal data.
 */
export async function deleteAccount(
  db: Db,
  input: { userId: string; by: 'self' | 'admin'; actorId: string | null },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [gone] = await tx
      .delete(users)
      .where(eq(users.id, input.userId))
      .returning({ id: users.id });
    if (!gone) return false;
    await audit(tx, {
      actorId: input.by === 'self' ? null : input.actorId,
      action: 'user.delete',
      entityType: 'user',
      entityId: input.userId,
      diff: { by: input.by },
    });
    return true;
  });
}

/** Retention (docs/09 §6): idle guests and long-ended sessions. */
export async function pruneAccounts(
  db: Db,
  now = new Date(),
): Promise<{ guests: number; sessions: number }> {
  const guestCutoff = new Date(now.getTime() - INACTIVE_GUEST_DAYS * 86_400_000);
  const guests = await db
    .delete(users)
    .where(
      and(
        eq(users.isGuest, true),
        sql`coalesce(${users.lastSeenAt}, ${users.createdAt}) < ${guestCutoff.toISOString()}::timestamptz`,
      ),
    )
    .returning({ id: users.id });
  const sessionCutoff = new Date(now.getTime() - ENDED_SESSION_DAYS * 86_400_000);
  const ended = await db
    .delete(sessions)
    .where(
      or(
        lt(sessions.expiresAt, sessionCutoff),
        and(isNotNull(sessions.revokedAt), lt(sessions.revokedAt, sessionCutoff)),
      ),
    )
    .returning({ id: sessions.id });
  return { guests: guests.length, sessions: ended.length };
}
