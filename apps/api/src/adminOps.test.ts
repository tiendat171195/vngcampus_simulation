import { activeAnnouncements, autofillTomorrow, checkMissionForPublish } from '@campus/core';
import { auditLogs, type Db, missions, missionTemplates, users, uuidv7 } from '@campus/db';
import { campusIndex } from '@campus/map-data/campus';
import {
  type AnnouncementDto,
  DEFAULT_SETTINGS,
  type MissionDefinitionInput,
  type OperationalSettings,
  type TemplateDto,
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
let admin: Record<string, string>;

async function staff(role: 'editor' | 'moderator' | 'admin') {
  const [user] = await db
    .insert(users)
    .values({ id: uuidv7(), displayName: `${role} test`, isGuest: false, role })
    .returning();
  if (!user) throw new Error('no user');
  return { authorization: `Bearer ${await deps.keys.sign(claimsFor(user, 's'))}` };
}

beforeAll(async () => {
  ({ db, close } = await freshDatabase());
  ({ app, deps } = await testApp(db));
  editor = await staff('editor');
  moderator = await staff('moderator');
  admin = await staff('admin');
});
afterAll(async () => {
  await app.close();
  await close();
});

const call = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
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

/** The documented example without its quiz, so it needs no question bank. */
const noQuiz: MissionDefinitionInput = {
  ...exampleMission,
  objectives: exampleMission.objectives.filter((objective) => objective.type !== 'quiz'),
};
/** 23:05 on a Vietnam day. */
const lateOn = (day: string) => new Date(`${day}T23:05:00+07:00`);

describe('mission templates', () => {
  it('are saved from a definition or a mission, switched off and removed by editors only', async () => {
    const created = await call('POST', '/admin/templates', editor, {
      name: 'Chào tuần mới',
      tags: ['thu-hai'],
      definition: noQuiz,
    });
    expect(created.statusCode).toBe(201);
    const template = created.json() as TemplateDto;
    expect(template).toMatchObject({ active: true, objectives: 3, points: 100, broken: false });

    const mission = await call('POST', '/admin/missions', editor, { definition: noQuiz });
    const fromMission = await call('POST', '/admin/templates', editor, {
      name: 'Từ nhiệm vụ',
      missionId: (mission.json() as { id: string }).id,
    });
    expect(fromMission.statusCode).toBe(201);
    expect(
      (await call('POST', '/admin/templates', editor, { name: 'Hỏng', definition: { kind: 'x' } }))
        .statusCode,
    ).toBe(400);
    expect((await call('GET', '/admin/templates', moderator)).statusCode).toBe(403);

    const off = await call('PATCH', `/admin/templates/${template.id}`, editor, { active: false });
    expect((off.json() as TemplateDto).active).toBe(false);
    const detail = await call('GET', `/admin/templates/${template.id}`, editor);
    expect((detail.json() as { definition: { title: unknown } }).definition.title).toEqual(
      noQuiz.title,
    );
    const removed = await call(
      'DELETE',
      `/admin/templates/${(fromMission.json() as TemplateDto).id}`,
      editor,
    );
    expect(removed.statusCode).toBe(200);
    const list = (await call('GET', '/admin/templates', editor)).json() as TemplateDto[];
    expect(list.map((t) => t.name)).toEqual(['Chào tuần mới']);
    await db.delete(missionTemplates);
    await db.delete(missions);
  });
});

describe('autofill', () => {
  it('fills an empty tomorrow from 23:00 with the least recently used template, keeping its hours', async () => {
    expect(await autofillTomorrow(db, campusIndex, lateOn('2031-05-04'))).toBeNull();
    const ids = [uuidv7(), uuidv7(), uuidv7()];
    await db.insert(missionTemplates).values([
      // Needs questions the bank does not have: skipped.
      { id: ids[0] as string, name: 'Có quiz', definition: exampleMission },
      { id: ids[1] as string, name: 'Mới dùng', definition: noQuiz, lastUsedOn: '2031-04-30' },
      { id: ids[2] as string, name: 'Lâu rồi', definition: noQuiz, lastUsedOn: '2031-01-01' },
    ]);

    expect(
      await autofillTomorrow(db, campusIndex, new Date('2031-05-04T22:30:00+07:00')),
    ).toBeNull();
    const filled = await autofillTomorrow(db, campusIndex, lateOn('2031-05-04'));
    expect(filled).not.toBeNull();
    const [mission] = await db
      .select()
      .from(missions)
      .where(eq(missions.id, filled as string));
    expect(mission).toMatchObject({
      autoFilled: true,
      publishStatus: 'published',
      dailyDate: '2031-05-05',
    });
    expect(mission?.startsAt.toISOString()).toBe('2031-05-04T17:00:00.000Z');
    expect(mission?.endsAt.toISOString()).toBe('2031-05-05T16:59:59.000Z');
    const [used] = await db
      .select()
      .from(missionTemplates)
      .where(eq(missionTemplates.id, ids[2] as string));
    expect(used?.lastUsedOn).toBe('2031-05-05');

    // Planned already; the next night every usable template was used within 14 days.
    expect(await autofillTomorrow(db, campusIndex, lateOn('2031-05-04'))).toBeNull();
    expect(await autofillTomorrow(db, campusIndex, lateOn('2031-05-05'))).toBeNull();

    // Switched off in the settings: nothing, even when asked directly.
    await call('PUT', '/admin/settings', admin, { autofill: { enabled: false, avoidDays: 0 } });
    expect(
      (await call('POST', '/admin/missions/autofill', editor)).json() as { missionId: null },
    ).toEqual({ missionId: null });
    await call('PUT', '/admin/settings', admin, { autofill: { enabled: true, avoidDays: 0 } });
    expect(await autofillTomorrow(db, campusIndex, lateOn('2031-05-05'))).not.toBeNull();
  });
});

describe('announcements', () => {
  it('go on air now or later, can be cancelled, and only admins cover the whole screen', async () => {
    const now = await call('POST', '/admin/announcements', editor, {
      level: 'popup',
      text: { vi: 'Chiều nay 16:00 có tiệc ở sân thượng!' },
      minutes: 60,
    });
    expect(now.statusCode).toBe(201);
    expect((now.json() as AnnouncementDto).state).toBe('live');
    const later = await call('POST', '/admin/announcements', editor, {
      level: 'ticker',
      text: { vi: 'Ngày mai bảo trì lúc 7:00' },
      startsAt: new Date(Date.now() + 3_600_000).toISOString(),
      minutes: 30,
    });
    expect((later.json() as AnnouncementDto).state).toBe('scheduled');
    expect(
      (
        await call('POST', '/admin/announcements', editor, {
          level: 'fullscreen',
          text: { vi: 'Bảo trì' },
          minutes: 5,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call('POST', '/admin/announcements', admin, {
          level: 'fullscreen',
          text: { vi: 'Bảo trì' },
          minutes: 5,
        })
      ).statusCode,
    ).toBe(201);
    expect((await call('GET', '/admin/announcements', moderator)).statusCode).toBe(403);

    const onAir = await activeAnnouncements(db);
    expect(onAir.map((a) => a.level).sort()).toEqual(['fullscreen', 'popup']);
    const cancelled = await call(
      'POST',
      `/admin/announcements/${(now.json() as AnnouncementDto).id}/cancel`,
      editor,
    );
    expect((cancelled.json() as AnnouncementDto).state).toBe('cancelled');
    expect((await activeAnnouncements(db)).map((a) => a.level)).toEqual(['fullscreen']);
    const listed = (await call('GET', '/admin/announcements', editor)).json() as AnnouncementDto[];
    expect(listed).toHaveLength(3);
    expect(listed[0]?.createdByName).toBe('editor test');
  });
});

describe('settings', () => {
  it('are admin-only, validated, audited and used by the publish checks', async () => {
    expect((await call('GET', '/admin/settings', editor)).statusCode).toBe(403);
    const before = (await call('GET', '/admin/settings', admin)).json() as OperationalSettings;
    expect(before.chatEnabled).toBe(DEFAULT_SETTINGS.chatEnabled);
    expect((await call('PUT', '/admin/settings', admin, { rewardCap: 'nhiều' })).statusCode).toBe(
      400,
    );
    expect((await call('PUT', '/admin/settings', admin, { unknown: true })).statusCode).toBe(400);

    const saved = await call('PUT', '/admin/settings', admin, {
      chatEnabled: false,
      rewardCap: 50,
      holidays: ['2031-09-02', '2031-01-01'],
    });
    expect(saved.json()).toMatchObject({
      chatEnabled: false,
      rewardCap: 50,
      holidays: ['2031-01-01', '2031-09-02'],
    });
    const check = await checkMissionForPublish(db, noQuiz, campusIndex);
    expect(check.errors).toContain('Thưởng tối đa 150 điểm vượt hạn mức 50.');
    const entries = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'settings.update'));
    expect(entries.at(-1)?.diff).toMatchObject({ chatEnabled: { from: true, to: false } });
  });
});
