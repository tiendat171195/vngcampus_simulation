import { createFloorProjection, type FloorId, renderFloorSvg } from '@campus/map-data';
import { campusIndex, campusMap } from '@campus/map-data/campus';
import { useEffect, useMemo, useRef, useState } from 'react';
import { hudSink } from '../game/core/session';

/** Map pixels per metre. */
const SCALE = 3;

/**
 * Round minimap in the corner: the floor the player is on, centred on them, with an arrow for
 * the direction they face. The map image is moved with CSS each frame, never re-rendered.
 */
export function MiniMap() {
  const [floor, setFloor] = useState<FloorId>('F1');
  const [expanded, setExpanded] = useState(false);
  const image = useRef<HTMLImageElement>(null);
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
      showLabels: true,
    });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, [floor, projection]);

  useEffect(() => {
    hudSink.player = (x, z, yaw, current) => {
      if (current !== floorRef.current && campusIndex.floors.has(current as FloorId)) {
        floorRef.current = current as FloorId;
        setFloor(current as FloorId);
      }
      const [px, py] = projection.toSvg([x, z]);
      if (image.current) image.current.style.transform = `translate(${-px}px, ${-py}px)`;
      // Yaw 0 faces +Z, which is down on the map; the arrow is drawn pointing up.
      if (marker.current)
        marker.current.style.transform = `translate(-50%, -50%) rotate(${Math.PI - yaw}rad)`;
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
      <img
        ref={image}
        src={src}
        alt=""
        width={projection.width}
        height={projection.height}
        draggable={false}
      />
      <div ref={marker} className="minimap-marker" />
      <span className="minimap-floor">{campusIndex.floors.get(floor)?.label.vi ?? floor}</span>
    </button>
  );
}
