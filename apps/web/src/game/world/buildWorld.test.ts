import { campusIndex, campusMap } from '@campus/map-data/campus';
import { DoubleSide, Ray, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildWorld } from './buildWorld';

const world = buildWorld(campusMap);
const down = new Vector3(0, -1, 0);

type Point3 = [x: number, y: number, z: number];

/** Height of the first surface under a point, like a foot looking for the floor. */
const floorBelow = (x: number, y: number, z: number) =>
  world.bvh.raycastFirst(new Ray(new Vector3(x, y, z), down), DoubleSide)?.point.y;

/** Distance to the first obstacle on the way from one point to another; Infinity if clear. */
const obstacle = (from: Point3, to: Point3) => {
  const origin = new Vector3(...from);
  const target = new Vector3(...to);
  const hit = world.bvh.raycastFirst(
    new Ray(origin, target.clone().sub(origin).normalize()),
    DoubleSide,
  );
  return hit && hit.distance <= origin.distanceTo(target) ? hit.distance : Number.POSITIVE_INFINITY;
};

describe('world budgets', () => {
  it('stays far inside the mobile budget of docs/03 §6', () => {
    expect(world.stats.drawCalls).toBeLessThan(60);
    expect(world.stats.triangles).toBeLessThan(150_000);
    expect(world.stats.colliderTriangles).toBeLessThan(40_000);
  });
});

describe('floors', () => {
  it('has ground at the gate and inside the atrium', () => {
    expect(floorBelow(21, 2, 39.5)).toBeCloseTo(0);
    expect(floorBelow(0, 2, 2)).toBeCloseTo(0);
  });

  it('has a slab on each upper floor and a roof on top', () => {
    expect(floorBelow(0, 7, -22)).toBeCloseTo(5);
    expect(floorBelow(0, 12, 24)).toBeCloseTo(9.5);
    expect(floorBelow(-100, 7, 20)).toBeCloseTo(5);
    expect(floorBelow(30, 20, 0)).toBeCloseTo(14.3);
  });

  it('leaves the atrium open from the ground to the skylight', () => {
    expect(floorBelow(0, 13.5, 2)).toBeCloseTo(0);
    expect(floorBelow(0, 30, 2)).toBeCloseTo(0);
  });

  it('puts a floor directly under every point of interest', () => {
    const floating = campusMap.pois.filter((poi) => {
      const level = campusIndex.floors.get(poi.floor)?.y ?? 0;
      const y = floorBelow(poi.position[0], level + 1.6, poi.position[1]);
      return y === undefined || Math.abs(y - level) > 0.05;
    });
    expect(floating.map((poi) => poi.id)).toEqual([]);
  });
});

describe('stairs', () => {
  it('are ramps rising evenly between floors', () => {
    // North grand stair: ground at z = -2, F2 at z = -12.
    expect(floorBelow(-8, 4, -4.5)).toBeCloseTo(1.25, 1);
    expect(floorBelow(-8, 6, -7)).toBeCloseTo(2.5, 1);
    expect(floorBelow(-8, 7, -11.9)).toBeCloseTo(4.95, 1);
  });

  it('cut their own well through the slab above', () => {
    // Flight from F2 (z = -16) to F3 (z = -26): halfway up, seen from above F3.
    expect(floorBelow(6, 12, -21)).toBeCloseTo(7.25, 1);
    expect(floorBelow(-95, 7, -5)).toBeCloseTo(2.5, 1);
  });

  it('are fenced in at the sides and around their well', () => {
    expect(obstacle([-8, 3.2, -7], [-12, 3.2, -7])).toBeLessThan(2.2);
    expect(obstacle([2, 10, -21], [5, 10, -21])).toBeLessThan(2.2);
  });
});

describe('walls and doors', () => {
  it('lets people through a doorway but not through the wall beside or above it', () => {
    expect(obstacle([0, 1.5, -40], [0, 1.5, -30])).toBe(Number.POSITIVE_INFINITY);
    expect(obstacle([20, 1.5, -40], [20, 1.5, -30])).toBeCloseTo(5.5, 0);
    expect(obstacle([0, 4, -40], [0, 4, -30])).toBeCloseTo(5.5, 0);
  });

  it('joins the two blocks on every floor', () => {
    for (const y of [1.5, 6.5, 11]) {
      expect(obstacle([-66, y, -16], [-52, y, -24])).toBe(Number.POSITIVE_INFINITY);
    }
  });

  it('guards the edge of the atrium on upper floors, except where stairs land', () => {
    expect(obstacle([0, 5.5, -14], [0, 5.5, -10])).toBeCloseTo(2, 0);
    expect(obstacle([-8, 5.6, -14], [-8, 5.6, -11])).toBe(Number.POSITIVE_INFINITY);
    expect(obstacle([0, 10, -14], [0, 10, -10])).toBeCloseTo(2, 0);
  });
});

describe('edges of the world', () => {
  it('stops people at the fence on every side', () => {
    expect(obstacle([0, 1, -50], [0, 1, -70])).toBeCloseTo(7, 0);
    // The west fence follows the hedge line beyond block 2 (map 0.2).
    expect(obstacle([-122, 1, 4], [-140, 1, 4])).toBeCloseTo(4, 0);
  });

  it('keeps people out of the fountain and the round planter, and lets them under the canopy', () => {
    expect(obstacle([21.5, 1, 42], [21.5, 1, 49])).toBeLessThan(5);
    expect(obstacle([-52.5, 0.5, 26], [-52.5, 0.5, 16])).toBeLessThan(8);
    expect(obstacle([21, 1.5, 41.5], [20.5, 1.5, 37.5])).toBe(Number.POSITIVE_INFINITY);
  });

  it('keeps people out of the pool and the koi pond', () => {
    expect(obstacle([61, 1, -20], [47, 1, -20])).toBeLessThan(10);
    expect(obstacle([-2, 1, 22], [-2, 1, 30])).toBeLessThan(6);
  });
});

describe('showUpTo', () => {
  it('hides the storeys above the chosen one', () => {
    world.showUpTo('F1');
    const visible = [...world.levels].filter(([, group]) => group.visible).map(([id]) => id);
    expect(visible).toEqual(['ground', 'F1']);
    world.showUpTo('ROOF');
    expect([...world.levels.values()].every((group) => group.visible)).toBe(true);
  });
});
