import {
  addActivity,
  addCounts,
  createReport,
  dashboardOverview,
  missionResults,
  pruneActivity,
  pruneReportContext,
  userHash,
  vnDateOf,
} from '@campus/core';
import {
  activityDays,
  type Db,
  missionProgress,
  missions,
  reports,
  sanctions,
  users,
  uuidv7,
} from '@campus/db';
import {
  type DashboardDto,
  type MissionResultsDto,
  missionDefinitionSchema,
  type ReportDto,
} from '@campus/shared';
import { exampleMission } from '@campus/shared/fixtures';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppDeps } from './app';
import { claimsFor } from './routes/users';
import { freshDatabase, testApp } from './testing';

let db: Db;
let close: () => Promise<void>;
let app: FastifyInstance;
let deps: AppDeps;
let editor: Record<string, string>;
let moderator: Record<string, string>;
let player: Record<string, string>;

async function person(name: string, role: 'player' | 'editor' | 'moderator' = 'player') {
  const [user] = await db
    .insert(users)
    .values({ id: uuidv7(), displayName: name, isGuest: false, role })
    .returning();
  if (!user) throw new Error('no user');
  return {
    id: user.id,
    auth: { authorization: `Bearer ${await deps.keys.sign(claimsFor(user, 's'))}` },
  };
}

beforeAll(async () => {
  ({ db, close } = await freshDatabase());
  ({ app, deps } = await testApp(db));
  editor = (await person('Biên Tập', 'editor')).auth;
  moderator = (await person('Kiểm Duyệt', 'moderator')).auth;
  player = (await person('Người Chơi')).auth;
});
afterAll(async () => {
  await app.close();
  await close();
});

const call = (
  method: 'GET' | 'POST',
  url: string,
  auth: Record<string, string>,
  payload?: object,
) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: auth,
    ...(payload ? { payload } : {}),
  }) as unknown as Promise<LightMyRequestResponse>;

const line = (name: string, text: string, byTarget: boolean) => ({
  at: new Date().toISOString(),
  name,
  text,
  byTarget,
  byReporter: !byTarget,
});

describe('reports', () => {
  it('queue up with the chat the reporter saw, and a decision closes every open one', async () => {
    const rude = await person('Nói Bậy');
    const a = await person('Người Báo A');
    const b = await person('Người Báo B');
    expect(
      await createReport(db, {
        reporterId: a.id,
        targetUserId: a.id,
        reason: 'spam',
        note: '',
        context: [],
      }),
    ).toBeNull();
    const first = await createReport(db, {
      reporterId: a.id,
      targetUserId: rude.id,
      reason: 'harassment',
      note: '',
      context: [line('Nói Bậy', 'đồ ***', true)],
    });
    expect(first?.created).toBe(true);
    // Pressing again only refreshes the open report.
    const again = await createReport(db, {
      reporterId: a.id,
      targetUserId: rude.id,
      reason: 'harassment',
      note: 'lần hai',
      context: [line('Nói Bậy', 'đồ ***', true), line('Người Báo A', 'thôi đi', false)],
    });
    expect(again).toEqual({ id: first?.id, created: false });
    await createReport(db, {
      reporterId: b.id,
      targetUserId: rude.id,
      reason: 'spam',
      note: '',
      context: [],
    });

    expect((await call('GET', '/admin/reports', editor)).statusCode).toBe(403);
    const queue = (await call('GET', '/admin/reports', moderator)).json() as ReportDto[];
    expect(queue).toHaveLength(2);
    expect(queue[0]).toMatchObject({
      reason: 'harassment',
      note: 'lần hai',
      reporter: { name: 'Người Báo A' },
      target: { name: 'Nói Bậy', status: 'active' },
      targetReports: 1,
    });
    expect(queue[0]?.context.map((l) => l.text)).toEqual(['đồ ***', 'thôi đi']);

    const muted = await call('POST', `/admin/reports/${first?.id}/resolve`, moderator, {
      action: 'mute',
      hours: 24,
      note: 'Lời lẽ xúc phạm',
    });
    expect(muted.json()).toEqual({ status: 'muted', closed: 2 });
    const [target] = await db.select().from(users).where(eq(users.id, rude.id));
    expect(target?.status).toBe('muted');
    expect((await call('GET', '/admin/reports', moderator)).json()).toEqual([]);
    const handled = (
      await call('GET', '/admin/reports?status=handled', moderator)
    ).json() as ReportDto[];
    expect(handled.map((r) => r.status)).toEqual(['muted', 'muted']);
    expect(handled[0]).toMatchObject({
      handledByName: 'Kiểm Duyệt',
      resolution: 'Lời lẽ xúc phạm',
    });
    expect(
      (await call('POST', `/admin/reports/${first?.id}/resolve`, moderator, { action: 'dismiss' }))
        .statusCode,
    ).toBe(409);
  });

  it('warn without restricting, and dismiss only the one report', async () => {
    const target = await person('Hơi Quá');
    const a = await person('Người Báo C');
    const b = await person('Người Báo D');
    const one = await createReport(db, {
      reporterId: a.id,
      targetUserId: target.id,
      reason: 'other',
      note: '',
      context: [],
    });
    const two = await createReport(db, {
      reporterId: b.id,
      targetUserId: target.id,
      reason: 'spam',
      note: '',
      context: [],
    });
    expect(
      (
        await call('POST', `/admin/reports/${one?.id}/resolve`, moderator, { action: 'dismiss' })
      ).json(),
    ).toEqual({ status: 'dismissed', closed: 1 });
    expect(
      (
        await call('POST', `/admin/reports/${two?.id}/resolve`, moderator, { action: 'warn' })
      ).json(),
    ).toEqual({ status: 'warned', closed: 1 });
    const [user] = await db.select().from(users).where(eq(users.id, target.id));
    expect(user?.status).toBe('active');
    const given = await db.select().from(sanctions).where(eq(sanctions.userId, target.id));
    expect(given.map((s) => s.type)).toEqual(['warn']);
    expect(given[0]?.endsAt?.getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);
  });

  it('lose their chat 180 days after the decision, keeping the decision', async () => {
    const [handled] = await db.select().from(reports).where(eq(reports.status, 'muted'));
    expect(await pruneReportContext(db, new Date(Date.now() + 179 * 86_400_000))).toBe(0);
    expect(await pruneReportContext(db, new Date(Date.now() + 181 * 86_400_000))).toBeGreaterThan(
      0,
    );
    const [after] = await db
      .select()
      .from(reports)
      .where(eq(reports.id, handled?.id as string));
    expect(after).toMatchObject({ context: [], status: 'muted' });
  });
});

describe('analytics', () => {
  it('counts what the game reports into buckets, for signed-in players only', async () => {
    const events = {
      events: [
        { name: 'world_loaded', ms: 3200, firstVisit: true },
        { name: 'world_loaded', ms: 900, firstVisit: false },
        { name: 'perf_sample', fps: 58, device: 'desktop', quality: 'high' },
        { name: 'perf_sample', fps: 24, device: 'mobile', quality: 'low' },
        { name: 'client_error', code: 'WebGLContextLost' },
      ],
    };
    expect((await call('POST', '/analytics', {}, events)).statusCode).toBe(401);
    expect(
      (await call('POST', '/analytics', player, { events: [{ name: 'chat_log', text: 'hi' }] }))
        .statusCode,
    ).toBe(400);
    expect((await call('POST', '/analytics', player, events)).statusCode).toBe(204);
    const overview = (await call('GET', '/admin/stats/overview', editor)).json() as DashboardDto;
    expect(overview.tech).toEqual({
      worldLoad: { '2-5s': 1, '<2s': 1 },
      fps: { desktop: { '55+': 1 }, mobile: { '20-30': 1 } },
      errors: 1,
    });
  });
});

describe('dashboard', () => {
  it('shows today in numbers, the week with who came back, missions and alerts', async () => {
    const now = new Date();
    const today = vnDateOf(now);
    const yesterday = vnDateOf(new Date(now.getTime() - 86_400_000));
    const hash = (id: string) => userHash('salt', id);
    await addActivity(db, yesterday, ['a', 'b', 'c'].map(hash));
    await addActivity(db, today, ['a', 'b', 'd'].map(hash));
    await addCounts(db, today, [
      { metric: 'session_start', dimension: 'desktop', value: 3 },
      { metric: 'session_start', dimension: 'mobile', value: 1 },
      { metric: 'session_length', dimension: '<5m', value: 1 },
      { metric: 'session_length', dimension: '15-30m', value: 2 },
      { metric: 'chat_sent', value: 7 },
      { metric: 'emote_used', value: 12 },
    ]);
    // A mission running now, with two players: one done.
    const definition = missionDefinitionSchema.parse({
      ...exampleMission,
      kind: 'event',
      startsAt: new Date(now.getTime() - 3_600_000).toISOString(),
      endsAt: new Date(now.getTime() + 3_600_000).toISOString(),
    });
    const missionId = uuidv7();
    await db.insert(missions).values({
      id: missionId,
      kind: 'event',
      publishStatus: 'published',
      title: definition.title,
      description: definition.description,
      startsAt: new Date(definition.startsAt),
      endsAt: new Date(definition.endsAt),
      definition,
      mapVersion: definition.mapVersion,
    });
    const p1 = await person('Xong Rồi');
    const p2 = await person('Đang Làm');
    const done = { current: 1, done: true };
    await db.insert(missionProgress).values([
      {
        missionId,
        userId: p1.id,
        state: { o1: done, o2: done, o3: done, o4: done },
        startedAt: new Date(now.getTime() - 600_000),
        completedAt: new Date(now.getTime() - 60_000),
        durationMs: 540_000,
      },
      {
        missionId,
        userId: p2.id,
        state: { o1: done, o2: { current: 2, done: false } },
        startedAt: new Date(now.getTime() - 300_000),
      },
    ]);

    const overview = await dashboardOverview(db, now, { canModerate: false });
    expect(overview.today).toMatchObject({
      activeUsers: 3,
      sessions: { desktop: 3, mobile: 1 },
      medianSession: '15-30m',
      chats: 7,
      emotes: 12,
    });
    expect(overview.today.newUsers).toBeGreaterThanOrEqual(10);
    expect(overview.days.at(-2)).toMatchObject({
      date: yesterday,
      activeUsers: 3,
      returnedNextDay: 2,
    });
    expect(overview.days.at(-1)?.returnedNextDay).toBeNull();
    expect(overview.missions).toEqual([
      expect.objectContaining({
        id: missionId,
        participants: 2,
        completions: 1,
        medianDurationMs: 540_000,
      }),
    ]);
    expect(overview.alerts.map((a) => a.text)).toEqual(
      expect.arrayContaining([
        'Hôm nay không có nhiệm vụ ngày.',
        expect.stringMatching(/^Ngày mai .* chưa có nhiệm vụ ngày/),
      ]),
    );
    expect(overview.alerts.some((a) => a.link === '/reports')).toBe(false);

    const results = (
      await call('GET', `/admin/missions/${missionId}/stats`, moderator)
    ).json() as MissionResultsDto;
    expect(results).toMatchObject({ participants: 2, completions: 1, medianDurationMs: 540_000 });
    expect(results.objectives.map((o) => o.done)).toEqual([2, 1, 1, 1]);
    expect(results.byHour.reduce((sum, h) => sum + h.completions, 0)).toBe(1);
    expect(results.top.map((row) => row.name)).toEqual(['Xong Rồi']);
    expect(results.community).toEqual({ target: 300, completions: 1, reached: false });
    expect(await missionResults(db, uuidv7())).toBeNull();
    expect((await call('GET', `/admin/missions/${uuidv7()}/stats`, editor)).statusCode).toBe(404);

    // Who was around is forgotten after 90 days.
    expect(await pruneActivity(db, new Date(now.getTime() + 92 * 86_400_000))).toBe(6);
    expect(await db.select().from(activityDays)).toEqual([]);
  });
});
