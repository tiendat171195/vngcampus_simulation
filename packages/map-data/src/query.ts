/**
 * Read-only questions about a map: which floor is this height, which area is this point in,
 * can somebody stand here. Build one index per map and reuse it; lookups are then cheap enough
 * to run for every player several times a second.
 */
import type { ReadonlyVec2, Vec2 } from './frame';
import {
  boundsContain,
  distance,
  type Polygon,
  pointInPolygon,
  polygonArea,
  stripPolygon,
} from './geometry';
import type { Area, CampusMap, Connector, Floor, FloorId, Poi, PoiKind, Structure } from './schema';

export interface MapIndex {
  map: CampusMap;
  floors: ReadonlyMap<FloorId, Floor>;
  areas: ReadonlyMap<string, Area>;
  pois: ReadonlyMap<string, Poi>;
  structures: ReadonlyMap<string, Structure>;
  /** Areas of each floor, smallest first, so the first hit is the most specific one. */
  areasByFloor: ReadonlyMap<FloorId, readonly Area[]>;
  /** Slab holes and flights of each floor: places with no floor to stand on. */
  gapsByFloor: ReadonlyMap<FloorId, readonly Polygon[]>;
}

/** Ground footprint of a flight of stairs or a ramp. */
export function connectorFootprint(connector: Connector): Vec2[] {
  return stripPolygon(connector.lower.at, connector.upper.at, connector.width);
}

/**
 * Tiers of bleachers rise at most this much, so people walk up them without jumping
 * (the character controller steps over 0.35 m).
 */
export const BLEACHER_MAX_RISE = 0.32;
/** Width of the lane of half steps down the middle of bleachers. */
export const BLEACHER_LANE = 1.8;

export interface BleacherLayout {
  tiers: number;
  /** Height of one tier. */
  rise: number;
  /** Depth of one tier, along the flight. */
  depth: number;
  /** Horizontal length of the flight. */
  run: number;
  /** Unit vector from the bottom of the flight to the top. */
  up: Vec2;
  /** Unit vector across the flight, to the right of someone walking up. */
  across: Vec2;
}

export function bleacherLayout(
  connector: Connector,
  lowerY: number,
  upperY: number,
): BleacherLayout {
  const { at: a } = connector.lower;
  const { at: b } = connector.upper;
  const run = distance(a, b);
  const tiers = Math.ceil((upperY - lowerY) / BLEACHER_MAX_RISE - 1e-9);
  const up: Vec2 = [(b[0] - a[0]) / run, (b[1] - a[1]) / run];
  return {
    tiers,
    rise: (upperY - lowerY) / tiers,
    depth: run / tiers,
    run,
    up,
    across: [-up[1], up[0]],
  };
}

/**
 * Where on a flight of bleachers a point lies: `along` metres up the flight from its foot and
 * `offset` metres to the side of its centre line. Null outside the flight.
 */
export function bleacherPosition(
  connector: Connector,
  layout: BleacherLayout,
  point: ReadonlyVec2,
): { along: number; offset: number } | null {
  const { at: a } = connector.lower;
  const dx = point[0] - a[0];
  const dz = point[1] - a[1];
  const along = dx * layout.up[0] + dz * layout.up[1];
  const offset = dx * layout.across[0] + dz * layout.across[1];
  if (along < 0 || along > layout.run || Math.abs(offset) > connector.width / 2) return null;
  return { along, offset };
}

/** Height above the foot of the flight of the tier (or lane step) under a point. */
export function bleacherHeight(layout: BleacherLayout, along: number, offset: number): number {
  const inLane = Math.abs(offset) < BLEACHER_LANE / 2;
  const step = inLane ? layout.depth / 2 : layout.depth;
  const rise = inLane ? layout.rise / 2 : layout.rise;
  const count = inLane ? layout.tiers * 2 : layout.tiers;
  return Math.min(count, Math.floor(along / step) + 1) * rise;
}

export function createMapIndex(map: CampusMap): MapIndex {
  const areasByFloor = new Map<FloorId, Area[]>();
  const gapsByFloor = new Map<FloorId, Polygon[]>();
  for (const floor of map.floors) {
    areasByFloor.set(floor.id, []);
    gapsByFloor.set(floor.id, []);
  }
  for (const area of map.areas) areasByFloor.get(area.floor)?.push(area);
  for (const areas of areasByFloor.values()) {
    areas.sort((a, b) => polygonArea(a.polygon) - polygonArea(b.polygon));
  }
  for (const structure of map.structures) {
    for (const hole of structure.voids) {
      for (const floor of hole.floors) gapsByFloor.get(floor)?.push(hole.polygon);
    }
  }
  for (const connector of map.connectors) {
    const footprint = connectorFootprint(connector);
    gapsByFloor.get(connector.lower.floor)?.push(footprint);
    gapsByFloor.get(connector.upper.floor)?.push(footprint);
  }

  return {
    map,
    floors: new Map(map.floors.map((floor) => [floor.id, floor])),
    areas: new Map(map.areas.map((area) => [area.id, area])),
    pois: new Map(map.pois.map((poi) => [poi.id, poi])),
    structures: new Map(map.structures.map((structure) => [structure.id, structure])),
    areasByFloor,
    gapsByFloor,
  };
}

/** How far below a slab somebody may be and still count as being on that floor (last stair steps). */
const FLOOR_SNAP = 0.3;

/** The floor somebody at height `y` is on: the highest slab at or just above their feet. */
export function floorAt(index: MapIndex, y: number): FloorId {
  let result = index.map.floors[0] as Floor;
  for (const floor of index.map.floors) {
    if (floor.id !== 'ROOF' && floor.y <= y + FLOOR_SNAP) result = floor;
  }
  return result.id;
}

/** Every area containing the point, most specific first. */
export function areasAt(index: MapIndex, point: ReadonlyVec2, floor: FloorId): Area[] {
  return (index.areasByFloor.get(floor) ?? []).filter((area) =>
    pointInPolygon(point, area.polygon),
  );
}

/** The most specific area containing the point, if any. */
export function findArea(index: MapIndex, point: ReadonlyVec2, floor: FloorId): Area | undefined {
  return (index.areasByFloor.get(floor) ?? []).find((area) => pointInPolygon(point, area.polygon));
}

export function isInside(index: MapIndex, areaId: string, point: ReadonlyVec2): boolean {
  const area = index.areas.get(areaId);
  return area !== undefined && pointInPolygon(point, area.polygon);
}

/**
 * Whether there is floor to stand on at this point. It answers "may a mission item or a seat be
 * placed here", not "can a player squeeze past this wall": walls are not part of the map data.
 */
export function isWalkable(index: MapIndex, point: ReadonlyVec2, floor: FloorId): boolean {
  if (!boundsContain(index.map.meta.bounds, point)) return false;
  const containing = areasAt(index, point, floor);
  if (containing.length === 0) return false;
  if (containing.some((area) => !area.walkable)) return false;
  return !(index.gapsByFloor.get(floor) ?? []).some((gap) => pointInPolygon(point, gap));
}

export function poisOfKind(index: MapIndex, kind: PoiKind, floor?: FloorId): Poi[] {
  return index.map.pois.filter(
    (poi) => poi.kind === kind && (floor === undefined || poi.floor === floor),
  );
}

export function nearestPoi(
  index: MapIndex,
  kind: PoiKind,
  point: ReadonlyVec2,
  floor?: FloorId,
): Poi | undefined {
  let best: Poi | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const poi of poisOfKind(index, kind, floor)) {
    const d = distance(point, poi.position);
    if (d < bestDistance) {
      best = poi;
      bestDistance = d;
    }
  }
  return best;
}

/** The POIs of a named set, in order. Unknown ids are skipped. */
export function poisOfSet(index: MapIndex, setName: string): Poi[] {
  return (index.map.spawnSets[setName] ?? []).flatMap((poiId) => index.pois.get(poiId) ?? []);
}

/** Height of a POI above the ground: its own `y` if set, otherwise its floor's level. */
export function poiHeight(index: MapIndex, poi: Poi): number {
  return poi.y ?? index.floors.get(poi.floor)?.y ?? 0;
}
