import type { CampusMap, FloorId, MapIndex } from '@campus/map-data';
import type { MeshBatch } from './MeshBatch';

/**
 * Levels group what is drawn together so whole storeys can be shown or hidden:
 * `ground` is everything outdoors, the floor ids hold each storey of every building.
 */
export type LevelId = 'ground' | FloorId;

export const LEVEL_ORDER: readonly LevelId[] = ['ground', 'F1', 'F2', 'F3', 'ROOF'];

export interface LevelBatches {
  /** Opaque, vertex-coloured geometry. */
  solid: MeshBatch;
  /** Window glass, drawn as one transparent mesh per level. */
  glass: MeshBatch;
}

export interface BuildContext {
  map: CampusMap;
  index: MapIndex;
  level(id: LevelId): LevelBatches;
  /** Everything a character can bump into or stand on. Never drawn. */
  collider: MeshBatch;
  floorY(id: FloorId): number;
}

/**
 * Heights of the flat layers painted on the ground. They are a centimetre apart: enough to
 * avoid z-fighting at campus distances, too little to notice underfoot.
 */
export const LAYER = {
  outside: -0.02,
  river: -0.015,
  site: 0,
  tint: 0.01,
  path: 0.02,
  floor: 0.03,
  room: 0.04,
  water: 0.05,
} as const;
