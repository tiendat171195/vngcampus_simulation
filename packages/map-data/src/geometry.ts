/**
 * Plane geometry on a floor. Everything works on `Vec2 = [x, z]` in campus-local metres and is
 * pure, so the same code runs in the browser, the realtime server and the admin tools.
 * Polygons are open rings: the last vertex connects back to the first.
 */
import type { ReadonlyVec2, Vec2 } from './frame';

export type Polygon = readonly ReadonlyVec2[];

export interface Bounds2 {
  min: Vec2;
  max: Vec2;
}

export function distance(a: ReadonlyVec2, b: ReadonlyVec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function lerp(a: ReadonlyVec2, b: ReadonlyVec2, t: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Signed area: positive when the vertices run clockwise as drawn with X right and Z down. */
export function signedArea(polygon: Polygon): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, z1] = polygon[i] as ReadonlyVec2;
    const [x2, z2] = polygon[(i + 1) % polygon.length] as ReadonlyVec2;
    sum += x1 * z2 - x2 * z1;
  }
  return sum / 2;
}

export function polygonArea(polygon: Polygon): number {
  return Math.abs(signedArea(polygon));
}

export function polygonCentroid(polygon: Polygon): Vec2 {
  const area = signedArea(polygon);
  if (Math.abs(area) < 1e-9) return boundsCenter(boundsOf(polygon));
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [x1, z1] = polygon[i] as ReadonlyVec2;
    const [x2, z2] = polygon[(i + 1) % polygon.length] as ReadonlyVec2;
    const cross = x1 * z2 - x2 * z1;
    cx += (x1 + x2) * cross;
    cz += (z1 + z2) * cross;
  }
  return [cx / (6 * area), cz / (6 * area)];
}

export function boundsOf(points: readonly ReadonlyVec2[]): Bounds2 {
  let minX = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const [x, z] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minZ], max: [maxX, maxZ] };
}

export function boundsCenter(bounds: Bounds2): Vec2 {
  return [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2];
}

export function boundsContain(bounds: Bounds2, [x, z]: ReadonlyVec2): boolean {
  return x >= bounds.min[0] && x <= bounds.max[0] && z >= bounds.min[1] && z <= bounds.max[1];
}

/** Even-odd test. Points exactly on an edge may land on either side. */
export function pointInPolygon([x, z]: ReadonlyVec2, polygon: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i] as ReadonlyVec2;
    const [xj, zj] = polygon[j] as ReadonlyVec2;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export interface SegmentHit {
  /** Closest point on the segment. */
  point: Vec2;
  /** Position of that point along the segment, 0 at `a` and 1 at `b`. */
  t: number;
  distance: number;
}

export function closestPointOnSegment(
  p: ReadonlyVec2,
  a: ReadonlyVec2,
  b: ReadonlyVec2,
): SegmentHit {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const lengthSq = dx * dx + dz * dz;
  const t =
    lengthSq === 0
      ? 0
      : Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / lengthSq));
  const point: Vec2 = [a[0] + dx * t, a[1] + dz * t];
  return { point, t, distance: distance(p, point) };
}

export interface EdgeHit extends SegmentHit {
  /** Index of the edge's first vertex. */
  edge: number;
}

/** The polygon edge nearest to a point. */
export function nearestEdge(p: ReadonlyVec2, polygon: Polygon): EdgeHit {
  let best: EdgeHit | undefined;
  for (let i = 0; i < polygon.length; i++) {
    const hit = closestPointOnSegment(
      p,
      polygon[i] as ReadonlyVec2,
      polygon[(i + 1) % polygon.length] as ReadonlyVec2,
    );
    if (!best || hit.distance < best.distance) best = { ...hit, edge: i };
  }
  if (!best) throw new RangeError('Polygon has no vertices');
  return best;
}

/** Distance from a point to the polygon's outline (not its interior). */
export function distanceToOutline(p: ReadonlyVec2, polygon: Polygon): number {
  return nearestEdge(p, polygon).distance;
}

export function polylineLength(points: readonly ReadonlyVec2[], closed = false): number {
  let total = 0;
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    total += distance(points[i] as ReadonlyVec2, points[(i + 1) % points.length] as ReadonlyVec2);
  }
  return total;
}

/** Point and heading at a distance along a polyline; the distance is clamped to its length. */
export function pointAlongPolyline(
  points: readonly ReadonlyVec2[],
  along: number,
  closed = false,
): { point: Vec2; direction: Vec2 } {
  const count = closed ? points.length : points.length - 1;
  let remaining = Math.max(0, along);
  for (let i = 0; i < count; i++) {
    const a = points[i] as ReadonlyVec2;
    const b = points[(i + 1) % points.length] as ReadonlyVec2;
    const length = distance(a, b);
    if (remaining <= length || i === count - 1) {
      const t = length === 0 ? 0 : Math.min(1, remaining / length);
      const direction: Vec2 =
        length === 0 ? [1, 0] : [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
      return { point: lerp(a, b, t), direction };
    }
    remaining -= length;
  }
  throw new RangeError('Polyline needs at least two points');
}

/** Axis-aligned rectangle as a polygon. */
export function rect(x0: number, z0: number, x1: number, z1: number): Vec2[] {
  const [minX, maxX] = x0 < x1 ? [x0, x1] : [x1, x0];
  const [minZ, maxZ] = z0 < z1 ? [z0, z1] : [z1, z0];
  return [
    [minX, minZ],
    [maxX, minZ],
    [maxX, maxZ],
    [minX, maxZ],
  ];
}

/** Regular polygon approximating an ellipse. */
export function ellipse(
  center: ReadonlyVec2,
  radiusX: number,
  radiusZ: number,
  segments = 16,
): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push([center[0] + Math.cos(angle) * radiusX, center[1] + Math.sin(angle) * radiusZ]);
  }
  return points;
}

/**
 * The rectangle swept by a straight strip from `from` to `to` with the given width, as a polygon.
 * Used for stairs and ramps.
 */
export function stripPolygon(from: ReadonlyVec2, to: ReadonlyVec2, width: number): Vec2[] {
  const length = distance(from, to);
  if (length === 0) throw new RangeError('Strip needs two distinct points');
  const nx = (-(to[1] - from[1]) / length) * (width / 2);
  const nz = ((to[0] - from[0]) / length) * (width / 2);
  return [
    [from[0] + nx, from[1] + nz],
    [to[0] + nx, to[1] + nz],
    [to[0] - nx, to[1] - nz],
    [from[0] - nx, from[1] - nz],
  ];
}

/** Heading of a direction vector as a yaw in degrees: 0° faces +Z, 90° faces +X. */
export function yawDegOf(direction: ReadonlyVec2): number {
  return (Math.atan2(direction[0], direction[1]) * 180) / Math.PI;
}

export function roundVec(point: ReadonlyVec2, decimals = 2): Vec2 {
  const factor = 10 ** decimals;
  return [Math.round(point[0] * factor) / factor, Math.round(point[1] * factor) / factor];
}
