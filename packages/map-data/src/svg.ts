/**
 * Draws one floor of a map as an SVG string. Pure string building, so it works in Node and in
 * the browser; it backs the debug page, the in-game minimap and the admin position picker.
 */
import type { ReadonlyVec2, Vec2 } from './frame';
import { type Bounds2, nearestEdge, polygonArea, polygonCentroid } from './geometry';
import { connectorFootprint } from './query';
import type { Area, CampusMap, FloorId, Poi, PoiKind } from './schema';

export interface FloorSvgOptions {
  /** Output width in pixels. Height follows the aspect ratio of the view. */
  width?: number;
  /** Part of the map to draw, in metres. Defaults to the whole map. */
  view?: Bounds2;
  showLabels?: boolean;
  showProps?: boolean;
  /** `true` for every POI, or the kinds to include. */
  showPois?: boolean | readonly PoiKind[];
  /** Area ids to outline strongly. */
  highlight?: readonly string[];
  theme?: 'light' | 'dark';
}

export interface FloorProjection {
  width: number;
  height: number;
  /** Pixels per metre. */
  scale: number;
  toSvg(point: ReadonlyVec2): Vec2;
  fromSvg(point: ReadonlyVec2): Vec2;
}

/** The mapping between map metres and SVG pixels that `renderFloorSvg` uses for the same options. */
export function createFloorProjection(
  map: CampusMap,
  options: Pick<FloorSvgOptions, 'width' | 'view'> = {},
): FloorProjection {
  const view = options.view ?? map.meta.bounds;
  const width = options.width ?? 960;
  const scale = width / (view.max[0] - view.min[0]);
  const height = Math.round((view.max[1] - view.min[1]) * scale);
  return {
    width,
    height,
    scale,
    toSvg: ([x, z]) => [(x - view.min[0]) * scale, (z - view.min[1]) * scale],
    fromSvg: ([px, py]) => [px / scale + view.min[0], py / scale + view.min[1]],
  };
}

interface Palette {
  outside: string;
  ground: string;
  paved: string;
  green: string;
  road: string;
  walkway: string;
  water: string;
  floor: string;
  room: string;
  landmark: string;
  restricted: string;
  wall: string;
  door: string;
  gap: string;
  stairs: string;
  text: string;
  halo: string;
  tree: string;
  furniture: string;
}

const PALETTES: Record<'light' | 'dark', Palette> = {
  light: {
    outside: '#dde2d3',
    ground: '#eaf0dd',
    paved: '#ebe5d6',
    green: '#cfe6b9',
    road: '#c5cad0',
    walkway: '#e6dcc6',
    water: '#9fd3f0',
    floor: '#fdf6e6',
    room: '#f7e3bd',
    landmark: '#ffd39b',
    restricted: '#cbbfae',
    wall: '#6b5b45',
    door: '#e8590c',
    gap: '#dfeaf3',
    stairs: '#8a7a63',
    text: '#2b2620',
    halo: '#fffdf6',
    tree: '#7fb069',
    furniture: '#c9b48f',
  },
  dark: {
    outside: '#12161a',
    ground: '#1d252b',
    paved: '#262d33',
    green: '#22382b',
    road: '#3a434c',
    walkway: '#343a3f',
    water: '#1f4f6e',
    floor: '#2d3339',
    room: '#3b3f3f',
    landmark: '#5a4a2f',
    restricted: '#22272c',
    wall: '#aab4be',
    door: '#ff922b',
    gap: '#161b20',
    stairs: '#8f9aa5',
    text: '#e9edf1',
    halo: '#12161a',
    tree: '#3d6b4f',
    furniture: '#566069',
  },
};

const POI_COLOURS: Record<PoiKind, string> = {
  spawn: '#1c7ed6',
  checkpoint: '#e8590c',
  seat: '#7048e8',
  npc_spot: '#d6336c',
  kiosk_spot: '#0ca678',
  photo_spot: '#f08c00',
  item_spot: '#868e96',
};

const escapeXml = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
  );

const n = (value: number) => String(Math.round(value * 10) / 10);

export function renderFloorSvg(
  map: CampusMap,
  floor: FloorId,
  options: FloorSvgOptions = {},
): string {
  const projection = createFloorProjection(map, options);
  const { width, height, scale, toSvg } = projection;
  const colours = PALETTES[options.theme ?? 'light'];
  const showLabels = options.showLabels ?? true;
  const showProps = options.showProps ?? true;
  const highlight = new Set(options.highlight ?? []);
  const isGround = floor === (map.floors[0]?.id ?? 'F1');

  const points = (polygon: readonly ReadonlyVec2[]) =>
    polygon.map((point) => toSvg(point).map(n).join(',')).join(' ');
  const out: string[] = [];
  const polygon = (shape: readonly ReadonlyVec2[], attributes: string, title?: string) => {
    const tooltip = title ? `<title>${escapeXml(title)}</title>` : '';
    out.push(`<polygon points="${points(shape)}" ${attributes}>${tooltip}</polygon>`);
  };

  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif">`,
    `<rect width="${width}" height="${height}" fill="${colours.outside}"/>`,
  );

  const areaFill = (area: Area): string => {
    if (area.kind === 'water') return colours.water;
    if (area.kind === 'restricted') return colours.restricted;
    if (area.kind === 'outdoor') {
      if (area.tags.includes('base')) return colours.ground;
      return area.tags.includes('green') ? colours.green : colours.paved;
    }
    if (area.tags.includes('base')) return colours.floor;
    return area.tags.includes('landmark') ? colours.landmark : colours.room;
  };
  const areaShape = (area: Area, extra = '') => {
    const stroke = highlight.has(area.id) ? ` stroke="${colours.door}" stroke-width="3"` : '';
    polygon(
      area.polygon,
      `fill="${areaFill(area)}" data-area="${area.id}"${stroke}${extra}`,
      area.name.vi,
    );
  };
  // Largest first, so nested areas are painted over the ones that contain them.
  const floorAreas = map.areas
    .filter((area) => area.floor === floor)
    .sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon));

  // Upper floors show the ground faintly for orientation.
  const groundAreas = isGround
    ? []
    : map.areas.filter((a) => a.floor === map.floors[0]?.id && a.kind !== 'indoor');
  for (const area of groundAreas.sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon))) {
    polygon(area.polygon, `fill="${areaFill(area)}" opacity="0.35"`);
  }

  for (const area of floorAreas.filter(
    (a) => a.kind === 'outdoor' || (a.kind === 'water' && isGround),
  )) {
    if (area.id !== 'area.koi_pond') areaShape(area);
  }

  for (const path of map.paths.filter((p) => p.floor === floor || !isGround)) {
    const d = `${path.points.map((point, i) => `${i === 0 ? 'M' : 'L'}${toSvg(point).map(n).join(' ')}`).join(' ')}${path.closed ? ' Z' : ''}`;
    const stroke = path.kind === 'road' ? colours.road : colours.walkway;
    out.push(
      `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${n(path.width * scale)}" stroke-linejoin="round" stroke-linecap="round"${isGround ? '' : ' opacity="0.35"'}/>`,
    );
  }

  for (const area of floorAreas.filter((a) => a.kind === 'restricted')) areaShape(area);

  const structuresHere = map.structures.filter((structure) => structure.floors.includes(floor));
  for (const structure of structuresHere) {
    polygon(structure.footprint, `fill="${colours.floor}" data-structure="${structure.id}"`);
  }
  for (const area of floorAreas.filter((a) => a.kind === 'indoor')) areaShape(area);
  for (const area of floorAreas.filter((a) => a.kind === 'water' && !isGround)) areaShape(area);
  const koiPond = floorAreas.find((a) => a.id === 'area.koi_pond');
  if (koiPond) areaShape(koiPond);

  // Slab holes: on this floor you look down through them.
  for (const structure of structuresHere) {
    for (const hole of structure.voids.filter((v) => v.floors.includes(floor))) {
      polygon(
        hole.polygon,
        `fill="${colours.gap}" stroke="${colours.wall}" stroke-width="1" stroke-dasharray="5 4"`,
        'Khoảng thông tầng',
      );
    }
  }

  for (const connector of map.connectors) {
    const onLower = connector.lower.floor === floor;
    if (!onLower && connector.upper.floor !== floor) continue;
    polygon(
      connectorFootprint(connector),
      `fill="${onLower ? colours.room : colours.gap}" stroke="${colours.stairs}" stroke-width="1"`,
      'Cầu thang',
    );
    const [x1, y1] = toSvg(connector.lower.at);
    const [x2, y2] = toSvg(connector.upper.at);
    const steps = Math.max(2, Math.round(Math.hypot(x2 - x1, y2 - y1) / 5));
    const half = (connector.width * scale) / 2;
    const length = Math.hypot(x2 - x1, y2 - y1) || 1;
    const nx = (-(y2 - y1) / length) * half;
    const ny = ((x2 - x1) / length) * half;
    for (let i = 1; i < steps; i++) {
      const x = x1 + ((x2 - x1) * i) / steps;
      const y = y1 + ((y2 - y1) * i) / steps;
      out.push(
        `<line x1="${n(x + nx)}" y1="${n(y + ny)}" x2="${n(x - nx)}" y2="${n(y - ny)}" stroke="${colours.stairs}" stroke-width="0.8"/>`,
      );
    }
    out.push(
      `<circle cx="${n(x2)}" cy="${n(y2)}" r="${n(Math.max(2, half * 0.35))}" fill="${colours.stairs}"><title>Đầu trên của cầu thang</title></circle>`,
    );
  }

  if (showProps) {
    for (const group of map.props) {
      const tree = group.model.startsWith('tree');
      for (const instance of group.instances.filter((i) => i.floor === floor)) {
        const [cx, cy] = toSvg(instance.p);
        const radius = (tree ? 2.2 : 1.1) * (instance.s ?? 1) * scale;
        out.push(
          `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(Math.max(1, radius))}" fill="${tree ? colours.tree : colours.furniture}" opacity="${tree ? 0.85 : 0.7}"/>`,
        );
      }
    }
  }

  // Walls, then door gaps drawn over them.
  for (const structure of structuresHere) {
    polygon(
      structure.footprint,
      `fill="none" stroke="${colours.wall}" stroke-width="${n(Math.max(1.2, 0.5 * scale))}" stroke-linejoin="round"`,
      structure.name.vi,
    );
    for (const opening of structure.openings.filter((o) => o.floor === floor)) {
      const hit = nearestEdge(opening.at, structure.footprint);
      const a = structure.footprint[hit.edge] as Vec2;
      const b = structure.footprint[(hit.edge + 1) % structure.footprint.length] as Vec2;
      const edgeLength = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const dx = ((b[0] - a[0]) / edgeLength) * (opening.width / 2);
      const dz = ((b[1] - a[1]) / edgeLength) * (opening.width / 2);
      const [x1, y1] = toSvg([opening.at[0] - dx, opening.at[1] - dz]);
      const [x2, y2] = toSvg([opening.at[0] + dx, opening.at[1] + dz]);
      out.push(
        `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${colours.door}" stroke-width="${n(Math.max(2.4, 0.9 * scale))}" stroke-linecap="round" data-door="${opening.id}"><title>${opening.id}</title></line>`,
      );
    }
  }

  const wantedPois = options.showPois === true ? null : new Set(options.showPois || []);
  if (options.showPois) {
    const visible = (poi: Poi) =>
      poi.floor === floor && (wantedPois === null || wantedPois.has(poi.kind));
    for (const poi of map.pois.filter(visible)) {
      const [cx, cy] = toSvg(poi.position);
      const label = poi.name ? `${poi.name.vi} — ${poi.id}` : poi.id;
      out.push(
        `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(Math.max(2.5, 0.7 * scale))}" fill="${POI_COLOURS[poi.kind]}" stroke="${colours.halo}" stroke-width="1" data-poi="${poi.id}"><title>${escapeXml(label)}</title></circle>`,
      );
    }
  }

  if (showLabels) {
    // Landmarks first, and the more specific (smaller) area first, so "Hồ bơi" wins over the deck
    // around it. A label that would overlap one already placed is dropped.
    const rank = (area: Area) => (area.tags.includes('landmark') ? 0 : 1);
    const candidates = floorAreas
      .filter((area) => !area.tags.includes('base') && area.kind !== 'restricted')
      .sort((a, b) => rank(a) - rank(b) || polygonArea(a.polygon) - polygonArea(b.polygon));
    const placed: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
    for (const area of candidates) {
      const size = Math.sqrt(polygonArea(area.polygon)) * scale;
      if (size < 26) continue;
      const [cx, cy] = toSvg(polygonCentroid(area.polygon));
      const fontSize = Math.max(9, Math.min(15, size / 6));
      const halfWidth = (area.name.vi.length * fontSize * 0.58) / 2;
      const box = {
        x0: cx - halfWidth,
        y0: cy - fontSize * 0.7,
        x1: cx + halfWidth,
        y1: cy + fontSize * 0.7,
      };
      if (placed.some((o) => box.x0 < o.x1 && box.x1 > o.x0 && box.y0 < o.y1 && box.y1 > o.y0))
        continue;
      placed.push(box);
      out.push(
        `<text x="${n(cx)}" y="${n(cy)}" font-size="${n(fontSize)}" font-weight="600" text-anchor="middle" dominant-baseline="middle" fill="${colours.text}" stroke="${colours.halo}" stroke-width="3" paint-order="stroke" pointer-events="none">${escapeXml(area.name.vi)}</text>`,
      );
    }
  }

  out.push('</svg>');
  return out.join('\n');
}
