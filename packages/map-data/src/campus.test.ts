import { describe, expect, it } from 'vitest';
import { campusIndex, campusMap } from './campus';
import { CAMPUS_FRAME } from './frame';
import {
  areasAt,
  findArea,
  floorAt,
  isInside,
  isWalkable,
  nearestPoi,
  poiHeight,
  poisOfSet,
} from './query';
import { campusMapSchema } from './schema';

describe('campus map', () => {
  it('satisfies the schema', () => {
    const result = campusMapSchema.safeParse(campusMap);
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it('is anchored to the campus frame', () => {
    expect(campusMap.meta.origin).toEqual(CAMPUS_FRAME.origin);
    expect(campusMap.meta.xAxisBearingDeg).toBe(CAMPUS_FRAME.xAxisBearingDeg);
  });

  it('has the landmarks the product is built around', () => {
    for (const id of [
      'area.gate_main',
      'area.lobby',
      'area.atrium',
      'area.canteen',
      'area.koi',
      'area.pool',
      'area.riverside',
    ]) {
      expect(campusIndex.areas.has(id), id).toBe(true);
    }
  });
});

describe('floorAt', () => {
  it('maps heights to floors, snapping the last stair steps upward', () => {
    expect(floorAt(campusIndex, 0)).toBe('F1');
    expect(floorAt(campusIndex, 2.5)).toBe('F1');
    expect(floorAt(campusIndex, 4.8)).toBe('F2');
    expect(floorAt(campusIndex, 5)).toBe('F2');
    expect(floorAt(campusIndex, 9.6)).toBe('F3');
    expect(floorAt(campusIndex, -3)).toBe('F1');
  });

  it('never reports the roof as a floor to stand on', () => {
    expect(floorAt(campusIndex, 30)).toBe('F3');
  });
});

describe('areas', () => {
  it('returns the most specific area first', () => {
    expect(findArea(campusIndex, [0, 2], 'F1')?.id).toBe('area.atrium');
    expect(areasAt(campusIndex, [0, 2], 'F1').map((area) => area.id)).toEqual([
      'area.atrium',
      'area.main.f1',
      'area.site',
    ]);
    expect(findArea(campusIndex, [-2, 30], 'F1')?.id).toBe('area.koi_pond');
    expect(findArea(campusIndex, [0, -52], 'F1')?.id).toBe('area.gate_main');
  });

  it('keeps floors apart', () => {
    expect(findArea(campusIndex, [0, -22], 'F2')?.id).toBe('area.office.f2.main');
    expect(findArea(campusIndex, [0, -22], 'F3')?.id).toBe('area.office.f3.main');
  });

  it('finds nothing outside the map', () => {
    expect(findArea(campusIndex, [0, -80], 'F1')).toBeUndefined();
    expect(isInside(campusIndex, 'area.atrium', [0, 2])).toBe(true);
    expect(isInside(campusIndex, 'area.nowhere', [0, 2])).toBe(false);
  });
});

describe('isWalkable', () => {
  it('accepts open ground and indoor floors', () => {
    expect(isWalkable(campusIndex, [0, -52], 'F1')).toBe(true);
    expect(isWalkable(campusIndex, [0, 2], 'F1')).toBe(true);
    expect(isWalkable(campusIndex, [0, -22], 'F2')).toBe(true);
  });

  it('rejects water, solid kiosks and anything beyond the fence', () => {
    expect(isWalkable(campusIndex, [-2, 30], 'F1')).toBe(false);
    expect(isWalkable(campusIndex, [0, 105], 'F1')).toBe(false);
    expect(isWalkable(campusIndex, [-12, -54], 'F1')).toBe(false);
    expect(isWalkable(campusIndex, [0, -70], 'F1')).toBe(false);
    expect(isWalkable(campusIndex, [500, 500], 'F1')).toBe(false);
  });

  it('rejects the atrium void and stairwells on upper floors', () => {
    expect(isWalkable(campusIndex, [0, 2], 'F2')).toBe(false);
    expect(isWalkable(campusIndex, [0, 2], 'F3')).toBe(false);
    expect(isWalkable(campusIndex, [6, -21], 'F3')).toBe(false);
    expect(isWalkable(campusIndex, [-120, 60], 'F2')).toBe(false);
  });
});

describe('points of interest', () => {
  it('resolves named sets in order', () => {
    const spawns = poisOfSet(campusIndex, 'players_gate');
    expect(spawns).toHaveLength(8);
    expect(spawns.every((poi) => poi.kind === 'spawn')).toBe(true);
    expect(poisOfSet(campusIndex, 'race_loop').map((poi) => poi.id)).toEqual(
      campusMap.spawnSets.race_loop,
    );
    expect(poisOfSet(campusIndex, 'no_such_set')).toEqual([]);
  });

  it('finds the nearest POI of a kind', () => {
    expect(nearestPoi(campusIndex, 'checkpoint', [1, 1])?.id).toBe('poi.checkpoint.atrium');
    expect(nearestPoi(campusIndex, 'checkpoint', [1, 1], 'F3')?.id).toBe(
      'poi.checkpoint.office_f3',
    );
  });

  it('puts POIs at their floor level', () => {
    const kiosk = campusIndex.pois.get('poi.kiosk.office_f2');
    expect(kiosk && poiHeight(campusIndex, kiosk)).toBe(5);
  });
});
