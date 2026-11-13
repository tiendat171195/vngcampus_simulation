import type { MapIndex } from '@campus/map-data';
import type { MissionDefinition } from '@campus/shared';

/**
 * Places a mission refers to that the map does not have (docs/06 §10): such a mission cannot be
 * published. Returns one readable line per problem, empty when the mission fits the map.
 */
export function missionMapProblems(mission: MissionDefinition, index: MapIndex): string[] {
  const problems: string[] = [];
  const area = (id: string, where: string) => {
    if (!index.areas.has(id)) problems.push(`${where}: không có khu vực "${id}" trên bản đồ.`);
  };
  const poi = (id: string, where: string) => {
    if (!index.pois.has(id)) problems.push(`${where}: không có điểm "${id}" trên bản đồ.`);
  };
  for (const objective of mission.objectives) {
    const where = `Mục tiêu ${objective.id}`;
    switch (objective.type) {
      case 'visit':
        for (const target of objective.params.targets)
          if ('areaId' in target) area(target.areaId, where);
          else poi(target.poiId, where);
        break;
      case 'collect': {
        const set = index.map.spawnSets[objective.params.source.spawnSet];
        if (!set)
          problems.push(`${where}: không có bộ điểm "${objective.params.source.spawnSet}".`);
        else if (set.length < objective.target)
          problems.push(
            `${where}: bộ điểm chỉ có ${set.length} chỗ, không đủ ${objective.target} vật phẩm.`,
          );
        break;
      }
      case 'quiz':
        poi(objective.params.at.poiId, where);
        break;
      case 'social':
        break;
    }
  }
  return problems;
}
