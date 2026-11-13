import { z } from 'zod';
import { EMOTES, type EmoteName } from './protocol';

/**
 * Missions are data (docs/06-missions.md §3): a definition made of objectives of known types,
 * validated here once and used by the API, the realtime server, the admin and the client.
 */

export const localizedTextSchema = z.object({
  vi: z.string().trim().min(1).max(200),
  en: z.string().trim().max(200).optional(),
});
export type LocalizedText = z.infer<typeof localizedTextSchema>;

export const MISSION_KINDS = ['daily', 'weekly', 'event', 'onboarding'] as const;
export type MissionKind = (typeof MISSION_KINDS)[number];

export const rewardSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('points'), amount: z.number().int().min(1).max(100_000) }),
  z.object({ type: z.literal('xp'), amount: z.number().int().min(1).max(100_000) }),
  z.object({ type: z.literal('item'), itemId: z.string().min(1).max(64) }),
  z.object({ type: z.literal('badge'), badgeId: z.string().min(1).max(64) }),
]);
export type Reward = z.infer<typeof rewardSchema>;

const mapId = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}\\.[a-z0-9_.-]+$`), `phải là id dạng ${prefix}.…`);

// ---------- objective parameters, one schema per type ----------

export const visitParamsSchema = z.object({
  targets: z
    .array(
      z.union([
        z.object({ areaId: mapId('area') }).strict(),
        z.object({ poiId: mapId('poi'), radius: z.number().min(1).max(30).default(3) }).strict(),
      ]),
    )
    .min(1)
    .max(20),
  /** `all`: every target counts once; `any`: one of them is enough. */
  mode: z.enum(['all', 'any']).default('all'),
  /** Seconds to stay inside before it counts. */
  dwellSec: z.number().int().min(1).max(600).optional(),
});

export const collectParamsSchema = z.object({
  /** Kind of thing to pick up; the client chooses how it looks. */
  item: z.string().regex(/^[a-z0-9_]{1,40}$/),
  /** Where the items appear: a spawn set of the map. */
  source: z.object({ spawnSet: z.string().min(1).max(40) }).strict(),
  /** `perPlayer`: everyone has their own set; `shared`: first come, first served. */
  scope: z.enum(['perPlayer', 'shared']).default('perPlayer'),
  /** Shared items come back after this long. */
  respawnSec: z.number().int().min(5).max(3600).optional(),
});

export const quizParamsSchema = z.object({
  at: z.object({ poiId: mapId('poi') }).strict(),
  from: z.union([
    z.object({ questionIds: z.array(z.string().min(1).max(64)).min(1).max(50) }).strict(),
    z
      .object({
        tags: z.array(z.string().min(1).max(40)).min(1).max(10),
        pick: z.number().int().min(1).max(20),
      })
      .strict(),
  ]),
  /** Tries per question. */
  maxAttempts: z.number().int().min(1).max(10).default(2),
});

const emoteNames = Object.keys(EMOTES) as [EmoteName, ...EmoteName[]];
export const socialParamsSchema = z.object({
  emote: z.enum(emoteNames),
  /** How close the colleague must be, in metres. */
  radius: z.number().min(1).max(15).default(4),
  /** Counts only when the colleague answers with an emote (V1). */
  mutual: z.boolean().default(false),
});

export const OBJECTIVE_PARAMS = {
  visit: visitParamsSchema,
  collect: collectParamsSchema,
  quiz: quizParamsSchema,
  social: socialParamsSchema,
} as const;
export type ObjectiveType = keyof typeof OBJECTIVE_PARAMS;
export const OBJECTIVE_TYPES = Object.keys(OBJECTIVE_PARAMS) as ObjectiveType[];

const objectiveBase = {
  /** Stable within the mission: 'o1', 'o2'… */
  id: z.string().regex(/^[a-z0-9_-]{1,16}$/),
  title: localizedTextSchema,
  hint: localizedTextSchema.optional(),
  /** How many to reach. */
  target: z.number().int().min(1).max(1000),
  optional: z.boolean().default(false),
};

export const objectiveSchema = z.discriminatedUnion('type', [
  z.object({ ...objectiveBase, type: z.literal('visit'), params: visitParamsSchema }),
  z.object({ ...objectiveBase, type: z.literal('collect'), params: collectParamsSchema }),
  z.object({ ...objectiveBase, type: z.literal('quiz'), params: quizParamsSchema }),
  z.object({ ...objectiveBase, type: z.literal('social'), params: socialParamsSchema }),
]);
export type ObjectiveDefinition = z.infer<typeof objectiveSchema>;
export type ObjectiveOf<T extends ObjectiveType> = Extract<ObjectiveDefinition, { type: T }>;

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'giờ dạng HH:mm');

export const missionDefinitionSchema = z
  .object({
    kind: z.enum(MISSION_KINDS),
    title: localizedTextSchema,
    description: localizedTextSchema,
    coverImage: z.string().max(300).optional(),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    /** Version of the map the mission was written for. */
    mapVersion: z.string().min(1).max(20),
    objectiveMode: z
      .union([z.enum(['all', 'sequential']), z.object({ anyOf: z.number().int().min(1) }).strict()])
      .default('all'),
    objectives: z.array(objectiveSchema).min(1).max(10),
    rewards: z.array(rewardSchema).max(10).default([]),
    /** "Golden hours", Vietnam time: rewards multiplied for completions inside them. */
    bonusWindows: z
      .array(z.object({ from: clock, to: clock, multiplier: z.number().min(1).max(5) }))
      .max(4)
      .optional(),
    rankRewards: z
      .array(
        z.object({
          fromRank: z.number().int().min(1),
          toRank: z.number().int().min(1),
          rewards: z.array(rewardSchema).min(1).max(5),
        }),
      )
      .max(10)
      .optional(),
    communityGoal: z
      .object({
        metric: z.literal('completions'),
        target: z.number().int().min(1).max(1_000_000),
        rewards: z.array(rewardSchema).min(1).max(5),
      })
      .optional(),
    audience: z.object({ departments: z.array(z.string()).max(50).optional() }).optional(),
  })
  .superRefine((mission, ctx) => {
    if (Date.parse(mission.endsAt) <= Date.parse(mission.startsAt))
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Phải kết thúc sau khi bắt đầu.' });
    const ids = new Set<string>();
    mission.objectives.forEach((objective, i) => {
      if (ids.has(objective.id))
        ctx.addIssue({ code: 'custom', path: ['objectives', i, 'id'], message: 'Trùng id.' });
      ids.add(objective.id);
      // A target nobody can reach is a broken mission.
      const reachable =
        objective.type === 'visit'
          ? objective.params.mode === 'any'
            ? 1
            : objective.params.targets.length
          : objective.type === 'quiz'
            ? 'pick' in objective.params.from
              ? objective.params.from.pick
              : objective.params.from.questionIds.length
            : Number.POSITIVE_INFINITY;
      if (objective.target > reachable)
        ctx.addIssue({
          code: 'custom',
          path: ['objectives', i, 'target'],
          message: `Không thể đạt: tối đa ${reachable}.`,
        });
    });
    const required = mission.objectives.filter((objective) => !objective.optional).length;
    if (typeof mission.objectiveMode === 'object' && mission.objectiveMode.anyOf > required)
      ctx.addIssue({
        code: 'custom',
        path: ['objectiveMode', 'anyOf'],
        message: `Chỉ có ${required} mục tiêu bắt buộc.`,
      });
    mission.bonusWindows?.forEach((window, i) => {
      if (window.from >= window.to)
        ctx.addIssue({
          code: 'custom',
          path: ['bonusWindows', i],
          message: 'Giờ bắt đầu phải trước giờ kết thúc.',
        });
    });
    mission.rankRewards?.forEach((band, i) => {
      if (band.fromRank > band.toRank)
        ctx.addIssue({
          code: 'custom',
          path: ['rankRewards', i],
          message: 'Hạng đầu phải nhỏ hơn hạng cuối.',
        });
    });
  });
export type MissionDefinition = z.infer<typeof missionDefinitionSchema>;
export type MissionDefinitionInput = z.input<typeof missionDefinitionSchema>;

/** One person's progress on one objective. `data` is the handler's own state. */
export interface ObjectiveProgress {
  current: number;
  done: boolean;
  data?: unknown;
}

export interface MissionProgress {
  missionId: string;
  userId: string;
  objectives: Record<string, ObjectiveProgress>;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
}

/** A quiz question; `correctIndex` never leaves the server. */
export const quizQuestionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_-]{1,64}$/),
    text: localizedTextSchema,
    choices: z.array(localizedTextSchema).min(2).max(6),
    correctIndex: z.number().int().min(0),
    explanation: localizedTextSchema.optional(),
    tags: z.array(z.string().min(1).max(40)).max(10).default([]),
  })
  .refine((question) => question.correctIndex < question.choices.length, {
    path: ['correctIndex'],
    message: 'Không có lựa chọn này.',
  });
export type QuizQuestion = z.infer<typeof quizQuestionSchema>;

/** Points a reward list gives (before golden hours). */
export const sumRewardsPoints = (rewards: readonly Reward[]) =>
  rewards.reduce((total, reward) => total + (reward.type === 'points' ? reward.amount : 0), 0);
