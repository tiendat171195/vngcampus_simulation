import { type EntitySpec, type ObjectiveHandler, seededOrder } from '../types';

interface CollectState {
  /** Entity ids picked up. */
  picked: string[];
}

/** Pick up N things placed around the campus (docs/06 §4). */
export const collectHandler: ObjectiveHandler<'collect', CollectState> = {
  type: 'collect',
  events: ['entity.interacted'],
  init: () => ({ picked: [] }),
  onEvent(ctx, objective, state, event, player) {
    if (event.type !== 'entity.interacted') return null;
    if (!event.entityId.startsWith(`${objective.id}:`)) return null;
    if (state.picked.includes(event.entityId)) return null;
    // Only items this player can see count: their own set, or the shared one.
    const entities =
      objective.params.scope === 'shared'
        ? sharedItems(ctx.map.map.spawnSets, objective)
        : ownItems(ctx.missionId, ctx.map.map.spawnSets, objective, player.userId);
    if (!entities.some((entity) => entity.id === event.entityId)) return null;
    const picked = [...state.picked, event.entityId];
    return { state: { picked }, current: Math.min(objective.target, picked.length) };
  },
  sharedEntities(ctx, objective) {
    return objective.params.scope === 'shared' ? sharedItems(ctx.map.map.spawnSets, objective) : [];
  },
  privateEntities(ctx, objective, state, player) {
    if (objective.params.scope === 'shared') return [];
    return ownItems(ctx.missionId, ctx.map.map.spawnSets, objective, player.userId).filter(
      (entity) => !state.picked.includes(entity.id),
    );
  },
  clientView: (objective, state) => ({ item: objective.params.item, picked: state.picked.length }),
};

type Objective = Parameters<typeof collectHandler.init>[1];
type SpawnSets = Record<string, string[]>;

const toEntity = (objective: Objective, poiId: string): EntitySpec => ({
  id: `${objective.id}:${poiId}`,
  objectiveId: objective.id,
  kind: 'item',
  poiId,
  item: objective.params.item,
});

/**
 * A player's own items: as many as the target, at spots shuffled by player and mission, so
 * pointing them out to a colleague does not help (docs/06 §4).
 */
function ownItems(missionId: string, sets: SpawnSets, objective: Objective, userId: string) {
  const spots = sets[objective.params.source.spawnSet] ?? [];
  return seededOrder(spots, `${missionId}:${objective.id}:${userId}`)
    .slice(0, objective.target)
    .map((poiId) => toEntity(objective, poiId));
}

/** Shared items: every spot of the set, first come first served. */
function sharedItems(sets: SpawnSets, objective: Objective) {
  return (sets[objective.params.source.spawnSet] ?? []).map((poiId) => toEntity(objective, poiId));
}
