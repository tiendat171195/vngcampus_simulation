import { audit, checkMissionForPublish } from '@campus/core';
import { missions, quizQuestions, uuidv7 } from '@campus/db';
import { campusIndex } from '@campus/map-data/campus';
import {
  type AdminMissionDto,
  type AdminMissionSummary,
  type AdminQuestionDto,
  type MissionDefinition,
  type MissionState,
  missionDefinitionSchema,
  type PublishCheckDto,
  quizQuestionSchema,
  sumRewardsPoints,
} from '@campus/shared';
import { and, asc, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { ApiError } from '../errors';
import { requireStaff, staffOf } from './staff';

type MissionRow = typeof missions.$inferSelect;

const idParams = z.object({ id: z.uuid() });
const rangeQuery = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
const definitionBody = z.object({ definition: z.unknown() });
const validateBody = z.object({ definition: z.unknown(), missionId: z.uuid().optional() });
const duplicateBody = z
  .object({ shiftDays: z.number().int().min(-366).max(366).default(1) })
  .strict();
const quizQuery = z.object({
  q: z.string().trim().max(80).optional(),
  tag: z.string().max(40).optional(),
});
const importBody = z.object({ csv: z.string().min(1).max(500_000) });

export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success)
    throw new ApiError(
      400,
      'invalid_request',
      'Dữ liệu gửi lên không hợp lệ.',
      z.flattenError(parsed.error),
    );
  return parsed.data;
}

export function definitionOf(input: unknown): MissionDefinition {
  const parsed = missionDefinitionSchema.safeParse(input);
  if (!parsed.success)
    throw new ApiError(
      400,
      'invalid_mission',
      'Nhiệm vụ chưa hợp lệ.',
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  return parsed.data;
}

export function stateOf(
  row: Pick<MissionRow, 'publishStatus' | 'startsAt' | 'endsAt'>,
  now = new Date(),
): MissionState {
  if (row.publishStatus !== 'published') return row.publishStatus;
  if (now < row.startsAt) return 'scheduled';
  return now < row.endsAt ? 'running' : 'ended';
}

const summary = (row: MissionRow): AdminMissionSummary => ({
  id: row.id,
  kind: row.kind,
  title: row.title as AdminMissionSummary['title'],
  publishStatus: row.publishStatus,
  state: stateOf(row),
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt.toISOString(),
  dailyDate: row.dailyDate,
  autoFilled: row.autoFilled,
  version: row.version,
});

/** What may change on a mission that has started: words and more reward, nothing else (docs/06 §6). */
function onlyCosmetic(before: MissionDefinition, after: MissionDefinition): boolean {
  const shape = (d: MissionDefinition) =>
    JSON.stringify({
      kind: d.kind,
      startsAt: d.startsAt,
      endsAt: d.endsAt,
      objectiveMode: d.objectiveMode,
      objectives: d.objectives.map(({ id, type, target, optional, params }) => ({
        id,
        type,
        target,
        optional,
        params,
      })),
    });
  return (
    shape(before) === shape(after) &&
    sumRewardsPoints(after.rewards) >= sumRewardsPoints(before.rewards)
  );
}

/** Mission editor and question bank (docs/08 §4). */
export async function adminMissionRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const { db, keys } = deps;
  const guard = { preHandler: requireStaff(db, keys, 'missions') };
  const load = async (id: string) => {
    const [row] = await db.select().from(missions).where(eq(missions.id, id));
    if (!row) throw new ApiError(404, 'not_found', 'Không có nhiệm vụ này.');
    return row;
  };
  const save = async (row: MissionRow, changes: Partial<MissionRow>) => {
    const [updated] = await db
      .update(missions)
      .set({ ...changes, version: row.version + 1, updatedAt: new Date() })
      .where(eq(missions.id, row.id))
      .returning();
    return updated ?? row;
  };
  const columns = (definition: MissionDefinition) => ({
    kind: definition.kind,
    title: definition.title,
    description: definition.description,
    startsAt: new Date(definition.startsAt),
    endsAt: new Date(definition.endsAt),
    definition,
    mapVersion: definition.mapVersion,
  });

  app.get('/admin/missions', guard, async (request): Promise<AdminMissionSummary[]> => {
    const { from, to } = parse(rangeQuery, request.query);
    const rows = await db
      .select()
      .from(missions)
      .where(
        and(
          ...(from ? [gte(missions.endsAt, new Date(from))] : []),
          ...(to ? [lte(missions.startsAt, new Date(to))] : []),
        ),
      )
      .orderBy(desc(missions.startsAt))
      .limit(300);
    return rows.map(summary);
  });

  app.get('/admin/missions/:id', guard, async (request): Promise<AdminMissionDto> => {
    const row = await load(parse(idParams, request.params).id);
    return { ...summary(row), definition: row.definition };
  });

  app.post('/admin/missions', guard, async (request, reply): Promise<AdminMissionDto> => {
    const definition = definitionOf(parse(definitionBody, request.body).definition);
    const staff = staffOf(request);
    const [row] = await db
      .insert(missions)
      .values({
        id: uuidv7(),
        publishStatus: 'draft',
        createdBy: staff.id,
        updatedBy: staff.id,
        ...columns(definition),
      })
      .returning();
    if (!row) throw new ApiError(500, 'internal', 'Không lưu được.');
    await audit(db, {
      actorId: staff.id,
      action: 'mission.create',
      entityType: 'mission',
      entityId: row.id,
    });
    reply.status(201);
    return { ...summary(row), definition: row.definition };
  });

  app.put('/admin/missions/:id', guard, async (request): Promise<AdminMissionDto> => {
    const row = await load(parse(idParams, request.params).id);
    const definition = definitionOf(parse(definitionBody, request.body).definition);
    const staff = staffOf(request);
    const state = stateOf(row);
    if (state === 'archived') throw new ApiError(409, 'archived', 'Nhiệm vụ đã huỷ.');
    if (state === 'running' || state === 'ended') {
      const before = missionDefinitionSchema.parse(row.definition);
      if (!onlyCosmetic(before, definition))
        throw new ApiError(
          409,
          'locked',
          'Nhiệm vụ đã bắt đầu: chỉ sửa được chữ và tăng thưởng. Muốn đổi cấu trúc thì kết thúc sớm rồi nhân bản.',
        );
    }
    if (state === 'scheduled') {
      const check = await checkMissionForPublish(db, definition, campusIndex, {
        missionId: row.id,
      });
      if (check.errors.length > 0)
        throw new ApiError(
          400,
          'invalid_mission',
          'Nhiệm vụ đã lên lịch phải luôn hợp lệ.',
          check.errors,
        );
    }
    const updated = await save(row, {
      ...columns(definition),
      ...(row.publishStatus === 'published' && definition.kind === 'daily'
        ? {
            dailyDate: (
              await checkMissionForPublish(db, definition, campusIndex, { missionId: row.id })
            ).dailyDate,
          }
        : {}),
      updatedBy: staff.id,
    });
    await audit(db, {
      actorId: staff.id,
      action: 'mission.update',
      entityType: 'mission',
      entityId: row.id,
      diff: { version: updated.version },
    });
    return { ...summary(updated), definition: updated.definition };
  });

  app.post('/admin/missions/validate', guard, async (request): Promise<PublishCheckDto> => {
    const body = parse(validateBody, request.body);
    const check = await checkMissionForPublish(db, body.definition, campusIndex, {
      ...(body.missionId ? { missionId: body.missionId } : {}),
    });
    return { errors: check.errors, warnings: check.warnings };
  });

  app.post('/admin/missions/:id/publish', guard, async (request): Promise<AdminMissionSummary> => {
    const row = await load(parse(idParams, request.params).id);
    if (row.publishStatus !== 'draft')
      throw new ApiError(409, 'not_draft', 'Chỉ xuất bản được bản nháp.');
    const check = await checkMissionForPublish(db, row.definition, campusIndex, {
      missionId: row.id,
    });
    if (check.errors.length > 0)
      throw new ApiError(400, 'invalid_mission', 'Chưa xuất bản được.', check.errors);
    const staff = staffOf(request);
    const updated = await save(row, {
      publishStatus: 'published',
      dailyDate: check.dailyDate,
      updatedBy: staff.id,
    });
    await audit(db, {
      actorId: staff.id,
      action: 'mission.publish',
      entityType: 'mission',
      entityId: row.id,
    });
    return summary(updated);
  });

  app.post(
    '/admin/missions/:id/unpublish',
    guard,
    async (request): Promise<AdminMissionSummary> => {
      const row = await load(parse(idParams, request.params).id);
      if (stateOf(row) !== 'scheduled')
        throw new ApiError(
          409,
          'started',
          'Chỉ gỡ được nhiệm vụ chưa bắt đầu; nhiệm vụ đang chạy thì kết thúc sớm.',
        );
      const staff = staffOf(request);
      const updated = await save(row, {
        publishStatus: 'draft',
        dailyDate: null,
        updatedBy: staff.id,
      });
      await audit(db, {
        actorId: staff.id,
        action: 'mission.unpublish',
        entityType: 'mission',
        entityId: row.id,
      });
      return summary(updated);
    },
  );

  app.post('/admin/missions/:id/end', guard, async (request): Promise<AdminMissionSummary> => {
    const row = await load(parse(idParams, request.params).id);
    if (stateOf(row) !== 'running')
      throw new ApiError(409, 'not_running', 'Nhiệm vụ không đang chạy.');
    const staff = staffOf(request);
    const now = new Date();
    const definition = missionDefinitionSchema.parse(row.definition);
    const updated = await save(row, {
      endsAt: now,
      definition: { ...definition, endsAt: now.toISOString() },
      updatedBy: staff.id,
    });
    await audit(db, {
      actorId: staff.id,
      action: 'mission.end',
      entityType: 'mission',
      entityId: row.id,
    });
    return summary(updated);
  });

  app.post(
    '/admin/missions/:id/duplicate',
    guard,
    async (request, reply): Promise<AdminMissionDto> => {
      const row = await load(parse(idParams, request.params).id);
      const { shiftDays } = parse(duplicateBody, request.body);
      const before = missionDefinitionSchema.parse(row.definition);
      const shift = (iso: string) =>
        new Date(Date.parse(iso) + shiftDays * 86_400_000).toISOString();
      const definition = {
        ...before,
        startsAt: shift(before.startsAt),
        endsAt: shift(before.endsAt),
      };
      const staff = staffOf(request);
      const [copy] = await db
        .insert(missions)
        .values({
          id: uuidv7(),
          publishStatus: 'draft',
          createdBy: staff.id,
          updatedBy: staff.id,
          ...columns(definition),
        })
        .returning();
      if (!copy) throw new ApiError(500, 'internal', 'Không nhân bản được.');
      await audit(db, {
        actorId: staff.id,
        action: 'mission.duplicate',
        entityType: 'mission',
        entityId: copy.id,
        diff: { from: row.id },
      });
      reply.status(201);
      return { ...summary(copy), definition: copy.definition };
    },
  );

  app.delete('/admin/missions/:id', guard, async (request): Promise<AdminMissionSummary> => {
    const row = await load(parse(idParams, request.params).id);
    if (row.publishStatus !== 'draft')
      throw new ApiError(409, 'not_draft', 'Chỉ huỷ được bản nháp.');
    const staff = staffOf(request);
    const updated = await save(row, { publishStatus: 'archived', updatedBy: staff.id });
    await audit(db, {
      actorId: staff.id,
      action: 'mission.archive',
      entityType: 'mission',
      entityId: row.id,
    });
    return summary(updated);
  });

  // ---------- question bank ----------

  const toQuestion = (row: typeof quizQuestions.$inferSelect): AdminQuestionDto => ({
    id: row.id,
    text: row.text as AdminQuestionDto['text'],
    choices: row.choices as AdminQuestionDto['choices'],
    correctIndex: row.correctIndex,
    ...(row.explanation ? { explanation: row.explanation as AdminQuestionDto['text'] } : {}),
    tags: row.tags,
    active: row.active,
  });
  const upsert = async (question: z.infer<typeof quizQuestionSchema>) =>
    db
      .insert(quizQuestions)
      .values({ ...question, explanation: question.explanation ?? null, active: true })
      .onConflictDoUpdate({
        target: quizQuestions.id,
        set: {
          text: question.text,
          choices: question.choices,
          correctIndex: question.correctIndex,
          explanation: question.explanation ?? null,
          tags: question.tags,
          active: true,
        },
      });

  app.get('/admin/quiz', guard, async (request): Promise<AdminQuestionDto[]> => {
    const { q, tag } = parse(quizQuery, request.query);
    const rows = await db
      .select()
      .from(quizQuestions)
      .where(
        and(
          ...(q
            ? [
                or(
                  ilike(quizQuestions.id, `%${q}%`),
                  sql`${quizQuestions.text}->>'vi' ilike ${`%${q}%`}`,
                ),
              ]
            : []),
          ...(tag ? [sql`${tag} = any(${quizQuestions.tags})`] : []),
        ),
      )
      .orderBy(asc(quizQuestions.id))
      .limit(500);
    return rows.map(toQuestion);
  });

  app.put('/admin/quiz/:id', guard, async (request): Promise<AdminQuestionDto> => {
    const id = z
      .string()
      .regex(/^[a-z0-9_-]{1,64}$/)
      .safeParse((request.params as { id: string }).id);
    if (!id.success)
      throw new ApiError(400, 'invalid_request', 'Mã câu hỏi chỉ gồm chữ thường, số, - và _.');
    const parsed = quizQuestionSchema.safeParse({ ...(request.body as object), id: id.data });
    if (!parsed.success)
      throw new ApiError(
        400,
        'invalid_request',
        'Câu hỏi chưa hợp lệ.',
        z.flattenError(parsed.error),
      );
    await upsert(parsed.data);
    await audit(db, {
      actorId: staffOf(request).id,
      action: 'quiz.save',
      entityType: 'quiz',
      entityId: id.data,
    });
    const [row] = await db.select().from(quizQuestions).where(eq(quizQuestions.id, id.data));
    if (!row) throw new ApiError(500, 'internal', 'Không lưu được.');
    return toQuestion(row);
  });

  app.delete('/admin/quiz/:id', guard, async (request) => {
    const { id } = request.params as { id: string };
    await db.update(quizQuestions).set({ active: false }).where(eq(quizQuestions.id, id));
    await audit(db, {
      actorId: staffOf(request).id,
      action: 'quiz.disable',
      entityType: 'quiz',
      entityId: id,
    });
    return { id, active: false };
  });

  /**
   * CSV import (docs/08 §3): a header row with `id,question,choice1…choice6,correct,explanation,tags`
   * — `correct` counts from 1, `tags` are separated by `;`. Valid rows are saved, bad rows reported.
   */
  app.post('/admin/quiz/import', guard, async (request) => {
    const { csv } = parse(importBody, request.body);
    const { questions, errors } = parseQuestionsCsv(csv);
    for (const question of questions) await upsert(question);
    await audit(db, {
      actorId: staffOf(request).id,
      action: 'quiz.import',
      entityType: 'quiz',
      entityId: '*',
      diff: { imported: questions.length, rejected: errors.length },
    });
    return { imported: questions.length, errors };
  });
}

/** Splits CSV text into rows, honouring quotes and line breaks inside them. */
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/^﻿/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

export function parseQuestionsCsv(text: string) {
  const [header = [], ...rows] = csvRows(text);
  const at = (name: string) => header.map((h) => h.toLowerCase()).indexOf(name);
  const questions: z.infer<typeof quizQuestionSchema>[] = [];
  const errors: string[] = [];
  rows.forEach((cells, i) => {
    const get = (name: string) => (at(name) >= 0 ? (cells[at(name)] ?? '') : '');
    const choices = [1, 2, 3, 4, 5, 6]
      .map((n) => get(`choice${n}`))
      .filter((value) => value !== '');
    const explanation = get('explanation');
    const parsed = quizQuestionSchema.safeParse({
      id: get('id'),
      text: { vi: get('question') },
      choices: choices.map((vi) => ({ vi })),
      correctIndex: Number(get('correct')) - 1,
      ...(explanation ? { explanation: { vi: explanation } } : {}),
      tags: get('tags')
        .split(';')
        .map((tag) => tag.trim())
        .filter(Boolean),
    });
    if (parsed.success) questions.push(parsed.data);
    else
      errors.push(
        `Dòng ${i + 2}: ${parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`,
      );
  });
  return { questions, errors };
}
