import { missionMapProblems, vnDateOf, vnDayBounds } from '@campus/core';
import type { MapIndex } from '@campus/map-data';
import {
  type MissionDefinition,
  missionDefinitionSchema,
  type QuizQuestion,
  quizQuestionSchema,
} from '@campus/shared';
import { z } from 'zod';

export interface PreparedMission {
  definition: MissionDefinition;
  /** Vietnam day of a daily mission. */
  dailyDate: string | null;
  warnings: string[];
}

/**
 * Checks mission files before they reach the database: the schema, the map, and for daily
 * missions the calendar day. `today` moves a daily mission to that Vietnam day (for trying a
 * mission out locally). Throws with every problem listed.
 */
export function prepareMissions(
  input: unknown,
  map: MapIndex,
  options: { today?: string } = {},
): PreparedMission[] {
  const list = Array.isArray(input) ? input : [input];
  const prepared: PreparedMission[] = [];
  const problems: string[] = [];
  list.forEach((raw, i) => {
    let candidate = raw;
    if (options.today && (raw as { kind?: string })?.kind === 'daily') {
      const { start, end } = vnDayBounds(options.today);
      candidate = {
        ...(raw as object),
        startsAt: start.toISOString(),
        endsAt: new Date(end.getTime() - 1000).toISOString(),
      };
    }
    const parsed = missionDefinitionSchema.safeParse(candidate);
    if (!parsed.success) {
      problems.push(`Nhiệm vụ ${i + 1}:\n${z.prettifyError(parsed.error)}`);
      return;
    }
    const definition = parsed.data;
    const mapProblems = missionMapProblems(definition, map);
    if (mapProblems.length > 0) {
      problems.push(`Nhiệm vụ ${i + 1} (${definition.title.vi}):\n${mapProblems.join('\n')}`);
      return;
    }
    const warnings: string[] = [];
    if (definition.mapVersion !== map.map.version)
      warnings.push(
        `soạn cho bản đồ ${definition.mapVersion}, bản đồ hiện tại là ${map.map.version}`,
      );
    let dailyDate: string | null = null;
    if (definition.kind === 'daily') {
      dailyDate = vnDateOf(new Date(definition.startsAt));
      if (vnDateOf(new Date(Date.parse(definition.endsAt) - 1)) !== dailyDate)
        problems.push(
          `Nhiệm vụ ${i + 1} (${definition.title.vi}): nhiệm vụ ngày phải nằm trong một ngày theo giờ Việt Nam.`,
        );
    }
    prepared.push({ definition, dailyDate, warnings });
  });
  if (problems.length > 0) throw new Error(problems.join('\n\n'));
  return prepared;
}

/** Checks a question bank file: a list of questions with unique ids. */
export function prepareQuestions(input: unknown): QuizQuestion[] {
  const parsed = z
    .array(quizQuestionSchema)
    .min(1)
    .superRefine((questions, ctx) => {
      const seen = new Set<string>();
      questions.forEach((question, i) => {
        if (seen.has(question.id))
          ctx.addIssue({ code: 'custom', path: [i, 'id'], message: `"${question.id}" bị trùng.` });
        seen.add(question.id);
      });
    })
    .safeParse(input);
  if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
  return parsed.data;
}
