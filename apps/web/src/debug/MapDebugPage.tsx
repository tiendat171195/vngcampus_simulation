import {
  createFloorProjection,
  distance,
  type FloorId,
  findArea,
  isWalkable,
  type PoiKind,
  renderFloorSvg,
  type Vec2,
} from '@campus/map-data';
import { campusIndex, campusMap } from '@campus/map-data/campus';
import { type MouseEvent, useMemo, useState } from 'react';
import './map-debug.css';

const FLOORS: FloorId[] = ['F1', 'F2', 'F3'];
const WIDTH = 1400;

const POI_LEGEND: Array<{ kind: PoiKind; label: string; colour: string }> = [
  { kind: 'spawn', label: 'Điểm xuất hiện', colour: '#1c7ed6' },
  { kind: 'checkpoint', label: 'Checkpoint', colour: '#e8590c' },
  { kind: 'seat', label: 'Ghế', colour: '#7048e8' },
  { kind: 'npc_spot', label: 'Vị trí NPC', colour: '#d6336c' },
  { kind: 'kiosk_spot', label: 'Kiosk', colour: '#0ca678' },
  { kind: 'photo_spot', label: 'Điểm chụp ảnh', colour: '#f08c00' },
  { kind: 'item_spot', label: 'Điểm rải vật phẩm', colour: '#868e96' },
];

/** Developer page: the campus map floor by floor, with the coordinates under the cursor. */
export default function MapDebugPage() {
  const [floor, setFloor] = useState<FloorId>('F1');
  const [showPois, setShowPois] = useState(true);
  const [showProps, setShowProps] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const projection = useMemo(() => createFloorProjection(campusMap, { width: WIDTH }), []);
  const image = useMemo(() => {
    const svg = renderFloorSvg(campusMap, floor, { width: WIDTH, showPois, showProps, showLabels });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, [floor, showPois, showProps, showLabels]);

  const pointAt = (event: MouseEvent<HTMLImageElement>): Vec2 => {
    const box = event.currentTarget.getBoundingClientRect();
    const [x, z] = projection.fromSvg([
      ((event.clientX - box.left) / box.width) * projection.width,
      ((event.clientY - box.top) / box.height) * projection.height,
    ]);
    return [Math.round(x * 10) / 10, Math.round(z * 10) / 10];
  };

  const copy = (point: Vec2) => {
    const text = `[${point[0]}, ${point[1]}]`;
    navigator.clipboard?.writeText(text).then(
      () => setCopied(text),
      () => setCopied(null),
    );
  };

  const area = cursor && findArea(campusIndex, cursor, floor);
  const poi =
    cursor &&
    campusMap.pois.find((p) => p.floor === floor && distance(p.position, cursor) < 1.2 && showPois);
  const poiCounts = POI_LEGEND.map((entry) => ({
    ...entry,
    count: campusMap.pois.filter((p) => p.floor === floor && p.kind === entry.kind).length,
  }));

  return (
    <main className="map-debug">
      <header>
        <h1>Bản đồ campus</h1>
        <span className="muted">phiên bản {campusMap.version}</span>
        <div className="tabs" role="tablist" aria-label="Tầng">
          {FLOORS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={id === floor}
              onClick={() => setFloor(id)}
            >
              {campusIndex.floors.get(id)?.label.vi ?? id}
            </button>
          ))}
        </div>
        <label>
          <input
            type="checkbox"
            checked={showPois}
            onChange={(e) => setShowPois(e.target.checked)}
          />{' '}
          POI
        </label>
        <label>
          <input
            type="checkbox"
            checked={showProps}
            onChange={(e) => setShowProps(e.target.checked)}
          />{' '}
          Đạo cụ
        </label>
        <label>
          <input
            type="checkbox"
            checked={showLabels}
            onChange={(e) => setShowLabels(e.target.checked)}
          />{' '}
          Nhãn
        </label>
      </header>

      <div className="canvas">
        <img
          src={image}
          alt={`Sơ đồ ${campusIndex.floors.get(floor)?.label.vi ?? floor}`}
          width={projection.width}
          height={projection.height}
          onMouseMove={(event) => setCursor(pointAt(event))}
          onMouseLeave={() => setCursor(null)}
          onClick={(event) => copy(pointAt(event))}
          onKeyDown={() => {}}
        />
      </div>

      <footer>
        <dl data-testid="cursor-info">
          <dt>Toạ độ [x, z]</dt>
          <dd>{cursor ? `${cursor[0]}, ${cursor[1]}` : '—'}</dd>
          <dt>Khu vực</dt>
          <dd>{area ? `${area.name.vi} (${area.id})` : '—'}</dd>
          <dt>Đứng được</dt>
          <dd>{cursor ? (isWalkable(campusIndex, cursor, floor) ? 'có' : 'không') : '—'}</dd>
          <dt>POI</dt>
          <dd>{poi ? `${poi.name?.vi ?? poi.kind} (${poi.id})` : '—'}</dd>
        </dl>
        <ul className="legend">
          {poiCounts.map((entry) => (
            <li key={entry.kind}>
              <span className="swatch" style={{ background: entry.colour }} />
              {entry.label}: {entry.count}
            </li>
          ))}
        </ul>
        <p className="muted">
          Bấm vào bản đồ để chép toạ độ. {copied && <strong>Đã chép {copied}</strong>}
        </p>
      </footer>
    </main>
  );
}
