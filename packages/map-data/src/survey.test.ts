import { describe, expect, it } from 'vitest';
import { campusIndex, campusMap } from './campus';
import { pointInPolygon, polygonCentroid } from './geometry';
import { isWalkable } from './query';
import { findSurveyStation, SURVEY_ZONES } from './survey';

const withOutline = SURVEY_ZONES.filter((zone) => zone.outline);

describe('photo survey zones', () => {
  it('have unique, well-formed codes and numbered stations', () => {
    const codes = SURVEY_ZONES.map((zone) => zone.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const zone of SURVEY_ZONES) {
      expect(zone.code).toMatch(/^(SD|H|NT|T[1-3]|B1|M)-\d\d$/);
      expect(
        zone.stations.map((station) => station.id),
        zone.code,
      ).toEqual(zone.stations.map((_, i) => `S${i + 1}`));
      expect(zone.shots.length, zone.code).toBeGreaterThan(0);
      // A zone is either on the map or says how to find it.
      expect(Boolean(zone.outline) || Boolean(zone.where), zone.code).toBe(true);
    }
  });

  it('puts every standing point inside its zone, on ground one can stand on', () => {
    for (const zone of withOutline) {
      for (const station of zone.stations) {
        const id = `${zone.code}.${station.id}`;
        expect(pointInPolygon(station.at, zone.outline ?? []), `${id} inside`).toBe(true);
        expect(isWalkable(campusIndex, station.at, zone.floor), `${id} walkable`).toBe(true);
        expect(
          Math.hypot(station.look[0] - station.at[0], station.look[1] - station.at[1]),
          `${id} looks somewhere`,
        ).toBeGreaterThan(3);
        expect(findSurveyStation(id)?.station).toBe(station);
      }
    }
  });

  it('covers every named place on the map', () => {
    const skip = new Set(['area.site', 'area.river']);
    const missing = campusMap.areas
      .filter((area) => !area.tags.includes('base') && !skip.has(area.id))
      .filter(
        (area) =>
          !withOutline.some(
            (zone) =>
              zone.floor === area.floor &&
              pointInPolygon(polygonCentroid(area.polygon), zone.outline ?? []),
          ),
      )
      .map((area) => area.id);
    expect(missing).toEqual([]);
  });

  it('starts with the evacuation plans, the one source that places every room', () => {
    const [first] = SURVEY_ZONES;
    expect(first?.code).toBe('SD-01');
    expect(first?.priority).toBe(1);
  });
});
