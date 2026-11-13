import { describe, expect, it } from 'vitest';
import type { Vec2 } from './frame';
import {
  boundsOf,
  closestPointOnSegment,
  ellipse,
  nearestEdge,
  pointAlongPolyline,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  polylineLength,
  rect,
  stripPolygon,
  yawDegOf,
} from './geometry';

const square = rect(0, 0, 10, 10);
// An "L": a 10×10 square with the top-right 5×5 quadrant removed.
const lShape: Vec2[] = [
  [0, 0],
  [5, 0],
  [5, 5],
  [10, 5],
  [10, 10],
  [0, 10],
];

describe('pointInPolygon', () => {
  it('separates inside from outside on a convex shape', () => {
    expect(pointInPolygon([5, 5], square)).toBe(true);
    expect(pointInPolygon([-0.1, 5], square)).toBe(false);
    expect(pointInPolygon([5, 10.1], square)).toBe(false);
  });

  it('respects the notch of a concave shape', () => {
    expect(pointInPolygon([2, 2], lShape)).toBe(true);
    expect(pointInPolygon([8, 8], lShape)).toBe(true);
    expect(pointInPolygon([8, 2], lShape)).toBe(false);
  });
});

describe('area and centroid', () => {
  it('measures area regardless of winding', () => {
    expect(polygonArea(square)).toBeCloseTo(100);
    expect(polygonArea([...square].reverse())).toBeCloseTo(100);
    expect(polygonArea(lShape)).toBeCloseTo(75);
  });

  it('finds the centroid', () => {
    expect(polygonCentroid(square)).toEqual([5, 5]);
    const [cx, cz] = polygonCentroid(lShape);
    expect(cx).toBeCloseTo(4.1667, 3);
    expect(cz).toBeCloseTo(5.8333, 3);
  });

  it('approximates an ellipse', () => {
    expect(polygonArea(ellipse([0, 0], 6, 3, 64))).toBeCloseTo(Math.PI * 18, 0);
  });
});

describe('edges and segments', () => {
  it('clamps the closest point to the segment', () => {
    expect(closestPointOnSegment([5, 3], [0, 0], [10, 0])).toMatchObject({ point: [5, 0], t: 0.5 });
    expect(closestPointOnSegment([-4, 3], [0, 0], [10, 0])).toMatchObject({ point: [0, 0], t: 0 });
  });

  it('reports which edge is nearest', () => {
    expect(nearestEdge([5, -2], square)).toMatchObject({ edge: 0, distance: 2 });
    expect(nearestEdge([12, 5], square)).toMatchObject({ edge: 1, distance: 2 });
    expect(nearestEdge([1, 5], square)).toMatchObject({ edge: 3, distance: 1 });
  });
});

describe('polylines', () => {
  const path: Vec2[] = [
    [0, 0],
    [10, 0],
    [10, 5],
  ];

  it('measures open and closed length', () => {
    expect(polylineLength(path)).toBe(15);
    expect(polylineLength(path, true)).toBeCloseTo(15 + Math.hypot(10, 5));
  });

  it('walks along the line and reports the heading', () => {
    expect(pointAlongPolyline(path, 4)).toEqual({ point: [4, 0], direction: [1, 0] });
    expect(pointAlongPolyline(path, 12)).toEqual({ point: [10, 2], direction: [0, 1] });
    expect(pointAlongPolyline(path, 999).point).toEqual([10, 5]);
  });
});

describe('helpers', () => {
  it('builds a strip around a centre line', () => {
    const strip = stripPolygon([0, 0], [0, 10], 4);
    expect(boundsOf(strip)).toEqual({ min: [-2, 0], max: [2, 10] });
    expect(polygonArea(strip)).toBeCloseTo(40);
  });

  it('converts a direction to yaw with 0° facing +Z', () => {
    expect(yawDegOf([0, 1])).toBeCloseTo(0);
    expect(yawDegOf([1, 0])).toBeCloseTo(90);
    expect(yawDegOf([0, -1])).toBeCloseTo(180);
    expect(yawDegOf([-1, 0])).toBeCloseTo(-90);
  });
});
