import { createHash } from 'node:crypto';
import { activityDays, analyticsDaily, type Db } from '@campus/db';
import { type ClientEvent, fpsBucket, loadBucket } from '@campus/shared';
import { lt, sql } from 'drizzle-orm';
import { vnDateOf } from '../time';

/** Raw "who was around which day" is kept this long (docs/09 §6); counters longer. */
export const ACTIVITY_DAYS_KEPT = 90;

export interface Count {
  metric: string;
  dimension?: string;
  value: number;
}

/** Adds to the day's counters (docs/07 §8). Nothing about who is stored. */
export async function addCounts(db: Db, day: string, counts: Count[]): Promise<void> {
  const merged = new Map<string, Count>();
  for (const count of counts) {
    if (count.value === 0) continue;
    const key = `${count.metric}\u0000${count.dimension ?? ''}`;
    const previous = merged.get(key);
    merged.set(key, { ...count, value: (previous?.value ?? 0) + count.value });
  }
  if (merged.size === 0) return;
  await db
    .insert(analyticsDaily)
    .values(
      [...merged.values()].map((count) => ({
        day,
        metric: count.metric,
        dimension: count.dimension ?? '',
        value: count.value,
      })),
    )
    .onConflictDoUpdate({
      target: [analyticsDaily.day, analyticsDaily.metric, analyticsDaily.dimension],
      set: { value: sql`${analyticsDaily.value} + excluded.value` },
    });
}

/**
 * A person, as the analytics tables see them: a salted hash, the same every day so that coming
 * back can be counted, useless without the salt.
 */
export const userHash = (salt: string, userId: string) =>
  createHash('sha256')
    .update(salt)
    .update('\u0000')
    .update(userId)
    .digest('base64url')
    .slice(0, 22);

export async function addActivity(db: Db, day: string, hashes: Iterable<string>): Promise<void> {
  const rows = [...new Set(hashes)].map((userHash) => ({ day, userHash }));
  if (rows.length === 0) return;
  await db.insert(activityDays).values(rows).onConflictDoNothing();
}

function countOf(event: ClientEvent): Count {
  if (event.name === 'world_loaded')
    return {
      metric: event.firstVisit ? 'world_loaded_first' : 'world_loaded',
      dimension: loadBucket(event.ms),
      value: 1,
    };
  if (event.name === 'perf_sample')
    return { metric: `fps_${event.device}`, dimension: fpsBucket(event.fps), value: 1 };
  return { metric: 'client_error', dimension: event.code, value: 1 };
}

/** Counts what the game reports about itself into buckets; the events themselves are dropped. */
export async function recordClientEvents(
  db: Db,
  events: ClientEvent[],
  now = new Date(),
): Promise<void> {
  await addCounts(db, vnDateOf(now), events.map(countOf));
}

/** Forgets who was around more than 90 days ago. */
export async function pruneActivity(db: Db, now = new Date()): Promise<number> {
  const before = vnDateOf(new Date(now.getTime() - ACTIVITY_DAYS_KEPT * 86_400_000));
  const deleted = await db
    .delete(activityDays)
    .where(lt(activityDays.day, before))
    .returning({ day: activityDays.day });
  return deleted.length;
}
