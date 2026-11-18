import { poiHeight } from '@campus/map-data';
import { campusIndex } from '@campus/map-data/campus';
import type { MissionEntity, MissionView } from '@campus/shared';
import { itemName } from './labels';
import type { Tracked } from './missionStore';

export interface WaypointTarget {
  x: number;
  y: number;
  z: number;
  label: string;
}

const floorY = (floor: string) => campusIndex.floors.get(floor as never)?.y ?? 0;

/** Middle of an area, good enough to point at. */
function areaCentre(areaId: string): WaypointTarget | null {
  const area = campusIndex.areas.get(areaId);
  if (!area) return null;
  let x = 0;
  let z = 0;
  for (const [px, pz] of area.polygon) {
    x += px;
    z += pz;
  }
  return {
    x: x / area.polygon.length,
    y: floorY(area.floor),
    z: z / area.polygon.length,
    label: area.name.vi,
  };
}

/**
 * Where to point for the tracked objective (docs/06 §8): the nearest place still to visit, the
 * nearest own item, or the kiosk. Social objectives have no place: null.
 */
export function waypointTarget(
  tracked: Tracked | null,
  missions: MissionView[],
  entities: MissionEntity[],
  from: { x: number; z: number },
): WaypointTarget | null {
  if (!tracked) return null;
  const objective = missions
    .find((mission) => mission.id === tracked.missionId)
    ?.objectives.find((o) => o.id === tracked.objectiveId);
  if (!objective || objective.done) return null;
  const candidates: WaypointTarget[] = [];
  if (objective.type === 'visit') {
    const targets =
      (objective.view as { targets?: Array<{ areaId?: string; poiId?: string; reached: boolean }> })
        ?.targets ?? [];
    for (const target of targets) {
      if (target.reached) continue;
      if (target.areaId) {
        const centre = areaCentre(target.areaId);
        if (centre) candidates.push(centre);
      } else if (target.poiId) {
        const poi = campusIndex.pois.get(target.poiId);
        if (poi)
          candidates.push({
            x: poi.position[0],
            y: poiHeight(campusIndex, poi),
            z: poi.position[1],
            label: poi.name?.vi ?? 'Điểm đến',
          });
      }
    }
  } else {
    for (const entity of entities)
      if (entity.missionId === tracked.missionId && entity.objectiveId === tracked.objectiveId)
        candidates.push({
          x: entity.x,
          y: entity.y,
          z: entity.z,
          label: entity.kind === 'kiosk' ? 'Kiosk câu hỏi' : itemName(entity.item),
        });
  }
  let best: WaypointTarget | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const d = Math.hypot(candidate.x - from.x, candidate.z - from.z);
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return best;
}
