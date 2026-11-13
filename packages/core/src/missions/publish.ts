import { type Db, missions, quizQuestions, settings } from '@campus/db';
import type { MapIndex } from '@campus/map-data';
import { type MissionDefinition, missionDefinitionSchema } from '@campus/shared';
import { and, eq, ne } from 'drizzle-orm';
import { vnDateOf } from '../time';
import { sumRewards } from './rewards';
import { missionMapProblems } from './validate';

export interface PublishCheck {
  /** Block publishing. */
  errors: string[];
  /** Worth a second look, but allowed. */
  warnings: string[];
  /** The parsed definition when the schema accepted it. */
  definition: MissionDefinition | null;
  dailyDate: string | null;
}

/** Points one mission may give at most, unless `settings.rewardCap` says otherwise. */
export const DEFAULT_REWARD_CAP = 1000;

/**
 * Everything checked before a mission may be published (docs/08 §4.3). The API runs it on every
 * validate and publish; the admin's own checks are only a convenience.
 */
export async function checkMissionForPublish(
  db: Db,
  input: unknown,
  map: MapIndex,
  options: { missionId?: string } = {},
): Promise<PublishCheck> {
  const parsed = missionDefinitionSchema.safeParse(input);
  if (!parsed.success)
    return {
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'nhiệm vụ'}: ${issue.message}`,
      ),
      warnings: [],
      definition: null,
      dailyDate: null,
    };
  const definition = parsed.data;
  const errors = missionMapProblems(definition, map);
  const warnings: string[] = [];

  // One daily mission per Vietnam day.
  let dailyDate: string | null = null;
  if (definition.kind === 'daily') {
    dailyDate = vnDateOf(new Date(definition.startsAt));
    if (vnDateOf(new Date(Date.parse(definition.endsAt) - 1)) !== dailyDate)
      errors.push('Nhiệm vụ ngày phải bắt đầu và kết thúc trong cùng một ngày (giờ Việt Nam).');
    const clash = await db
      .select({ id: missions.id, title: missions.title })
      .from(missions)
      .where(
        and(
          eq(missions.kind, 'daily'),
          eq(missions.publishStatus, 'published'),
          eq(missions.dailyDate, dailyDate),
          ...(options.missionId ? [ne(missions.id, options.missionId)] : []),
        ),
      );
    if (clash[0])
      errors.push(
        `Ngày ${dailyDate} đã có nhiệm vụ ngày "${(clash[0].title as { vi: string }).vi}".`,
      );
  }

  // Enough active questions for each quiz.
  const active = await db
    .select({ id: quizQuestions.id, tags: quizQuestions.tags })
    .from(quizQuestions)
    .where(eq(quizQuestions.active, true));
  for (const objective of definition.objectives) {
    if (objective.type !== 'quiz') continue;
    const from = objective.params.from;
    const available =
      'questionIds' in from
        ? from.questionIds.filter((id) => active.some((q) => q.id === id)).length
        : active.filter((q) => q.tags.some((tag) => from.tags.includes(tag))).length;
    const needed = 'questionIds' in from ? objective.target : Math.max(objective.target, from.pick);
    if (available < needed)
      errors.push(`Mục tiêu ${objective.id}: chỉ có ${available} câu hỏi đang bật, cần ${needed}.`);
  }

  // Rewards within the configured cap.
  const [capRow] = await db.select().from(settings).where(eq(settings.key, 'rewardCap'));
  const cap = typeof capRow?.value === 'number' ? capRow.value : DEFAULT_REWARD_CAP;
  const best = Math.max(1, ...(definition.bonusWindows ?? []).map((window) => window.multiplier));
  const { points } = sumRewards(definition.rewards, best);
  if (points > cap) errors.push(`Thưởng tối đa ${points} điểm vượt hạn mức ${cap}.`);

  if (Date.parse(definition.endsAt) <= Date.now())
    warnings.push('Nhiệm vụ đã kết thúc trước khi xuất bản.');
  if (definition.mapVersion !== map.map.version)
    warnings.push(
      `Soạn cho bản đồ ${definition.mapVersion}, bản đồ hiện tại là ${map.map.version}.`,
    );
  if (definition.objectives.every((objective) => objective.optional))
    warnings.push('Mọi mục tiêu đều không bắt buộc.');
  return { errors, warnings, definition, dailyDate };
}
