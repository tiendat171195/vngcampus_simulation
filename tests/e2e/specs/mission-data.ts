import { createDb, migrateDatabase, missions, quizQuestions, uuidv7 } from '@campus/db';
import { missionDefinitionSchema } from '@campus/shared';
import { eq } from 'drizzle-orm';

/** The e2e database, the same one the API and realtime servers of the suite use. */
const url = process.env.E2E_DATABASE_URL ?? 'postgres://campus:campus@127.0.0.1:5432/campus_e2e';
export const E2E_TITLE = 'E2E: Một ngày ở campus';

/** Questions with known answers: the first choice is right. */
const questions = [
  {
    id: 'e2e-q1',
    text: { vi: 'Câu hỏi thử số một?' },
    choices: [{ vi: 'Đúng' }, { vi: 'Sai' }],
    correctIndex: 0,
    tags: ['e2e'],
  },
  {
    id: 'e2e-q2',
    text: { vi: 'Câu hỏi thử số hai?' },
    choices: [{ vi: 'Đúng' }, { vi: 'Sai' }],
    correctIndex: 0,
    tags: ['e2e'],
  },
];

/**
 * Publishes a short event mission for the mission tests, after archiving any left by an earlier
 * run. Visit the gate, wave at a colleague, pick up two items, answer one question.
 */
export async function publishE2eMission(): Promise<string> {
  const { db, close } = createDb(url, { maxConnections: 1 });
  try {
    await migrateDatabase(db);
    await db
      .update(missions)
      .set({ publishStatus: 'archived' })
      .where(eq(missions.publishStatus, 'published'));
    for (const question of questions)
      await db.insert(quizQuestions).values(question).onConflictDoNothing();
    const now = Date.now();
    const definition = missionDefinitionSchema.parse({
      kind: 'event',
      title: { vi: E2E_TITLE },
      description: { vi: 'Nhiệm vụ dùng cho test đầu-cuối.' },
      startsAt: new Date(now - 60_000).toISOString(),
      endsAt: new Date(now + 30 * 60_000).toISOString(),
      mapVersion: '0.1.0',
      objectives: [
        {
          id: 'o1',
          type: 'visit',
          title: { vi: 'Ghé cổng chính' },
          target: 1,
          params: { targets: [{ areaId: 'area.gate_main' }] },
        },
        {
          id: 'o2',
          type: 'social',
          title: { vi: 'Vẫy tay chào một đồng nghiệp' },
          target: 1,
          params: { emote: 'wave', radius: 12 },
        },
        {
          id: 'o3',
          type: 'collect',
          title: { vi: 'Nhặt 2 ly cà phê' },
          target: 2,
          params: { item: 'coffee_cup', source: { spawnSet: 'outdoor_common' } },
        },
        {
          id: 'o4',
          type: 'quiz',
          title: { vi: 'Trả lời đúng 1 câu' },
          target: 1,
          params: { at: { poiId: 'poi.kiosk.lobby' }, from: { questionIds: ['e2e-q1', 'e2e-q2'] } },
        },
      ],
      rewards: [
        { type: 'points', amount: 40 },
        { type: 'xp', amount: 20 },
      ],
    });
    const id = uuidv7();
    await db.insert(missions).values({
      id,
      kind: 'event',
      publishStatus: 'published',
      title: definition.title,
      description: definition.description,
      startsAt: new Date(definition.startsAt),
      endsAt: new Date(definition.endsAt),
      definition,
      mapVersion: definition.mapVersion,
    });
    return id;
  } finally {
    await close();
  }
}

/** Takes the mission away again so it does not show up in other runs. */
export async function archiveE2eMission(id: string): Promise<void> {
  const { db, close } = createDb(url, { maxConnections: 1 });
  try {
    await db.update(missions).set({ publishStatus: 'archived' }).where(eq(missions.id, id));
  } finally {
    await close();
  }
}
