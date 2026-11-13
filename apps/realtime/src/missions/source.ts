import {
  type ActiveMission,
  type CompletionResult,
  completeMission,
  loadActiveMissions,
  loadProgress,
  type Progress,
  type QuestionPicker,
  type StoredProgress,
  saveProgress,
  seededOrder,
} from '@campus/core';
import { type Db, missions, quizQuestions } from '@campus/db';
import { missionDefinitionSchema, type QuizQuestion, quizQuestionSchema } from '@campus/shared';
import { eq } from 'drizzle-orm';

/** The question bank, in memory: small, and read on every answer. */
export interface QuestionBank extends QuestionPicker {
  get(id: string): QuizQuestion | undefined;
}

export function bankOf(questions: readonly QuizQuestion[]): QuestionBank {
  const byId = new Map(questions.map((question) => [question.id, question]));
  return {
    get: (id) => byId.get(id),
    pick(from, seed) {
      if ('questionIds' in from) return from.questionIds.filter((id) => byId.has(id));
      const pool = questions.filter((question) =>
        question.tags.some((tag) => from.tags.includes(tag)),
      );
      return seededOrder(pool, seed)
        .slice(0, from.pick)
        .map((question) => question.id);
    },
  };
}

/** Where missions and progress live: PostgreSQL in production, memory in tests. */
export interface MissionSource {
  loadActive(now: Date): Promise<ActiveMission[]>;
  /** Any mission by id, drafts included, for previews. */
  loadMission(id: string): Promise<ActiveMission | null>;
  loadQuestions(): Promise<QuizQuestion[]>;
  loadProgress(missionId: string, userId: string): Promise<StoredProgress | null>;
  saveProgress(input: {
    missionId: string;
    userId: string;
    progress: Progress;
    startedAt: Date;
  }): Promise<void>;
  complete(input: {
    mission: ActiveMission;
    userId: string;
    progress: Progress;
    startedAt: Date;
  }): Promise<CompletionResult>;
}

export function dbSource(db: Db, log?: (message: string) => void): MissionSource {
  return {
    loadActive: (now) =>
      loadActiveMissions(db, now, (id, problem) => log?.(`mission ${id} skipped: ${problem}`)),
    async loadMission(id) {
      const [row] = await db.select().from(missions).where(eq(missions.id, id));
      const parsed = missionDefinitionSchema.safeParse(row?.definition);
      if (!row || !parsed.success) return null;
      return {
        id: row.id,
        kind: row.kind,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        definition: parsed.data,
      };
    },
    async loadQuestions() {
      const rows = await db.select().from(quizQuestions).where(eq(quizQuestions.active, true));
      return rows.flatMap((row) => {
        const parsed = quizQuestionSchema.safeParse({
          ...row,
          explanation: row.explanation ?? undefined,
        });
        return parsed.success ? [parsed.data] : [];
      });
    },
    loadProgress: (missionId, userId) => loadProgress(db, missionId, userId),
    saveProgress: (input) => saveProgress(db, input),
    complete: (input) => completeMission(db, input),
  };
}

/** Missions and progress kept in memory, for tests and for trying the runtime without a database. */
export function memorySource(missions: ActiveMission[], questions: QuizQuestion[] = []) {
  const progress = new Map<string, StoredProgress>();
  const key = (missionId: string, userId: string) => `${missionId}/${userId}`;
  const source: MissionSource & {
    progress: typeof progress;
    missions: ActiveMission[];
    fail: boolean;
  } = {
    progress,
    missions,
    /** Set to make every write fail, as when the database is down. */
    fail: false,
    loadActive: async (now) =>
      source.missions.filter((mission) => mission.startsAt <= now && now < mission.endsAt),
    loadMission: async (id) => source.missions.find((mission) => mission.id === id) ?? null,
    loadQuestions: async () => questions,
    loadProgress: async (missionId, userId) => progress.get(key(missionId, userId)) ?? null,
    async saveProgress(input) {
      if (source.fail) throw new Error('database unavailable');
      const stored = progress.get(key(input.missionId, input.userId));
      if (stored?.completedAt) return;
      progress.set(key(input.missionId, input.userId), {
        progress: input.progress,
        startedAt: input.startedAt,
        completedAt: null,
      });
    },
    async complete(input) {
      if (source.fail) throw new Error('database unavailable');
      const stored = progress.get(key(input.mission.id, input.userId));
      const completedAt = new Date();
      const durationMs = completedAt.getTime() - input.startedAt.getTime();
      const granted = !stored?.completedAt;
      if (granted)
        progress.set(key(input.mission.id, input.userId), {
          progress: input.progress,
          startedAt: input.startedAt,
          completedAt,
        });
      return {
        granted,
        points: granted ? 100 : 0,
        xp: granted ? 50 : 0,
        multiplier: 1,
        streak: input.mission.kind === 'daily' ? 1 : null,
        streakBonus: 0,
        level: 1,
        durationMs,
      };
    },
  };
  return source;
}
