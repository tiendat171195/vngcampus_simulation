import {
  areasAt,
  createFloorProjection,
  distance,
  type FloorId,
  renderFloorSvg,
} from '@campus/map-data';
import { campusIndex, campusMap } from '@campus/map-data/campus';
import { type MouseEvent, useMemo, useState } from 'react';

const WIDTH = 760;
const FLOORS = campusMap.floors.map((floor) => floor.id as FloorId);

export type Pick = { kind: 'area'; id: string } | { kind: 'poi'; id: string };

/**
 * The campus floor by floor (docs/08 §4.2), drawn with the same function as the game's map.
 * Clicking picks the nearest POI within 4 m, or else the area under the cursor; what is already
 * chosen is highlighted.
 */
export function MapPicker({
  selected,
  onPick,
  poiKinds,
}: {
  selected: string[];
  onPick: (pick: Pick) => void;
  /** Only these POI kinds can be picked (kiosks for a quiz); areas only when absent. */
  poiKinds?: string[];
}) {
  const [floor, setFloor] = useState<FloorId>(FLOORS[0] ?? ('F1' as FloorId));
  const [hover, setHover] = useState<string>('');
  const projection = useMemo(() => createFloorProjection(campusMap, { width: WIDTH }), []);
  const svg = useMemo(
    () => renderFloorSvg(campusMap, floor, { width: WIDTH, highlight: selected, showProps: false }),
    [floor, selected],
  );

  const pickAt = (event: MouseEvent<HTMLButtonElement>): Pick | null => {
    const box = event.currentTarget.getBoundingClientRect();
    const point = projection.fromSvg([
      ((event.clientX - box.left) / box.width) * projection.width,
      ((event.clientY - box.top) / box.height) * projection.height,
    ]);
    let best: Pick | null = null;
    let bestDistance = 4;
    for (const poi of campusIndex.pois.values()) {
      if (poi.floor !== floor || (poiKinds && !poiKinds.includes(poi.kind))) continue;
      const d = distance(poi.position, point);
      if (d < bestDistance) {
        bestDistance = d;
        best = { kind: 'poi', id: poi.id };
      }
    }
    if (best || poiKinds) return best;
    const area = areasAt(campusIndex, point, floor).find(
      (candidate) => !candidate.tags.includes('base'),
    );
    return area ? { kind: 'area', id: area.id } : null;
  };

  const label = (id: string) =>
    campusIndex.areas.get(id)?.name.vi ?? campusIndex.pois.get(id)?.name?.vi ?? id;

  return (
    <div className="map-picker">
      <div className="map-floors">
        {FLOORS.map((id) => (
          <button key={id} type="button" aria-pressed={id === floor} onClick={() => setFloor(id)}>
            {id === 'ROOF' ? 'Mái' : `Tầng ${id.slice(1)}`}
          </button>
        ))}
        <span className="muted">
          {hover ? `Bấm để chọn: ${label(hover)}` : 'Di chuột lên bản đồ để chọn'}
        </span>
      </div>
      <button
        type="button"
        className="map-canvas"
        aria-label="Bản đồ: bấm để chọn địa điểm"
        // The SVG comes from our own map renderer, not from user input.
        dangerouslySetInnerHTML={{ __html: svg }}
        onMouseMove={(event) => setHover(pickAt(event)?.id ?? '')}
        onMouseLeave={() => setHover('')}
        onClick={(event) => {
          const pick = pickAt(event);
          if (pick) onPick(pick);
        }}
      />
    </div>
  );
}
