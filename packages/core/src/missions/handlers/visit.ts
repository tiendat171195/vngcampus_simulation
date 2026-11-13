import type { ObjectiveHandler } from '../types';

interface VisitState {
  /** Targets reached, by area or POI id. */
  reached: string[];
}

const keyOf = (target: { areaId: string } | { poiId: string }) =>
  'areaId' in target ? target.areaId : target.poiId;

/** Go to one or more places, optionally staying a while (docs/06 §4). */
export const visitHandler: ObjectiveHandler<'visit', VisitState> = {
  type: 'visit',
  events: ['area.entered', 'area.dwell'],
  init: () => ({ reached: [] }),
  onEvent(_ctx, objective, state, event) {
    if (event.type !== 'area.entered' && event.type !== 'area.dwell') return null;
    const { targets, dwellSec } = objective.params;
    // With a dwell time only a long enough stay counts; otherwise arriving does.
    if (
      dwellSec
        ? event.type !== 'area.dwell' || event.seconds < dwellSec
        : event.type !== 'area.entered'
    )
      return null;
    if (!targets.some((target) => keyOf(target) === event.areaId)) return null;
    if (state.reached.includes(event.areaId)) return null;
    const reached = [...state.reached, event.areaId];
    return { state: { reached }, current: Math.min(objective.target, reached.length) };
  },
  clientView: (objective, state) => ({
    targets: objective.params.targets.map((target) => ({
      ...target,
      reached: state.reached.includes(keyOf(target)),
    })),
  }),
};

/** Area and POI ids a visit objective listens for, so the room watches only those. */
export const visitTargets = (targets: Array<{ areaId: string } | { poiId: string }>) =>
  targets.map(keyOf);
