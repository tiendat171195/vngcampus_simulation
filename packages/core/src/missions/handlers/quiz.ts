import type { EntitySpec, ObjectiveHandler } from '../types';

interface QuizState {
  /** Questions of the current run, in the order they are asked. */
  questions: string[];
  /** Index of the question being asked. */
  at: number;
  /** Wrong answers to the current question. */
  misses: number;
  /** Questions answered right, over every run. */
  right: string[];
  /** Runs started, so a new run draws other questions. */
  runs: number;
}

/**
 * Answer questions at a kiosk (docs/06 §4). The handler only sees whether an answer was right:
 * the realtime server checks it against the bank, and answers never reach the client.
 */
export const quizHandler: ObjectiveHandler<'quiz', QuizState> = {
  type: 'quiz',
  events: ['entity.interacted', 'quiz.answered'],
  init: (ctx, objective, player) => ({
    questions: draw(ctx, objective, player.userId, 0, []),
    at: 0,
    misses: 0,
    right: [],
    runs: 0,
  }),
  onEvent(ctx, objective, state, event, player) {
    // Coming back to the kiosk after a run without enough right answers starts another.
    if (event.type === 'entity.interacted') {
      if (event.entityId !== kioskId(objective) || state.at < state.questions.length) return null;
      const runs = state.runs + 1;
      const questions = draw(ctx, objective, player.userId, runs, state.right);
      if (questions.length === 0) return null;
      return {
        state: { ...state, questions, at: 0, misses: 0, runs },
        current: Math.min(objective.target, state.right.length),
      };
    }
    if (event.type !== 'quiz.answered') return null;
    if (state.questions[state.at] !== event.questionId) return null;
    if (event.correct) {
      const right = [...state.right, event.questionId];
      return {
        state: { ...state, right, at: state.at + 1, misses: 0 },
        current: Math.min(objective.target, right.length),
      };
    }
    const misses = state.misses + 1;
    const moveOn = misses >= objective.params.maxAttempts;
    return {
      state: { ...state, at: moveOn ? state.at + 1 : state.at, misses: moveOn ? 0 : misses },
      current: Math.min(objective.target, state.right.length),
    };
  },
  sharedEntities: (_ctx, objective): EntitySpec[] => [
    {
      id: kioskId(objective),
      objectiveId: objective.id,
      kind: 'kiosk',
      poiId: objective.params.at.poiId,
    },
  ],
  clientView: (objective, state) => ({
    at: objective.params.at.poiId,
    /** Id of the question to ask next, or null when the run is over. */
    questionId: state.questions[state.at] ?? null,
    asked: state.at,
    total: state.questions.length,
    triesLeft: objective.params.maxAttempts - state.misses,
    right: state.right.length,
  }),
};

type Objective = Parameters<typeof quizHandler.init>[1];

export const kioskId = (objective: Objective) => `${objective.id}:${objective.params.at.poiId}`;

function draw(
  ctx: Parameters<typeof quizHandler.init>[0],
  objective: Objective,
  userId: string,
  run: number,
  exclude: string[],
): string[] {
  const picked =
    ctx.questions?.pick(
      objective.params.from,
      `${ctx.missionId}:${objective.id}:${userId}:${run}`,
    ) ?? [];
  return picked.filter((id) => !exclude.includes(id));
}
