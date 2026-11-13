import { createHash, randomBytes } from 'node:crypto';
import { type Db, sessions, uuidv7 } from '@campus/db';
import { and, eq, isNull } from 'drizzle-orm';

/** Refresh tokens last 30 days and rotate on every use (docs/07 §5.1). */
export const REFRESH_TOKEN_DAYS = 30;

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

export interface IssuedSession {
  sessionId: string;
  refreshToken: string;
  expiresAt: Date;
}

/** Starts a new session family for a fresh sign-in. */
export async function startSession(
  db: Db,
  userId: string,
  userAgent: string,
): Promise<IssuedSession> {
  return insertSession(db, userId, uuidv7(), userAgent);
}

async function insertSession(
  db: Db,
  userId: string,
  familyId: string,
  userAgent: string,
): Promise<IssuedSession> {
  const refreshToken = newToken();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 86_400_000);
  const sessionId = uuidv7();
  await db.insert(sessions).values({
    id: sessionId,
    userId,
    familyId,
    refreshHash: sha256(refreshToken),
    expiresAt,
    userAgent: userAgent.slice(0, 200),
  });
  return { sessionId, refreshToken, expiresAt };
}

export type RotateResult =
  | { ok: true; userId: string; session: IssuedSession }
  | { ok: false; reason: 'unknown' | 'expired' | 'reused' };

/**
 * Exchanges a refresh token for a new one. A token that was already exchanged means it was
 * copied: the whole family is revoked, signing out both the thief and the owner.
 */
export async function rotateSession(
  db: Db,
  refreshToken: string,
  userAgent: string,
): Promise<RotateResult> {
  const [current] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.refreshHash, sha256(refreshToken)));
  if (!current) return { ok: false, reason: 'unknown' };
  if (current.revokedAt) {
    await revokeFamily(db, current.familyId);
    return { ok: false, reason: 'reused' };
  }
  if (current.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'expired' };

  // Only one request may win the exchange; a concurrent second one sees it as reuse.
  const revoked = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, current.id), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  if (revoked.length === 0) {
    await revokeFamily(db, current.familyId);
    return { ok: false, reason: 'reused' };
  }
  const session = await insertSession(db, current.userId, current.familyId, userAgent);
  return { ok: true, userId: current.userId, session };
}

export async function revokeFamily(db: Db, familyId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.familyId, familyId), isNull(sessions.revokedAt)));
}

/** Signs out the session a refresh token belongs to, with everything descended from it. */
export async function endSession(db: Db, refreshToken: string): Promise<void> {
  const [current] = await db
    .select({ familyId: sessions.familyId })
    .from(sessions)
    .where(eq(sessions.refreshHash, sha256(refreshToken)));
  if (current) await revokeFamily(db, current.familyId);
}
