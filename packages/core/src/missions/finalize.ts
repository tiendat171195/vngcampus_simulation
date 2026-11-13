import {
  type Db,
  leaderboardSnapshots,
  missionProgress,
  missionStats,
  missions,
  userStats,
  uuidv7,
  walletLedger,
} from '@campus/db';
import { missionDefinitionSchema, type Reward } from '@campus/shared';
import { and, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { missionLeaderboard, pointsLeaderboard, previousPeriod } from './leaderboards';
import { levelForXp, sumRewards } from './rewards';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Credits points and xp once per (user, reference) through the ledger, and keeps user_stats in
 * step. Returns what was actually credited (0 when it had been already).
 */
async function credit(
  tx: Tx,
  userId: string,
  rewards: readonly Reward[],
  refType: string,
  refId: string,
  reason: string,
): Promise<{ points: number; xp: number }> {
  const { points, xp } = sumRewards(rewards);
  const got = { points: 0, xp: 0 };
  for (const [currency, delta] of [
    ['points', points],
    ['xp', xp],
  ] as const) {
    if (delta <= 0) continue;
    const inserted = await tx
      .insert(walletLedger)
      .values({ id: uuidv7(), userId, currency, delta, reason, refType, refId })
      .onConflictDoNothing()
      .returning({ id: walletLedger.id });
    if (inserted.length > 0) got[currency] = delta;
  }
  if (got.points === 0 && got.xp === 0) return got;
  const [row] = await tx
    .insert(userStats)
    .values({ userId, points: got.points, xp: got.xp })
    .onConflictDoUpdate({
      target: userStats.userId,
      set: {
        points: sql`${userStats.points} + ${got.points}`,
        xp: sql`${userStats.xp} + ${got.xp}`,
        updatedAt: new Date(),
      },
    })
    .returning({ xp: userStats.xp });
  await tx
    .update(userStats)
    .set({ level: levelForXp(row?.xp ?? 0) })
    .where(eq(userStats.userId, userId));
  return got;
}

export interface FinalizeResult {
  missionId: string;
  participants: number;
  completions: number;
  medianDurationMs: number | null;
  rankRewarded: number;
  communityReached: boolean;
}

/**
 * Closes one ended mission (docs/06 §6): ranks the finishers, pays rank rewards and the
 * community goal, writes the summary and keeps the final leaderboard. Safe to run again or from
 * two processes at once: the summary row is claimed first, inside the same transaction.
 */
export async function finalizeMission(db: Db, missionId: string): Promise<FinalizeResult | null> {
  return db.transaction(async (tx) => {
    const claimed = await tx
      .insert(missionStats)
      .values({ missionId, participants: 0, completions: 0 })
      .onConflictDoNothing()
      .returning({ id: missionStats.missionId });
    if (claimed.length === 0) return null;
    const [row] = await tx.select().from(missions).where(eq(missions.id, missionId));
    const parsed = missionDefinitionSchema.safeParse(row?.definition);
    if (!row || !parsed.success) return null;
    const definition = parsed.data;

    await tx.execute(sql`
      update mission_progress p set rank = r.rank
      from (
        select user_id, rank() over (order by duration_ms asc, completed_at asc)::int as rank
        from mission_progress
        where mission_id = ${missionId} and completed_at is not null and not is_preview
      ) r
      where p.mission_id = ${missionId} and p.user_id = r.user_id`);
    const finishers = await tx
      .select({ userId: missionProgress.userId, rank: missionProgress.rank })
      .from(missionProgress)
      .where(and(eq(missionProgress.missionId, missionId), isNotNull(missionProgress.completedAt)));

    let rankRewarded = 0;
    for (const band of definition.rankRewards ?? [])
      for (const finisher of finishers)
        if (
          finisher.rank !== null &&
          finisher.rank >= band.fromRank &&
          finisher.rank <= band.toRank
        ) {
          const got = await credit(
            tx,
            finisher.userId,
            band.rewards,
            'rank',
            missionId,
            `Hạng ${finisher.rank}: ${definition.title.vi}`,
          );
          if (got.points > 0 || got.xp > 0) rankRewarded++;
        }

    const goal = definition.communityGoal;
    const communityReached = goal !== undefined && finishers.length >= goal.target;
    if (goal && communityReached)
      for (const finisher of finishers)
        await credit(
          tx,
          finisher.userId,
          goal.rewards,
          'community',
          missionId,
          `Mục tiêu chung: ${definition.title.vi}`,
        );

    const [summary] = await tx
      .select({
        participants: sql<number>`count(*)::int`,
        completions: sql<number>`count(${missionProgress.completedAt})::int`,
        median: sql<
          number | null
        >`(percentile_cont(0.5) within group (order by ${missionProgress.durationMs}) filter (where ${missionProgress.completedAt} is not null))::int`,
      })
      .from(missionProgress)
      .where(and(eq(missionProgress.missionId, missionId), eq(missionProgress.isPreview, false)));
    const result: FinalizeResult = {
      missionId,
      participants: summary?.participants ?? 0,
      completions: summary?.completions ?? 0,
      medianDurationMs: summary?.median ?? null,
      rankRewarded,
      communityReached,
    };
    await tx
      .update(missionStats)
      .set({
        participants: result.participants,
        completions: result.completions,
        medianDurationMs: result.medianDurationMs,
        computedAt: new Date(),
      })
      .where(eq(missionStats.missionId, missionId));

    const board = await missionLeaderboard(tx as unknown as Db, { missionId, limit: 100 });
    if (board.rows.length > 0)
      await tx
        .insert(leaderboardSnapshots)
        .values(
          board.rows.map((entry, i) => ({
            board: `mission:${missionId}`,
            period: 'final',
            rank: i + 1,
            subjectId: entry.id,
            score: entry.score,
          })),
        )
        .onConflictDoNothing();
    return result;
  });
}

/** Every published mission that ended more than `graceMs` ago and is not closed yet. */
export async function finalizeEndedMissions(db: Db, now = new Date(), graceMs = 60_000) {
  const ended = await db
    .select({ id: missions.id })
    .from(missions)
    .leftJoin(missionStats, eq(missionStats.missionId, missions.id))
    .where(
      and(
        eq(missions.publishStatus, 'published'),
        lt(missions.endsAt, new Date(now.getTime() - graceMs)),
        isNull(missionStats.missionId),
      ),
    );
  const results: FinalizeResult[] = [];
  for (const mission of ended) {
    const result = await finalizeMission(db, mission.id);
    if (result) results.push(result);
  }
  return results;
}

/** Keeps the final points leaderboards of last week and last month, once (docs/06 §7). */
export async function snapshotPeriodBoards(db: Db, now = new Date()): Promise<string[]> {
  const written: string[] = [];
  for (const period of ['week', 'month'] as const) {
    const range = previousPeriod(period, now);
    const board = `points:${period}`;
    const [exists] = await db
      .select({ rank: leaderboardSnapshots.rank })
      .from(leaderboardSnapshots)
      .where(and(eq(leaderboardSnapshots.board, board), eq(leaderboardSnapshots.period, range.key)))
      .limit(1);
    if (exists) continue;
    const { rows } = await pointsLeaderboard(db, {
      start: range.start,
      end: range.end,
      limit: 100,
    });
    if (rows.length === 0) continue;
    await db
      .insert(leaderboardSnapshots)
      .values(
        rows.map((entry, i) => ({
          board,
          period: range.key,
          rank: i + 1,
          subjectId: entry.id,
          score: entry.score,
        })),
      )
      .onConflictDoNothing();
    written.push(`${board}:${range.key}`);
  }
  return written;
}
