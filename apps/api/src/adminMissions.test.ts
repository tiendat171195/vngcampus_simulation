import { type Db, missions, users, uuidv7 } from '@campus/db';
import {
  type AdminMissionDto,
  type AdminMissionSummary,
  missionDefinitionSchema,
  type PublishCheckDto,
} from '@campus/shared';
import { exampleMission } from '@campus/shared/fixtures';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppDeps } from './app';
import { parseQuestionsCsv } from './routes/adminMissions';
import { claimsFor } from './routes/users';
import { freshDatabase, testApp } from './testing';

let db: Db;
let close: () => Promise<void>;
let app: FastifyInstance;
let deps: AppDeps;
let editor: Record<string, string>;
let moderator: Record<string, string>;

async function staff(role: 'editor' | 'moderator') {
  const id = uuidv7();
  const [user] = await db
    .insert(users)
    .values({ id, displayName: role, isGuest: false, role })
    .returning();
  if (!user) throw new Error('no user');
  return { authorization: `Bearer ${await deps.keys.sign(claimsFor(user, 's'))}` };
}

beforeAll(async () => {
  ({ db, close } = await freshDatabase());
  ({ app, deps } = await testApp(db));
  editor = await staff('editor');
  moderator = await staff('moderator');
});
afterAll(async () => {
  await app.close();
  await close();
});

const call = (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
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

/** The documented example, moved to a future Vietnam day. */
const dayMission = (day: string) => ({
  ...exampleMission,
  startsAt: new Date(Date.parse(`${day}T00:00:00+07:00`)).toISOString(),
  endsAt: new Date(Date.parse(`${day}T23:59:59+07:00`)).toISOString(),
});

const CSV = `id,question,choice1,choice2,choice3,correct,explanation,tags
vh-1,"Campus nằm bên sông nào?",Sông Hồng,Sông Sài Gòn,,2,Sông Sài Gòn chảy qua Quận 7,van-hoa
vh-2,Hồ cá nuôi cá gì?,Cá Koi,Cá rô,,1,,van-hoa;campus
vh-3,Câu thiếu đáp án,Một,,,3,,van-hoa
vh-4,Câu thứ tư?,A,B,C,3,,van-hoa`;

describe('question bank', () => {
  it('imports good CSV rows and reports bad ones by line', async () => {
    expect(parseQuestionsCsv(CSV).errors).toEqual([expect.stringMatching(/^Dòng 4:/)]);
    const imported = await call('POST', '/admin/quiz/import', editor, { csv: CSV });
    expect(imported.json()).toMatchObject({ imported: 3 });
    const bank = (await call('GET', '/admin/quiz?tag=campus', editor)).json() as Array<{
      id: string;
    }>;
    expect(bank.map((q) => q.id)).toEqual(['vh-2']);
    expect((await call('GET', '/admin/quiz', moderator)).statusCode).toBe(403);
  });
});

describe('mission editor', () => {
  it('takes a draft through checks, publishing, the start and an early end', async () => {
    const created = await call('POST', '/admin/missions', editor, {
      definition: dayMission('2030-03-04'),
    });
    expect(created.statusCode).toBe(201);
    const draft = created.json() as AdminMissionDto;
    expect(draft.state).toBe('draft');

    const check = (
      await call('POST', '/admin/missions/validate', editor, {
        definition: dayMission('2030-03-04'),
        missionId: draft.id,
      })
    ).json() as PublishCheckDto;
    expect(check.errors).toEqual([]);
    const published = (
      await call('POST', `/admin/missions/${draft.id}/publish`, editor)
    ).json() as AdminMissionSummary;
    expect(published).toMatchObject({ state: 'scheduled', dailyDate: '2030-03-04' });

    // A second daily mission for the same day is refused, with the reason.
    const other = (
      await call('POST', '/admin/missions', editor, { definition: dayMission('2030-03-04') })
    ).json() as AdminMissionDto;
    const clash = await call('POST', `/admin/missions/${other.id}/publish`, editor);
    expect(clash.statusCode).toBe(400);
    expect(clash.json().error.details).toEqual([expect.stringContaining('đã có nhiệm vụ ngày')]);

    // Not started yet: it can go back to draft.
    expect(
      (await call('POST', `/admin/missions/${draft.id}/unpublish`, editor)).json(),
    ).toMatchObject({ state: 'draft' });
    await call('POST', `/admin/missions/${draft.id}/publish`, editor);

    // Running: only words and more reward may change; then it can end early.
    const startedAt = new Date(Date.now() - 60_000);
    const running = { ...dayMission('2030-03-04'), startsAt: startedAt.toISOString() };
    await db
      .update(missions)
      .set({ startsAt: startedAt, definition: missionDefinitionSchema.parse(running) })
      .where(eq(missions.id, draft.id));
    const restructured = await call('PUT', `/admin/missions/${draft.id}`, editor, {
      definition: { ...running, objectives: running.objectives.slice(0, 2) },
    });
    expect(restructured.statusCode).toBe(409);
    const reworded = await call('PUT', `/admin/missions/${draft.id}`, editor, {
      definition: {
        ...running,
        title: { vi: 'Chào tuần mới!' },
        rewards: [
          { type: 'points', amount: 150 },
          { type: 'xp', amount: 50 },
        ],
      },
    });
    expect((reworded.json() as AdminMissionDto).title.vi).toBe('Chào tuần mới!');
    expect((await call('POST', `/admin/missions/${draft.id}/unpublish`, editor)).statusCode).toBe(
      409,
    );
    expect((await call('POST', `/admin/missions/${draft.id}/end`, editor)).json()).toMatchObject({
      state: 'ended',
    });

    // A copy for the next day starts as a draft.
    const copy = (
      await call('POST', `/admin/missions/${draft.id}/duplicate`, editor, { shiftDays: 1 })
    ).json() as AdminMissionDto;
    expect(copy.state).toBe('draft');
    expect(Date.parse(copy.startsAt) - startedAt.getTime()).toBe(86_400_000);
    expect((await call('DELETE', `/admin/missions/${copy.id}`, editor)).json()).toMatchObject({
      state: 'archived',
    });
    expect((await call('GET', '/admin/missions', moderator)).statusCode).toBe(403);
  });

  it('lists what is missing before publishing', async () => {
    const broken = dayMission('2030-04-01');
    const definition = {
      ...broken,
      objectives: [
        { ...broken.objectives[0], params: { targets: [{ areaId: 'area.moon' }] } },
        broken.objectives[3],
      ],
      rewards: [{ type: 'points', amount: 5000 }],
    };
    const created = (
      await call('POST', '/admin/missions', editor, { definition })
    ).json() as AdminMissionDto;
    const refused = await call('POST', `/admin/missions/${created.id}/publish`, editor);
    expect(refused.statusCode).toBe(400);
    const details = refused.json().error.details as string[];
    expect(details).toEqual(
      expect.arrayContaining([
        expect.stringContaining('area.moon'),
        expect.stringContaining('vượt hạn mức'),
      ]),
    );
    expect(
      (await call('POST', '/admin/missions', editor, { definition: { title: 'x' } })).statusCode,
    ).toBe(400);
  });
});
