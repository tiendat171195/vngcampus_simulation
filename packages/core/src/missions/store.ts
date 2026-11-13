import {
  type Db,
  missionProgress,
  missions,
  settings,
  userStats,
  uuidv7,
  walletLedger,
} from '@campus/db';
import {
  type MissionDefinition,
  type MissionKind,
  missionDefinitionSchema,
  type ObjectiveProgress,
} from '@campus/shared';
import { and, eq, gt, isNull, lt, lte, sql } from 'drizzle-orm';
import { vnDateOf } from '../time';
import type { Progress } from './engine';
import { bonusMultiplier, levelForXp, nextStreak, STREAK_BONUS, sumRewards } from './rewards';

export interface ActiveMission {
  id: string;
  kind: MissionKind;
  startsAt: Date;
  endsAt: Date;
  definition: MissionDefinition;
}

/** Published missions running at `now`. Rows that no longer validate are skipped and reported. */
export async function loadActiveMissions(
  db: Db,
  now = new Date(),
  onInvalid?: (id: string, problem: string) => void,
): Promise<ActiveMission[]> {
  const rows = await db
    .select()
    .from(missions)
    .where(
      and(
        eq(missions.publishStatus, 'published'),
        lte(missions.startsAt, now),
        gt(missions.endsAt, now),
      ),
    );
  const active: ActiveMission[] = [];
  for (const row of rows) {
    const parsed = missionDefinitionSchema.safeParse(row.definition);
    if (!parsed.success) {
      onInvalid?.(row.id, parsed.error.message);
      continue;
    }
    active.push({
      id: row.id,
      kind: row.kind,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      definition: parsed.data,
    });
  }
  return active;
}

export interface StoredProgress {
  progress: Progress;
  startedAt: Date;
  completedAt: Date | null;
}

export async function loadProgress(
  db: Db,
  missionId: string,
  userId: string,
): Promise<StoredProgress | null> {
  const [row] = await db
    .select()
    .from(missionProgress)
    .where(and(eq(missionProgress.missionId, missionId), eq(missionProgress.userId, userId)));
  if (!row) return null;
  return {
    progress: row.state as Record<string, ObjectiveProgress>,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

/** Saves progress that is not complete yet. A completed record is never changed again. */
export async function saveProgress(
  db: Db,
  input: { missionId: string; userId: string; progress: Progress; startedAt: Date },
): Promise<void> {
  await db
    .insert(missionProgress)
    .values({
      missionId: input.missionId,
      userId: input.userId,
      state: input.progress,
      startedAt: input.startedAt,
    })
    .onConflictDoUpdate({
      target: [missionProgress.missionId, missionProgress.userId],
      set: { state: input.progress, updatedAt: new Date() },
      where: isNull(missionProgress.completedAt),
    });
}

export interface CompletionResult {
  /** False when this completion was already recorded: nothing was granted again. */
  granted: boolean;
  points: number;
  xp: number;
  multiplier: number;
  /** Daily missions only. */
  streak: number | null;
  streakBonus: number;
  level: number;
  durationMs: number;
}

/**
 * Records a completion and grants its rewards, all in one transaction (docs/06 §5.4, §7). The
 * completion row is the gate: a second call for the same person and mission changes nothing,
 * and the ledger's unique key would refuse a second grant anyway.
 */
export async function completeMission(
  db: Db,
  input: {
    mission: ActiveMission;
    userId: string;
    progress: Progress;
    startedAt: Date;
    completedAt?: Date;
  },
): Promise<CompletionResult> {
  const completedAt = input.completedAt ?? new Date();
  const durationMs = Math.max(0, completedAt.getTime() - input.startedAt.getTime());
  const { mission, userId } = input;
  const multiplier = bonusMultiplier(mission.definition, completedAt);
  const { points, xp } = sumRewards(mission.definition.rewards, multiplier);

  return db.transaction(async (tx) => {
    const marked = await tx
      .insert(missionProgress)
      .values({
        missionId: mission.id,
        userId,
        state: input.progress,
        startedAt: input.startedAt,
        completedAt,
        durationMs,
      })
      .onConflictDoUpdate({
        target: [missionProgress.missionId, missionProgress.userId],
        set: { state: input.progress, completedAt, durationMs, updatedAt: new Date() },
        where: isNull(missionProgress.completedAt),
      })
      .returning({ missionId: missionProgress.missionId });
    const [stats] = await tx.select().from(userStats).where(eq(userStats.userId, userId));
    if (marked.length === 0)
      return {
        granted: false,
        points: 0,
        xp: 0,
        multiplier,
        streak: stats?.streakCurrent ?? null,
        streakBonus: 0,
        level: stats?.level ?? 1,
        durationMs,
      };

    const grant = async (
      currency: 'points' | 'xp',
      delta: number,
      refType: string,
      refId: string,
      reason: string,
    ) => {
      if (delta <= 0) return 0;
      const inserted = await tx
        .insert(walletLedger)
        .values({ id: uuidv7(), userId, currency, delta, reason, refType, refId })
        .onConflictDoNothing()
        .returning({ id: walletLedger.id });
      return inserted.length > 0 ? delta : 0;
    };
    const title = mission.definition.title.vi;
    let gotPoints = await grant('points', points, 'mission', mission.id, `Nhiệm vụ: ${title}`);
    const gotXp = await grant('xp', xp, 'mission', mission.id, `Nhiệm vụ: ${title}`);

    // Streaks follow daily missions and the Vietnam calendar.
    let streak: number | null = null;
    let streakBonus = 0;
    let streakBest = stats?.streakBest ?? 0;
    let lastDailyDate = stats?.lastDailyDate ?? null;
    if (mission.kind === 'daily') {
      const today = vnDateOf(mission.startsAt);
      const [holidayRow] = await tx.select().from(settings).where(eq(settings.key, 'holidays'));
      const holidays = new Set(
        Array.isArray(holidayRow?.value) ? (holidayRow.value as string[]) : [],
      );
      const missionDays = lastDailyDate
        ? (
            await tx
              .select({ day: missions.dailyDate })
              .from(missions)
              .where(
                and(
                  eq(missions.kind, 'daily'),
                  eq(missions.publishStatus, 'published'),
                  gt(missions.dailyDate, lastDailyDate),
                  lt(missions.dailyDate, today),
                ),
              )
          ).flatMap((row) => (row.day ? [row.day] : []))
        : [];
      streak = nextStreak(
        { current: stats?.streakCurrent ?? 0, lastDate: lastDailyDate },
        today,
        missionDays,
        holidays,
      );
      streakBest = Math.max(streakBest, streak);
      lastDailyDate = today > (lastDailyDate ?? '') ? today : lastDailyDate;
      const bonus = STREAK_BONUS[streak];
      if (bonus)
        streakBonus = await grant(
          'points',
          bonus,
          'streak',
          `${streak}:${today}`,
          `Chuỗi ${streak} ngày`,
        );
      gotPoints += streakBonus;
    }

    const totalXp = (stats?.xp ?? 0) + gotXp;
    const level = levelForXp(totalXp);
    await tx
      .insert(userStats)
      .values({
        userId,
        points: gotPoints,
        xp: gotXp,
        level,
        streakCurrent: streak ?? 0,
        streakBest,
        lastDailyDate,
        missionsCompleted: 1,
      })
      .onConflictDoUpdate({
        target: userStats.userId,
        set: {
          points: sql`${userStats.points} + ${gotPoints}`,
          xp: sql`${userStats.xp} + ${gotXp}`,
          level,
          ...(streak !== null ? { streakCurrent: streak, streakBest, lastDailyDate } : {}),
          missionsCompleted: sql`${userStats.missionsCompleted} + 1`,
          updatedAt: new Date(),
        },
      });
    return {
      granted: true,
      points: gotPoints,
      xp: gotXp,
      multiplier,
      streak,
      streakBonus,
      level,
      durationMs,
    };
  });
}
