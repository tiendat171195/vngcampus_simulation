import type {
  MissionDefinition,
  ObjectiveDefinition,
  ObjectiveProgress,
  ObjectiveType,
} from '@campus/shared';
import { collectHandler } from './handlers/collect';
import { quizHandler } from './handlers/quiz';
import { socialHandler } from './handlers/social';
import { visitHandler, visitTargets } from './handlers/visit';
import type { EntitySpec, GameEvent, MissionCtx, ObjectiveHandler, PlayerRef } from './types';

/** Every objective type the engine knows; a new type is a new entry here (docs/06 §12). */
// biome-ignore lint/suspicious/noExplicitAny: each handler is called with its own objective type.
const HANDLERS: Record<ObjectiveType, ObjectiveHandler<any, any>> = {
  visit: visitHandler,
  collect: collectHandler,
  quiz: quizHandler,
  social: socialHandler,
};

export type Progress = Record<string, ObjectiveProgress>;

/** A fresh start on a mission: every objective at zero. */
export function startProgress(ctx: MissionCtx, player: PlayerRef): Progress {
  const progress: Progress = {};
  for (const objective of ctx.mission.objectives)
    progress[objective.id] = {
      current: 0,
      done: false,
      data: HANDLERS[objective.type].init(ctx, objective, player),
    };
  return progress;
}

/** Whether the mission counts as done (docs/06 §3, `objectiveMode`). */
export function isComplete(mission: MissionDefinition, progress: Progress): boolean {
  const required = mission.objectives.filter((objective) => !objective.optional);
  const done = required.filter((objective) => progress[objective.id]?.done).length;
  return typeof mission.objectiveMode === 'object'
    ? done >= mission.objectiveMode.anyOf
    : done === required.length;
}

/**
 * Objectives that listen right now. In `sequential` mode only the first unfinished required one
 * does (optional ones always do); otherwise every unfinished one.
 */
export function activeObjectives(
  mission: MissionDefinition,
  progress: Progress,
): ObjectiveDefinition[] {
  const open = mission.objectives.filter((objective) => !progress[objective.id]?.done);
  if (mission.objectiveMode !== 'sequential') return open;
  const next = open.find((objective) => !objective.optional);
  return open.filter((objective) => objective.optional || objective === next);
}

export interface EventOutcome {
  progress: Progress;
  /** Objectives whose count or state changed. */
  changed: string[];
  /** The event finished the mission. */
  completed: boolean;
}

/**
 * Routes one game event to the objectives that listen for it. Returns null when nothing
 * changed, so the caller writes to the database only when there is something to write.
 */
export function applyEvent(
  ctx: MissionCtx,
  progress: Progress,
  event: GameEvent,
  player: PlayerRef,
): EventOutcome | null {
  if (isComplete(ctx.mission, progress)) return null;
  let next: Progress | null = null;
  const changed: string[] = [];
  for (const objective of activeObjectives(ctx.mission, progress)) {
    const handler = HANDLERS[objective.type];
    if (!handler.events.includes(event.type)) continue;
    const before = progress[objective.id];
    if (!before) continue;
    const result = handler.onEvent(ctx, objective, before.data, event, player);
    if (!result) continue;
    next ??= { ...progress };
    next[objective.id] = {
      current: result.current,
      done: result.current >= objective.target,
      data: result.state,
    };
    changed.push(objective.id);
  }
  if (!next) return null;
  return { progress: next, changed, completed: isComplete(ctx.mission, next) };
}

/** Mission things to place in the world: for everyone, and for this player only. */
export function entitiesFor(
  ctx: MissionCtx,
  progress: Progress | null,
  player: PlayerRef | null,
): { shared: EntitySpec[]; own: EntitySpec[] } {
  const shared: EntitySpec[] = [];
  const own: EntitySpec[] = [];
  for (const objective of ctx.mission.objectives) {
    const handler = HANDLERS[objective.type];
    shared.push(...(handler.sharedEntities?.(ctx, objective) ?? []));
    const state = progress?.[objective.id];
    if (player && state && !state.done)
      own.push(...(handler.privateEntities?.(ctx, objective, state.data, player) ?? []));
  }
  return { shared, own };
}

/** What the player may see of their progress: counts and safe details, never answers. */
export function progressView(mission: MissionDefinition, progress: Progress) {
  return mission.objectives.map((objective) => {
    const state = progress[objective.id];
    return {
      id: objective.id,
      current: state?.current ?? 0,
      target: objective.target,
      done: state?.done ?? false,
      view: state ? HANDLERS[objective.type].clientView(objective, state.data) : null,
    };
  });
}

/** Area and POI ids the room must watch for this mission (docs/06 §5.1). */
export function watchedPlaces(mission: MissionDefinition): string[] {
  const places = new Set<string>();
  for (const objective of mission.objectives)
    if (objective.type === 'visit')
      for (const id of visitTargets(objective.params.targets)) places.add(id);
  return [...places];
}
