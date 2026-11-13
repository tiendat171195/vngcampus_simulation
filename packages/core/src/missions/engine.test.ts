import { campusIndex } from '@campus/map-data/campus';
import { type MissionDefinitionInput, missionDefinitionSchema } from '@campus/shared';
import { exampleMission, exampleQuestions } from '@campus/shared/fixtures';
import { describe, expect, it } from 'vitest';
import {
  applyEvent,
  entitiesFor,
  isComplete,
  type Progress,
  progressView,
  startProgress,
  watchedPlaces,
} from './engine';
import { kioskId } from './handlers/quiz';
import { type GameEvent, type MissionCtx, type QuestionPicker, seededOrder } from './types';

const bank: QuestionPicker = {
  pick(from, seed) {
    if ('questionIds' in from) return from.questionIds;
    const pool = exampleQuestions.filter((q) => q.tags.some((tag) => from.tags.includes(tag)));
    return seededOrder(pool, seed)
      .slice(0, from.pick)
      .map((q) => q.id);
  },
};

const contextOf = (input: MissionDefinitionInput = exampleMission): MissionCtx => ({
  missionId: 'm1',
  mission: missionDefinitionSchema.parse(input),
  map: campusIndex,
  questions: bank,
});

/** Applies events one after another, keeping the latest progress. */
function play(ctx: MissionCtx, userId: string, events: GameEvent[], from?: Progress) {
  let progress = from ?? startProgress(ctx, { userId });
  let completed = false;
  for (const event of events) {
    const outcome = applyEvent(ctx, progress, event, { userId });
    if (outcome) {
      progress = outcome.progress;
      completed ||= outcome.completed;
    }
  }
  return { progress, completed };
}

const count = (progress: Progress, id: string) => progress[id]?.current;
/** The questions the quiz objective is asking in this progress. */
const questionsOf = (progress: Progress) =>
  ((progress.o4?.data ?? { questions: [] }) as { questions: string[] }).questions;

describe('visit', () => {
  it('counts arriving once, and only at the listed places', () => {
    const ctx = contextOf();
    const { progress } = play(ctx, 'u1', [
      { type: 'area.entered', userId: 'u1', areaId: 'area.atrium' },
      { type: 'area.entered', userId: 'u1', areaId: 'area.gate_main' },
      { type: 'area.entered', userId: 'u1', areaId: 'area.gate_main' },
    ]);
    expect(progress.o1).toMatchObject({ current: 1, done: true });
  });

  it('with a dwell time, needs a long enough stay', () => {
    const [visit] = exampleMission.objectives;
    const ctx = contextOf({
      ...exampleMission,
      objectives: [{ ...visit, params: { targets: [{ areaId: 'area.gate_main' }], dwellSec: 30 } }],
    } as MissionDefinitionInput);
    const short = play(ctx, 'u1', [
      { type: 'area.entered', userId: 'u1', areaId: 'area.gate_main' },
      { type: 'area.dwell', userId: 'u1', areaId: 'area.gate_main', seconds: 10 },
    ]);
    expect(count(short.progress, 'o1')).toBe(0);
    const long = play(ctx, 'u1', [
      { type: 'area.dwell', userId: 'u1', areaId: 'area.gate_main', seconds: 31 },
    ]);
    expect(long.completed).toBe(true);
  });
});

describe('collect', () => {
  it('gives each player their own items, and only those count', () => {
    const ctx = contextOf();
    const mine = entitiesFor(ctx, startProgress(ctx, { userId: 'u1' }), { userId: 'u1' }).own;
    const theirs = entitiesFor(ctx, startProgress(ctx, { userId: 'u2' }), { userId: 'u2' }).own;
    expect(mine).toHaveLength(4);
    expect(mine.every((e) => e.kind === 'item' && e.item === 'coffee_cup')).toBe(true);
    expect(mine.map((e) => e.id)).not.toEqual(theirs.map((e) => e.id));

    const foreign = theirs.find((e) => !mine.some((m) => m.id === e.id));
    const { progress } = play(ctx, 'u1', [
      { type: 'entity.interacted', userId: 'u1', entityId: foreign?.id ?? 'o3:x' },
      { type: 'entity.interacted', userId: 'u1', entityId: mine[0]?.id ?? '' },
      { type: 'entity.interacted', userId: 'u1', entityId: mine[0]?.id ?? '' },
    ]);
    expect(count(progress, 'o3')).toBe(1);
    // A picked item is gone for that player.
    expect(entitiesFor(ctx, progress, { userId: 'u1' }).own.map((e) => e.id)).not.toContain(
      mine[0]?.id,
    );
  });
});

describe('social', () => {
  it('counts different colleagues once each, never oneself, with the right emote', () => {
    const ctx = contextOf();
    const { progress } = play(ctx, 'u1', [
      { type: 'emote.performed', userId: 'u1', emote: 'wave', nearbyUserIds: ['u1', 'u2', 'u3'] },
      { type: 'emote.performed', userId: 'u1', emote: 'wave', nearbyUserIds: ['u2', 'u3'] },
      { type: 'emote.performed', userId: 'u1', emote: 'dance', nearbyUserIds: ['u4'] },
      { type: 'emote.performed', userId: 'u1', emote: 'wave', nearbyUserIds: ['u4', 'u4'] },
    ]);
    expect(count(progress, 'o2')).toBe(3);
  });
});

describe('quiz', () => {
  const kiosk = 'o4:poi.kiosk.lobby';

  it('asks drawn questions; right answers count, two misses move on', () => {
    const ctx = contextOf();
    const start = startProgress(ctx, { userId: 'u1' });
    const asked = questionsOf(start);
    expect(asked).toHaveLength(3);
    const [q1, q2, q3] = asked as [string, string, string];
    const answer = (questionId: string, correct: boolean): GameEvent => ({
      type: 'quiz.answered',
      userId: 'u1',
      questionId,
      choice: 0,
      correct,
    });
    const { progress } = play(
      ctx,
      'u1',
      [answer(q2, true), answer(q1, true), answer(q2, false), answer(q2, false), answer(q3, true)],
      start,
    );
    expect(progress.o4).toMatchObject({ current: 2, done: true });
    // The view says what to ask next but never the answer.
    expect(JSON.stringify(progressView(ctx.mission, start))).not.toContain('correct');
  });

  it('starts another run at the kiosk after running out, without the questions already right', () => {
    const ctx = contextOf();
    const start = startProgress(ctx, { userId: 'u2' });
    const [q1, q2, q3] = questionsOf(start) as [string, string, string];
    const wrong = (questionId: string): GameEvent => ({
      type: 'quiz.answered',
      userId: 'u2',
      questionId,
      choice: 9,
      correct: false,
    });
    const first = play(
      ctx,
      'u2',
      [
        { type: 'quiz.answered', userId: 'u2', questionId: q1, choice: 0, correct: true },
        wrong(q2),
        wrong(q2),
        wrong(q3),
        wrong(q3),
      ],
      start,
    );
    expect(count(first.progress, 'o4')).toBe(1);
    const again = play(
      ctx,
      'u2',
      [{ type: 'entity.interacted', userId: 'u2', entityId: kiosk }],
      first.progress,
    );
    const next = questionsOf(again.progress);
    expect(next.length).toBeGreaterThan(0);
    expect(next).not.toContain(q1);
    expect(kioskId(ctx.mission.objectives[3] as never)).toBe(kiosk);
  });
});

describe('the whole mission', () => {
  it('completes once every required objective is done, then ignores further events', () => {
    const ctx = contextOf();
    let progress = startProgress(ctx, { userId: 'u1' });
    const items = entitiesFor(ctx, progress, { userId: 'u1' }).own;
    const questions = questionsOf(progress);
    const events: GameEvent[] = [
      { type: 'area.entered', userId: 'u1', areaId: 'area.gate_main' },
      {
        type: 'emote.performed',
        userId: 'u1',
        emote: 'wave',
        nearbyUserIds: ['a', 'b', 'c', 'd', 'e'],
      },
      ...items.map(
        (item): GameEvent => ({ type: 'entity.interacted', userId: 'u1', entityId: item.id }),
      ),
      ...questions.slice(0, 2).map(
        (questionId): GameEvent => ({
          type: 'quiz.answered',
          userId: 'u1',
          questionId,
          choice: 0,
          correct: true,
        }),
      ),
    ];
    const result = play(ctx, 'u1', events, progress);
    progress = result.progress;
    expect(result.completed).toBe(true);
    expect(isComplete(ctx.mission, progress)).toBe(true);
    expect(applyEvent(ctx, progress, events[0] as GameEvent, { userId: 'u1' })).toBeNull();
  });

  it('in sequential mode, listens to one objective at a time', () => {
    const ctx = contextOf({ ...exampleMission, objectiveMode: 'sequential' });
    const early = play(ctx, 'u1', [
      { type: 'emote.performed', userId: 'u1', emote: 'wave', nearbyUserIds: ['a'] },
    ]);
    expect(count(early.progress, 'o2')).toBe(0);
    const inOrder = play(ctx, 'u1', [
      { type: 'area.entered', userId: 'u1', areaId: 'area.gate_main' },
      { type: 'emote.performed', userId: 'u1', emote: 'wave', nearbyUserIds: ['a'] },
    ]);
    expect(count(inOrder.progress, 'o2')).toBe(1);
  });

  it('with anyOf, is done after enough objectives', () => {
    const ctx = contextOf({ ...exampleMission, objectiveMode: { anyOf: 1 } });
    const { completed } = play(ctx, 'u1', [
      { type: 'area.entered', userId: 'u1', areaId: 'area.gate_main' },
    ]);
    expect(completed).toBe(true);
  });

  it('tells the room which places to watch', () => {
    expect(watchedPlaces(contextOf().mission)).toEqual(['area.gate_main']);
  });
});
