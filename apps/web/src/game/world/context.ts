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

/**
 * Flat surfaces painted on the ground, lowest first. They are almost coplanar, so each one is
 * its own mesh drawn with a polygon offset; a height difference alone flickers from far away.
 */
export const FLAT_LAYERS = ['site', 'tint', 'road', 'walkway', 'floor', 'room', 'water'] as const;
export type FlatLayer = (typeof FLAT_LAYERS)[number];

/** Nominal heights. The millimetre steps only keep the order well defined. */
export const LAYER: Record<FlatLayer | 'outside' | 'river', number> = {
  outside: -0.3,
  river: -0.12,
  site: 0,
  tint: 0.002,
  road: 0.004,
  walkway: 0.006,
  floor: 0.008,
  room: 0.01,
  water: 0.012,
};

export interface BuildContext {
  map: CampusMap;
  index: MapIndex;
  level(id: LevelId): LevelBatches;
  /** Ground-level decals: grass, paving, roads, interior floor finish, water surfaces. */
  flat(layer: FlatLayer): MeshBatch;
  /** Everything a character can bump into or stand on. Never drawn. */
  collider: MeshBatch;
  floorY(id: FloorId): number;
}
