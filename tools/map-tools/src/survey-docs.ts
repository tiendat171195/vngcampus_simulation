/**
 * Turns the photo survey (packages/map-data/src/survey.ts) into what people read: one map per
 * floor with the zones and numbered standing points, and the zone-by-zone section of
 * docs/12-photo-survey.md. `pnpm map:survey` writes them; a test fails when they are stale.
 */
import {
  type Bounds2,
  createFloorProjection,
  type FloorId,
  polygonCentroid,
  renderFloorSvg,
} from '@campus/map-data';
import { campusMap } from '@campus/map-data/campus';
import {
  SURVEY_DELIVERY,
  SURVEY_RULES,
  SURVEY_STATUS_LABEL,
  SURVEY_STEPS,
  SURVEY_ZONES,
  type SurveyGroup,
  type SurveyPriority,
  type SurveyZone,
} from '@campus/map-data/survey';

export interface SurveySheet {
  /** File name under docs/survey/. */
  file: string;
  title: string;
  floor: FloorId;
  group: SurveyGroup;
  view: Bounds2;
  /** A few names to orient by: the river, the main road. */
  hints: { text: string; at: [number, number] }[];
}

// Each view leaves a band at the top for the title.
const BUILDINGS: Bounds2 = { min: [-121, -50], max: [63, 51] };

export const SURVEY_SHEETS: readonly SurveySheet[] = [
  {
    file: 'khu-chup-ngoai-troi.svg',
    title: 'Khu chụp ngoài trời',
    floor: 'F1',
    group: 'Ngoài trời',
    view: { min: [-130, -74], max: [92, 98] },
    hints: [
      { text: 'Sông Sài Gòn', at: [-20, 96] },
      { text: 'Đường Tân Thuận', at: [-20, -70] },
      { text: 'Block chính', at: [0, 5] },
      { text: 'Block 2', at: [-96, 0] },
    ],
  },
  {
    file: 'khu-chup-tang-tret.svg',
    title: 'Khu chụp tầng trệt',
    floor: 'F1',
    group: 'Tầng trệt',
    view: BUILDINGS,
    hints: [
      { text: '↓ ra sông', at: [21, 49] },
      { text: '↑ ra đường Tân Thuận', at: [-10, -38] },
    ],
  },
  {
    file: 'khu-chup-tang-2.svg',
    title: 'Khu chụp tầng 2',
    floor: 'F2',
    group: 'Tầng 2',
    view: BUILDINGS,
    hints: [{ text: '↓ ra sông', at: [21, 49] }],
  },
  {
    file: 'khu-chup-tang-3.svg',
    title: 'Khu chụp tầng 3',
    floor: 'F3',
    group: 'Tầng 3',
    view: BUILDINGS,
    hints: [{ text: '↓ ra sông', at: [21, 49] }],
  },
];

const ZONE_COLOURS = [
  '#d9480f',
  '#1c7ed6',
  '#9c36b5',
  '#2b8a3e',
  '#e67700',
  '#5f3dc4',
  '#c2255c',
  '#0b7285',
  '#5c940d',
] as const;

const xml = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
  );
const n = (value: number) => String(Math.round(value * 10) / 10);

/** Zones drawn on a sheet, in the order they get their colours. */
export const zonesOnSheet = (sheet: SurveySheet): SurveyZone[] =>
  SURVEY_ZONES.filter((zone) => zone.group === sheet.group && zone.outline);

export const zoneColour = (sheet: SurveySheet, zone: SurveyZone): string =>
  ZONE_COLOURS[zonesOnSheet(sheet).indexOf(zone) % ZONE_COLOURS.length] as string;

export function renderSurveySheet(sheet: SurveySheet, width = 1100): string {
  const base = renderFloorSvg(campusMap, sheet.floor, {
    width,
    view: sheet.view,
    showLabels: false,
    showProps: false,
    showPois: false,
  });
  const { toSvg, width: w } = createFloorProjection(campusMap, { width, view: sheet.view });
  const out: string[] = [
    '<defs><marker id="survey-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#1f2328"/></marker></defs>',
  ];
  const label = (x: number, y: number, text: string, size: number, colour = '#1f2328') =>
    `<text x="${n(x)}" y="${n(y)}" font-size="${size}" font-weight="700" text-anchor="middle" dominant-baseline="middle" fill="${colour}" stroke="#ffffff" stroke-width="3.5" paint-order="stroke">${xml(text)}</text>`;

  const zones = zonesOnSheet(sheet);
  for (const zone of zones) {
    const colour = zoneColour(sheet, zone);
    const points = (zone.outline ?? []).map((p) => toSvg(p).map(n).join(',')).join(' ');
    out.push(
      `<polygon points="${points}" fill="${colour}" fill-opacity="0.16" stroke="${colour}" stroke-width="2.2" stroke-linejoin="round" data-zone="${zone.code}"><title>${xml(`${zone.code} · ${zone.name}`)}</title></polygon>`,
    );
  }
  for (const zone of zones) {
    const colour = zoneColour(sheet, zone);
    for (const station of zone.stations) {
      const [x, y] = toSvg(station.at);
      const [lx, ly] = toSvg(station.look);
      const length = Math.hypot(lx - x, ly - y) || 1;
      const reach = 30;
      out.push(
        `<line x1="${n(x)}" y1="${n(y)}" x2="${n(x + ((lx - x) / length) * reach)}" y2="${n(y + ((ly - y) / length) * reach)}" stroke="#1f2328" stroke-width="2.2" marker-end="url(#survey-arrow)"/>`,
        `<circle cx="${n(x)}" cy="${n(y)}" r="9" fill="${colour}" stroke="#ffffff" stroke-width="2" data-station="${zone.code}.${station.id}"><title>${xml(`${zone.code}.${station.id} · ${station.hint}`)}</title></circle>`,
        `<text x="${n(x)}" y="${n(y + 0.5)}" font-size="11" font-weight="700" text-anchor="middle" dominant-baseline="middle" fill="#ffffff" pointer-events="none">${station.id.slice(1)}</text>`,
      );
    }
  }
  // Zone codes go near the middle of their zone, nudged off standing points and other codes.
  const stationsPx = zones.flatMap((zone) => zone.stations.map((s) => toSvg(s.at)));
  const taken: { x: number; y: number; w: number }[] = [];
  const clashes = (x: number, y: number, w: number) =>
    stationsPx.some(([sx, sy]) => Math.abs(sx - x) < w / 2 + 12 && Math.abs(sy - y) < 20) ||
    taken.some((o) => Math.abs(o.x - x) < (o.w + w) / 2 && Math.abs(o.y - y) < 18);
  for (const zone of zones) {
    const [cx, cy] = toSvg(zone.labelAt ?? polygonCentroid(zone.outline ?? []));
    const w = zone.code.length * 10;
    const offsets: [number, number][] = [
      [0, -14],
      [0, 14],
      [0, -36],
      [0, 36],
      [-w, -14],
      [w, -14],
      [0, -58],
    ];
    const [dx, dy] = offsets.find(([ox, oy]) => !clashes(cx + ox, cy + oy, w)) ?? [0, -14];
    taken.push({ x: cx + dx, y: cy + dy, w });
    out.push(label(cx + dx, cy + dy, zone.code, 15, zoneColour(sheet, zone)));
  }
  for (const hint of sheet.hints) {
    const [x, y] = toSvg(hint.at);
    out.push(label(x, y, hint.text, 13, '#495057'));
  }

  // Title and a north arrow. On these maps "up" is −Z, which points 308° from north.
  out.push(
    `<text x="16" y="28" font-size="20" font-weight="700" fill="#1f2328" stroke="#ffffff" stroke-width="4" paint-order="stroke">${xml(sheet.title)}</text>`,
    `<text x="16" y="50" font-size="13" fill="#495057" stroke="#ffffff" stroke-width="3" paint-order="stroke">Bản đồ ${xml(campusMap.version)} · số trong vòng tròn là điểm đứng chụp (S1, S2…), mũi tên là hướng chụp</text>`,
    `<g transform="translate(${n(w - 40)} 44) rotate(52)"><circle r="20" fill="#ffffff" fill-opacity="0.85" stroke="#495057"/><path d="M0 -15L6 4L0 0L-6 4z" fill="#c92a2a"/></g>`,
    `<text x="${n(w - 40)}" y="80" font-size="12" font-weight="700" text-anchor="middle" fill="#c92a2a" stroke="#ffffff" stroke-width="3" paint-order="stroke">Bắc</text>`,
  );

  // The title doubles as the accessible name of the picture.
  const titled = base.replace(/^(<svg[^>]*>)/, `$1\n<title>${xml(sheet.title)}</title>`);
  return titled.replace(/<\/svg>\s*$/, `${out.join('\n')}\n</svg>\n`);
}

const PRIORITY: Record<SurveyPriority, string> = { 1: 'Bắt buộc', 2: 'Nên có', 3: 'Nếu kịp' };
const list = (items: readonly string[]) => items.join('; ');
const code = (ids: readonly string[]) => ids.map((id) => `\`${id}\``).join(', ');

function zoneBlock(zone: SurveyZone): string {
  const lines = [
    `#### ${zone.code} · ${zone.name}`,
    '',
    `${PRIORITY[zone.priority]} · ${SURVEY_STATUS_LABEL[zone.status]}${zone.covers.length ? ` · Sửa trên map: ${code(zone.covers)}` : ''}`,
    '',
  ];
  if (zone.where) lines.push(`- **Tìm ở đâu:** ${zone.where}`);
  if (zone.stations.length) {
    lines.push(`- **Đứng ở:** ${zone.stations.map((s) => `**${s.id}** ${s.hint}`).join('; ')}`);
  }
  lines.push(`- **Chụp thêm:** ${list(zone.shots)}`);
  if (zone.count.length) lines.push(`- **Đếm, đo:** ${list(zone.count)}`);
  if (zone.confirm.length) lines.push(`- **Cần xác nhận:** ${list(zone.confirm)}`);
  return lines.join('\n');
}

export const SURVEY_DOC_BEGIN =
  '<!-- survey:begin — phần dưới đây tự sinh bởi `pnpm map:survey` từ packages/map-data/src/survey.ts, đừng sửa tay -->';
export const SURVEY_DOC_END = '<!-- survey:end -->';

export function renderSurveySection(): string {
  const groups: SurveyGroup[] = ['Chung', 'Ngoài trời', 'Tầng trệt', 'Tầng 2', 'Tầng 3', 'Mái'];
  const out: string[] = [SURVEY_DOC_BEGIN, ''];

  out.push('### Mỗi khu đều chụp', '');
  SURVEY_STEPS.forEach((step, i) => {
    out.push(`${i + 1}. ${step}`);
  });
  out.push('', '### Quy tắc khi chụp', '');
  for (const rule of SURVEY_RULES) out.push(`- ${rule}`);
  out.push('', '### Gửi ảnh', '');
  for (const step of SURVEY_DELIVERY) out.push(`- ${step}`);

  out.push(
    '',
    '### Danh sách khu',
    '',
    '| Mã | Khu | Ưu tiên | Điểm đứng | Trạng thái |',
    '|---|---|---|---|---|',
  );
  for (const zone of SURVEY_ZONES) {
    out.push(
      `| ${zone.code} | ${zone.name} | ${PRIORITY[zone.priority]} | ${zone.stations.length || '—'} | ${SURVEY_STATUS_LABEL[zone.status]} |`,
    );
  }

  for (const group of groups) {
    const zones = SURVEY_ZONES.filter((zone) => zone.group === group);
    if (zones.length === 0) continue;
    out.push('', `### ${group}`, '');
    const sheet = SURVEY_SHEETS.find((s) => s.group === group);
    if (sheet) out.push(`![${sheet.title}](survey/${sheet.file})`, '');
    out.push(zones.map(zoneBlock).join('\n\n'));
  }
  out.push('', SURVEY_DOC_END);
  return out.join('\n');
}

/** Replaces the generated part of the survey doc, keeping what is written by hand around it. */
export function updateSurveyDoc(current: string): string {
  const start = current.indexOf(SURVEY_DOC_BEGIN);
  const end = current.indexOf(SURVEY_DOC_END);
  if (start < 0 || end < start)
    throw new Error('docs/12-photo-survey.md has lost its survey markers');
  return (
    current.slice(0, start) + renderSurveySection() + current.slice(end + SURVEY_DOC_END.length)
  );
}
