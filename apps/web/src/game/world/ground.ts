import {
  type Area,
  type CampusMap,
  closestPointOnSegment,
  type Polygon,
  pointInPolygon,
  polygonCentroid,
  type ReadonlyVec2,
  rect,
  type Vec2,
} from '@campus/map-data';
import { type BuildContext, LAYER } from './context';
import { PALETTE } from './palette';

const FENCE_HEIGHT = 1.4;
const FENCE_THICKNESS = 0.12;
/** Invisible walls are tall enough that nothing a player can do gets over them. */
const BARRIER_HEIGHT = 6;
const CURB_HEIGHT = 0.25;

const isInsideBuilding = (map: CampusMap, area: Area) =>
  map.structures.some((s) => pointInPolygon(polygonCentroid(area.polygon), s.footprint));

/** Where two segments cross, as a distance along the first one; undefined if they do not. */
function crossing(
  a: ReadonlyVec2,
  b: ReadonlyVec2,
  c: ReadonlyVec2,
  d: ReadonlyVec2,
): number | undefined {
  const rx = b[0] - a[0];
  const rz = b[1] - a[1];
  const sx = d[0] - c[0];
  const sz = d[1] - c[1];
  const denominator = rx * sz - rz * sx;
  if (Math.abs(denominator) < 1e-9) return undefined;
  const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / denominator;
  const u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t * Math.hypot(rx, rz) : undefined;
}

/** Splits a segment of the given length into the parts not covered by any gap. */
export function spansOutsideGaps(
  length: number,
  gaps: ReadonlyArray<readonly [number, number]>,
): Array<[number, number]> {
  const sorted = gaps
    .map(([from, to]) => [Math.max(0, from), Math.min(length, to)] as [number, number])
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0]);
  const spans: Array<[number, number]> = [];
  let cursor = 0;
  for (const [from, to] of sorted) {
    if (from > cursor + 1e-6) spans.push([cursor, from]);
    cursor = Math.max(cursor, to);
  }
  if (cursor < length - 1e-6) spans.push([cursor, length]);
  return spans;
}

export function along(a: ReadonlyVec2, b: ReadonlyVec2, distance: number): Vec2 {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [a[0] + ((b[0] - a[0]) * distance) / length, a[1] + ((b[1] - a[1]) * distance) / length];
}

/** A closed barrier along a polygon outline: collision only. */
function barrier(ctx: BuildContext, outline: Polygon, height = BARRIER_HEIGHT): void {
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i] as ReadonlyVec2;
    const b = outline[(i + 1) % outline.length] as ReadonlyVec2;
    ctx.collider.wall(a, b, 0.2, -1, height, PALETTE.fence);
  }
}

export function buildGround(ctx: BuildContext): void {
  const { map } = ctx;
  const ground = ctx.level('ground').solid;
  const { min, max } = map.meta.bounds;

  ground.polygon(rect(min[0], min[1], max[0], max[1]), LAYER.outside, PALETTE.outside);
  // One flat floor under the whole map. Slabs, stairs and walls are added on top of it.
  ctx.collider.polygon(rect(min[0] - 50, min[1] - 50, max[0] + 50, max[1] + 50), 0, PALETTE.grass);

  const groundFloor = map.floors[0]?.id ?? 'F1';
  const outdoors = map.areas.filter((area) => area.floor === groundFloor);

  for (const area of outdoors.filter((a) => a.kind === 'outdoor')) {
    if (area.tags.includes('base'))
      ctx.flat('site').polygon(area.polygon, LAYER.site, PALETTE.grass);
    else {
      const colour = area.tags.includes('green') ? PALETTE.park : PALETTE.paved;
      ctx.flat('tint').polygon(area.polygon, LAYER.tint, colour);
    }
  }

  for (const path of map.paths.filter((p) => p.floor === groundFloor)) {
    const layer = path.kind === 'road' ? 'road' : 'walkway';
    const colour = path.kind === 'road' ? PALETTE.road : PALETTE.walkway;
    ctx.flat(layer).ribbon(path.points, path.width, LAYER[layer], colour, path.closed);
  }

  // Water. The river lies outside the fence; pools and ponds get a curb and an invisible wall.
  for (const area of outdoors.filter((a) => a.kind === 'water')) {
    const fenced = map.areas.some(
      (site) =>
        site.tags.includes('base') &&
        site.kind === 'outdoor' &&
        pointInPolygon(polygonCentroid(area.polygon), site.polygon),
    );
    if (!fenced) {
      ground.polygon(area.polygon, LAYER.river, PALETTE.river);
      continue;
    }
    ctx.flat('water').polygon(area.polygon, LAYER.water, PALETTE.water);
    const batch = isInsideBuilding(map, area) ? ctx.level(groundFloor).solid : ground;
    for (let i = 0; i < area.polygon.length; i++) {
      const a = area.polygon[i] as ReadonlyVec2;
      const b = area.polygon[(i + 1) % area.polygon.length] as ReadonlyVec2;
      batch.wall(a, b, 0.3, 0, CURB_HEIGHT, PALETTE.curb);
    }
    barrier(ctx, area.polygon, 3);
  }

  // Fence around the site, open where a walkway or road passes through it. The opening is only
  // for show: the invisible barrier is closed all the way round, so nobody walks off the map.
  for (const site of outdoors.filter((a) => a.kind === 'outdoor' && a.tags.includes('base'))) {
    barrier(ctx, site.polygon);
    for (let i = 0; i < site.polygon.length; i++) {
      const a = site.polygon[i] as ReadonlyVec2;
      const b = site.polygon[(i + 1) % site.polygon.length] as ReadonlyVec2;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const gaps: Array<[number, number]> = [];
      for (const path of map.paths) {
        for (let k = 0; k < path.points.length - 1; k++) {
          const at = crossing(
            a,
            b,
            path.points[k] as ReadonlyVec2,
            path.points[k + 1] as ReadonlyVec2,
          );
          if (at !== undefined) gaps.push([at - path.width / 2 - 0.5, at + path.width / 2 + 0.5]);
        }
      }
      for (const [from, to] of spansOutsideGaps(length, gaps)) {
        ground.wall(
          along(a, b, from),
          along(a, b, to),
          FENCE_THICKNESS,
          LAYER.outside,
          FENCE_HEIGHT,
          PALETTE.fence,
        );
      }
      // Gate posts and a beam across each opening.
      for (const [from, to] of gaps) {
        const left = along(a, b, from);
        const right = along(a, b, to);
        for (const post of [left, right])
          ground.box([post[0], 1.8, post[1]], [0.8, 3.6, 0.8], PALETTE.wallAccent);
        ground.wall(left, right, 0.5, 3.6, 4.2, PALETTE.wall);
      }
    }
  }
}

/** Distance from a point to a segment, for callers that only need the number. */
export function distanceToSegment(p: ReadonlyVec2, a: ReadonlyVec2, b: ReadonlyVec2): number {
  return closestPointOnSegment(p, a, b).distance;
}
