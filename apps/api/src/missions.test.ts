import {
  completeMission,
  departmentLeaderboard,
  finalizeEndedMissions,
  loadActiveMissions,
  loadProgress,
  missionLeaderboard,
  type Progress,
  pointsLeaderboard,
  saveProgress,
  vnDayBounds,
} from '@campus/core';
import {
  type Db,
  departments,
  leaderboardSnapshots,
  missionProgress,
  missionStats,
  missions,
  settings,
  userStats,
  users,
  uuidv7,
  walletLedger,
} from '@campus/db';
import { type MissionDefinitionInput, missionDefinitionSchema } from '@campus/shared';
import { exampleMission } from '@campus/shared/fixtures';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase } from './testing';

/**
 * The mission store and rewards against a real PostgreSQL (docs/06 §5.4, §7): progress saved,
 * rewards granted exactly once, streaks that ignore weekends and holidays.
 */
let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await freshDatabase());
});
afterAll(async () => {
  await close();
});

async function newUser(name = 'Người Chơi') {
  const id = uuidv7();
  await db.insert(users).values({ id, displayName: name, isGuest: false });
  return id;
}

/** A published daily mission for a Vietnam day, from the documented example. */
async function dailyMission(day: string, extra: Partial<MissionDefinitionInput> = {}) {
  const { start, end } = vnDayBounds(day);
  const definition = missionDefinitionSchema.parse({
    ...exampleMission,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    ...extra,
  });
  const id = uuidv7();
  await db.insert(missions).values({
    id,
    kind: 'daily',
    publishStatus: 'published',
    title: definition.title,
    description: definition.description,
    startsAt: start,
    endsAt: end,
    dailyDate: day,
    definition,
    mapVersion: definition.mapVersion,
  });
  return { id, kind: 'daily' as const, startsAt: start, endsAt: end, definition };
}

const done: Progress = { o1: { current: 1, done: true } };
/** 10:00 in Vietnam on that day. */
const morningOf = (day: string) => new Date(vnDayBounds(day).start.getTime() + 10 * 3_600_000);
const stats = async (userId: string) =>
  (await db.select().from(userStats).where(eq(userStats.userId, userId)))[0];

describe('mission store', () => {
  it('loads only published missions that are running now', async () => {
    const running = await dailyMission('2026-12-01');
    await db.insert(missions).values({
      id: uuidv7(),
      kind: 'event',
      publishStatus: 'draft',
      title: { vi: 'Nháp' },
      description: { vi: 'Nháp' },
      startsAt: running.startsAt,
      endsAt: running.endsAt,
      definition: running.definition,
      mapVersion: '0.3.0',
    });
    const broken: string[] = [];
    await db.insert(missions).values({
      id: uuidv7(),
      kind: 'event',
      publishStatus: 'published',
      title: { vi: 'Hỏng' },
      description: { vi: 'Hỏng' },
      startsAt: running.startsAt,
      endsAt: running.endsAt,
      definition: { objectives: [] },
      mapVersion: '0.3.0',
    });
    const active = await loadActiveMissions(db, morningOf('2026-12-01'), (id) => broken.push(id));
    expect(active.map((mission) => mission.id)).toEqual([running.id]);
    expect(broken).toHaveLength(1);
    expect(await loadActiveMissions(db, morningOf('2026-12-02'))).toEqual([]);
  });

  it('keeps progress, and never changes it once complete', async () => {
    const mission = await dailyMission('2026-12-03');
    const userId = await newUser();
    const startedAt = morningOf('2026-12-03');
    await saveProgress(db, {
      missionId: mission.id,
      userId,
      progress: { o1: { current: 0, done: false } },
      startedAt,
    });
    await saveProgress(db, { missionId: mission.id, userId, progress: done, startedAt });
    expect((await loadProgress(db, mission.id, userId))?.progress).toEqual(done);

    await completeMission(db, {
      mission,
      userId,
      progress: done,
      startedAt,
      completedAt: new Date(startedAt.getTime() + 60_000),
    });
    await saveProgress(db, { missionId: mission.id, userId, progress: {}, startedAt });
    const stored = await loadProgress(db, mission.id, userId);
    expect(stored?.progress).toEqual(done);
    expect(stored?.completedAt).not.toBeNull();
  });
});

describe('rewards', () => {
  it('are granted exactly once, even when the completion arrives twice at the same time', async () => {
    const mission = await dailyMission('2026-12-07');
    const userId = await newUser();
    const startedAt = morningOf('2026-12-07');
    const completedAt = new Date(startedAt.getTime() + 5 * 60_000);
    const results = await Promise.all([
      completeMission(db, { mission, userId, progress: done, startedAt, completedAt }),
      completeMission(db, { mission, userId, progress: done, startedAt, completedAt }),
    ]);
    expect(results.map((result) => result.granted).sort()).toEqual([false, true]);
    const again = await completeMission(db, {
      mission,
      userId,
      progress: done,
      startedAt,
      completedAt,
    });
    expect(again.granted).toBe(false);

    const ledger = await db.select().from(walletLedger).where(eq(walletLedger.userId, userId));
    expect(ledger.map((row) => [row.currency, row.delta]).sort()).toEqual([
      ['points', 100],
      ['xp', 50],
    ]);
    expect(await stats(userId)).toMatchObject({
      points: 100,
      xp: 50,
      level: 1,
      missionsCompleted: 1,
      streakCurrent: 1,
      lastDailyDate: '2026-12-07',
    });
    expect(results.find((result) => result.granted)?.durationMs).toBe(5 * 60_000);
  });

  it('multiply in golden hours', async () => {
    const mission = await dailyMission('2026-12-08');
    const userId = await newUser();
    // 12:30 in Vietnam.
    const completedAt = new Date(vnDayBounds('2026-12-08').start.getTime() + 12.5 * 3_600_000);
    const result = await completeMission(db, {
      mission,
      userId,
      progress: done,
      startedAt: morningOf('2026-12-08'),
      completedAt,
    });
    expect(result).toMatchObject({ granted: true, points: 150, xp: 75, multiplier: 1.5 });
  });
});

describe('streaks', () => {
  it('grow over weekends and holidays, pay a bonus at three, and break on a missed workday', async () => {
    // Fri 11, Mon 14 (holiday), Tue 15, Wed 16, Thu 17 December 2026; the weekend has missions too.
    const days = [
      '2026-12-11',
      '2026-12-12',
      '2026-12-13',
      '2026-12-14',
      '2026-12-15',
      '2026-12-16',
      '2026-12-17',
      '2026-12-18',
    ];
    const byDay = new Map<string, Awaited<ReturnType<typeof dailyMission>>>();
    for (const day of days) byDay.set(day, await dailyMission(day));
    await db.insert(settings).values({ key: 'holidays', value: ['2026-12-14'] });
    const userId = await newUser();
    const complete = (day: string) =>
      completeMission(db, {
        mission: byDay.get(day) as Awaited<ReturnType<typeof dailyMission>>,
        userId,
        progress: done,
        startedAt: morningOf(day),
        completedAt: new Date(morningOf(day).getTime() + 60_000),
      });

    expect((await complete('2026-12-11')).streak).toBe(1);
    // Weekend and the Monday holiday skipped: still a streak.
    expect((await complete('2026-12-15')).streak).toBe(2);
    const third = await complete('2026-12-16');
    expect(third).toMatchObject({ streak: 3, streakBonus: 20, points: 120 });
    // Thursday 17 missed: Friday starts over.
    expect((await complete('2026-12-18')).streak).toBe(1);
    expect(await stats(userId)).toMatchObject({
      streakCurrent: 1,
      streakBest: 3,
      missionsCompleted: 4,
    });
  });
});

describe('closing a mission', () => {
  it('ranks finishers, pays rank and community rewards once, and keeps the board', async () => {
    const mission = await dailyMission('2026-12-20', {
      rankRewards: [{ fromRank: 1, toRank: 1, rewards: [{ type: 'points', amount: 30 }] }],
      communityGoal: {
        metric: 'completions',
        target: 2,
        rewards: [{ type: 'points', amount: 10 }],
      },
    });
    const [fast, slow, unfinished] = [
      await newUser('Nhanh'),
      await newUser('Chậm'),
      await newUser('Dở Dang'),
    ];
    const start = morningOf('2026-12-20');
    await completeMission(db, {
      mission,
      userId: slow,
      progress: done,
      startedAt: start,
      completedAt: new Date(start.getTime() + 5 * 60_000),
    });
    await completeMission(db, {
      mission,
      userId: fast,
      progress: done,
      startedAt: start,
      completedAt: new Date(start.getTime() + 3 * 60_000),
    });
    await db
      .insert(missionProgress)
      .values({ missionId: mission.id, userId: unfinished, state: {}, startedAt: start });

    // Not before the end, plus a minute.
    // Other tests' missions end earlier and close too; only this one matters here.
    const mine = (results: Awaited<ReturnType<typeof finalizeEndedMissions>>) =>
      results.filter((result) => result.missionId === mission.id);
    expect(
      mine(await finalizeEndedMissions(db, new Date(mission.endsAt.getTime() + 30_000))),
    ).toEqual([]);
    const after = new Date(mission.endsAt.getTime() + 120_000);
    const [result] = mine(await finalizeEndedMissions(db, after));
    expect(result).toMatchObject({
      missionId: mission.id,
      participants: 3,
      completions: 2,
      medianDurationMs: 4 * 60_000,
      rankRewarded: 1,
      communityReached: true,
    });
    expect(mine(await finalizeEndedMissions(db, after))).toEqual([]);

    const ranks = await db
      .select({ userId: missionProgress.userId, rank: missionProgress.rank })
      .from(missionProgress)
      .where(eq(missionProgress.missionId, mission.id));
    expect(Object.fromEntries(ranks.map((r) => [r.userId, r.rank]))).toEqual({
      [fast]: 1,
      [slow]: 2,
      [unfinished]: null,
    });
    // 100 for the mission, 30 for first place, 10 for the community goal.
    expect((await stats(fast))?.points).toBe(140);
    expect((await stats(slow))?.points).toBe(110);
    const [summary] = await db
      .select()
      .from(missionStats)
      .where(eq(missionStats.missionId, mission.id));
    expect(summary?.completions).toBe(2);
    const snapshot = await db
      .select()
      .from(leaderboardSnapshots)
      .where(eq(leaderboardSnapshots.board, `mission:${mission.id}`));
    expect(snapshot.map((row) => [row.rank, row.subjectId])).toEqual([
      [1, fast],
      [2, slow],
    ]);
    expect(
      (await missionLeaderboard(db, { missionId: mission.id, me: slow })).rows.map(
        (row) => row.name,
      ),
    ).toEqual(['Nhanh', 'Chậm']);
  });
});

describe('leaderboards', () => {
  it('rank people by points in a period, with my own line when I am further down', async () => {
    const start = new Date('2030-01-07T00:00:00Z');
    const ids: string[] = [];
    for (const [i, points] of [50, 30, 30, 10].entries()) {
      const id = await newUser(`Hạng ${i}`);
      ids.push(id);
      await db.insert(walletLedger).values({
        id: uuidv7(),
        userId: id,
        currency: 'points',
        delta: points,
        reason: 'test',
        refType: 'test',
        refId: 'a',
        createdAt: new Date(start.getTime() + 1000),
      });
    }
    const { rows, me } = await pointsLeaderboard(db, { start, limit: 2, me: ids[3] });
    expect(rows.map((row) => [row.rank, row.score])).toEqual([
      [1, 50],
      [2, 30],
      [2, 30],
    ]);
    expect(me).toMatchObject({ id: ids[3], rank: 4, score: 10 });
    // Nothing before the period counts.
    expect((await pointsLeaderboard(db, { start: new Date('2031-01-01T00:00:00Z') })).rows).toEqual(
      [],
    );
  });

  it('rank departments by average points of the people who scored', async () => {
    const start = new Date('2032-01-05T00:00:00Z');
    const [big, small] = [uuidv7(), uuidv7()];
    await db.insert(departments).values([
      { id: big, name: 'Phòng Lớn' },
      { id: small, name: 'Phòng Nhỏ' },
    ]);
    for (const [department, points] of [
      [big, 10],
      [big, 20],
      [big, 30],
      [small, 25],
    ] as const) {
      const id = await newUser();
      await db.update(users).set({ departmentId: department }).where(eq(users.id, id));
      await db.insert(walletLedger).values({
        id: uuidv7(),
        userId: id,
        currency: 'points',
        delta: points,
        reason: 'test',
        refType: 'test',
        refId: 'b',
        createdAt: new Date(start.getTime() + 1000),
      });
    }
    const rows = await departmentLeaderboard(db, { start });
    expect(rows.map((row) => [row.name, row.score, row.members])).toEqual([
      ['Phòng Nhỏ', 25, 1],
      ['Phòng Lớn', 20, 3],
    ]);
  });
});
