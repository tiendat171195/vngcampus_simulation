import { campusIndex } from '@campus/map-data/campus';
import { missionDefinitionSchema } from '@campus/shared';
import { exampleMission } from '@campus/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { missionMapProblems } from './validate';

describe('missions against the map', () => {
  it('finds every place of the documented example on the campus', () => {
    expect(missionMapProblems(missionDefinitionSchema.parse(exampleMission), campusIndex)).toEqual(
      [],
    );
  });

  it('names the places that are missing', () => {
    const [visit, , collect, quiz] = exampleMission.objectives;
    const mission = missionDefinitionSchema.parse({
      ...exampleMission,
      objectives: [
        { ...visit, params: { targets: [{ areaId: 'area.moon' }, { poiId: 'poi.nowhere' }] } },
        { ...collect, params: { item: 'cup', source: { spawnSet: 'mars' } } },
        { ...quiz, params: { ...(quiz?.params as object), at: { poiId: 'poi.kiosk.gone' } } },
      ],
    });
    expect(missionMapProblems(mission, campusIndex)).toEqual([
      'Mục tiêu o1: không có khu vực "area.moon" trên bản đồ.',
      'Mục tiêu o1: không có điểm "poi.nowhere" trên bản đồ.',
      'Mục tiêu o3: không có bộ điểm "mars".',
      'Mục tiêu o4: không có điểm "poi.kiosk.gone" trên bản đồ.',
    ]);
  });
});
