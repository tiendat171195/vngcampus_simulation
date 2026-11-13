import {
  createFloorProjection,
  type FloorId,
  polygonArea,
  polygonCentroid,
  renderFloorSvg,
} from '@campus/map-data';
import { campusIndex, campusMap } from '@campus/map-data/campus';
import { useEffect, useMemo, useRef, useState } from 'react';
import { hudSink } from '../game/core/session';

/** Map pixels per metre. */
const SCALE = 3;
/** Areas smaller than this (in pixels across) get no label. */
const MIN_LABEL_SIZE = 40;

/**
 * Round minimap in the corner: the floor the player is on, centred on them and turned so that
 * "ahead" is up, with an arrow for the direction they face.
 *
 * The map and its labels sit in one layer that is moved with CSS each frame, never re-rendered.
 * Labels are separate elements so they can be turned back upright while the map turns.
 */
export function MiniMap() {
  const [floor, setFloor] = useState<FloorId>('F1');
  const [expanded, setExpanded] = useState(false);
  const layer = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLDivElement>(null);
  const floorRef = useRef<FloorId>('F1');

  const projection = useMemo(() => {
    const { min, max } = campusMap.meta.bounds;
    return createFloorProjection(campusMap, { width: (max[0] - min[0]) * SCALE });
  }, []);

  const src = useMemo(() => {
    const svg = renderFloorSvg(campusMap, floor, {
      width: projection.width,
      theme: 'dark',
      showProps: false,
      showLabels: false,
    });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, [floor, projection]);

  const labels = useMemo(
    () =>
      campusMap.areas
        .filter(
          (area) =>
            area.floor === floor &&
            !area.tags.includes('base') &&
            area.kind !== 'restricted' &&
            Math.sqrt(polygonArea(area.polygon)) * SCALE >= MIN_LABEL_SIZE,
        )
        .map((area) => {
          const [x, y] = projection.toSvg(polygonCentroid(area.polygon));
          return {
            id: area.id,
            name: area.name.vi,
            x,
            y,
            landmark: area.tags.includes('landmark'),
          };
        }),
    [floor, projection],
  );

  useEffect(() => {
    hudSink.player = (x, z, yaw, current, heading) => {
      if (current !== floorRef.current && campusIndex.floors.has(current as FloorId)) {
        floorRef.current = current as FloorId;
        setFloor(current as FloorId);
      }
      const [px, py] = projection.toSvg([x, z]);
      // Heading-up: the camera's forward direction points up. The layer's corner sits at the
      // centre of the circle, so translating first puts the player there and the rotation then
      // happens around them.
      const turn = heading - Math.PI;
      const element = layer.current;
      if (element) {
        element.style.transform = `rotate(${turn}rad) translate(${-px}px, ${-py}px)`;
        element.style.setProperty('--upright', `${-turn}rad`);
      }
      if (marker.current) {
        marker.current.style.transform = `translate(-50%, -50%) rotate(${heading - yaw}rad)`;
      }
    };
    return () => {
      hudSink.player = null;
    };
  }, [projection]);

  return (
    <button
      type="button"
      className="minimap"
      data-expanded={expanded}
      aria-label={expanded ? 'Thu nhỏ bản đồ' : 'Phóng to bản đồ'}
      onClick={() => setExpanded(!expanded)}
    >
      <div ref={layer} className="minimap-layer">
        <img
          src={src}
          alt=""
          width={projection.width}
          height={projection.height}
          draggable={false}
        />
        {labels.map((label) => (
          <span
            key={label.id}
            className="minimap-label"
            data-landmark={label.landmark}
            style={{ left: label.x, top: label.y }}
          >
            {label.name}
          </span>
        ))}
      </div>
      <div ref={marker} className="minimap-marker" />
      <span className="minimap-floor">{campusIndex.floors.get(floor)?.label.vi ?? floor}</span>
    </button>
  );
}
