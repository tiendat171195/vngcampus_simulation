import { auditLogs, type Db, sanctions, sessions, users, uuidv7 } from '@campus/db';
import { and, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Writes one audit entry (docs/08 §2): who did what to what. */
export async function audit(
  db: Db | Tx,
  entry: {
    actorId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    diff?: unknown;
  },
): Promise<void> {
  await db.insert(auditLogs).values({ id: uuidv7(), ...entry, diff: entry.diff ?? {} });
}

const inForce = (now: Date) =>
  and(
    isNull(sanctions.revokedAt),
    lte(sanctions.startsAt, now),
    or(isNull(sanctions.endsAt), gt(sanctions.endsAt, now)),
  );

/** Sanctions in force at `now`, for the realtime server and the admin. */
export async function activeSanctions(db: Db, now = new Date(), userIds?: string[]) {
  return db
    .select()
    .from(sanctions)
    .where(userIds ? and(inForce(now), inArray(sanctions.userId, userIds)) : inForce(now));
}

/**
 * Sets each user's status from the sanctions in force: banned beats muted beats active. Banned
 * people also lose every session, so they cannot get a new token.
 */
async function settle(tx: Tx, userId: string, now: Date): Promise<'active' | 'muted' | 'banned'> {
  const current = await tx
    .select({ type: sanctions.type })
    .from(sanctions)
    .where(and(eq(sanctions.userId, userId), inForce(now)));
  const status = current.some((s) => s.type === 'ban')
    ? 'banned'
    : current.some((s) => s.type === 'mute')
      ? 'muted'
      : 'active';
  await tx.update(users).set({ status }).where(eq(users.id, userId));
  if (status === 'banned')
    await tx
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  return status;
}

export async function applySanction(
  db: Db,
  input: {
    userId: string;
    type: 'mute' | 'ban' | 'warn';
    reason: string;
    hours: number | null;
    actorId: string;
  },
) {
  const now = new Date();
  return db.transaction(async (tx) => {
    const id = uuidv7();
    const endsAt = input.hours === null ? null : new Date(now.getTime() + input.hours * 3_600_000);
    await tx.insert(sanctions).values({
      id,
      userId: input.userId,
      type: input.type,
      reason: input.reason,
      startsAt: now,
      endsAt,
      createdBy: input.actorId,
    });
    const status = await settle(tx, input.userId, now);
    await audit(tx, {
      actorId: input.actorId,
      action: `sanction.${input.type}`,
      entityType: 'user',
      entityId: input.userId,
      diff: { sanctionId: id, reason: input.reason, hours: input.hours, status },
    });
    return { id, status };
  });
}

/** Lifts a sanction early. Returns the user's status after, or null when there was none. */
export async function liftSanction(db: Db, input: { sanctionId: string; actorId: string }) {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [lifted] = await tx
      .update(sanctions)
      .set({ revokedAt: now, revokedBy: input.actorId })
      .where(and(eq(sanctions.id, input.sanctionId), isNull(sanctions.revokedAt)))
      .returning();
    if (!lifted) return null;
    const status = await settle(tx, lifted.userId, now);
    await audit(tx, {
      actorId: input.actorId,
      action: 'sanction.lift',
      entityType: 'user',
      entityId: lifted.userId,
      diff: { sanctionId: lifted.id, status },
    });
    return { userId: lifted.userId, status };
  });
}

/** Puts people whose sanctions ran out back to active (a minute job). */
export async function settleExpiredSanctions(db: Db, now = new Date()): Promise<number> {
  const flagged = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`${users.status} <> 'active'`);
  let changed = 0;
  for (const { id } of flagged) {
    const status = await db.transaction((tx) => settle(tx, id, now));
    if (status === 'active') changed++;
  }
  return changed;
}
