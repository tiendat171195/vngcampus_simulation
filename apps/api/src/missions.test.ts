import {
  completeMission,
  loadActiveMissions,
  loadProgress,
  type Progress,
  saveProgress,
  vnDayBounds,
} from '@campus/core';
import { type Db, missions, settings, userStats, users, uuidv7, walletLedger } from '@campus/db';
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
      mapVersion: '0.1.0',
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
      mapVersion: '0.1.0',
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
