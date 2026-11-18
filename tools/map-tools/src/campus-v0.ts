/**
 * Builds the campus map: real footprints from OpenStreetMap, the outdoor layout checked against
 * satellite imagery and VNG's own photos (map 0.2), and the interiors furnished after press and
 * VNG photos (map 0.3, docs/03-world-and-assets.md §1.3): the atrium bleachers and LED wall, the
 * speed gates, the canteen, the gym, the open-plan floors with their booths and meeting rooms.
 * Photos show what a room looks like, not where it is: room positions stay assumed and carry
 * the `placeholder` tag until real floor plans correct them (P6.2).
 *
 * The output is deterministic: the same extract always yields the same map.
 */
import {
  type Area,
  bleacherHeight,
  bleacherLayout,
  bleacherPosition,
  CAMPUS_FRAME,
  type CampusMap,
  type Connector,
  campusMapSchema,
  closestPointOnSegment,
  connectorFootprint,
  createMapIndex,
  distance,
  distanceToOutline,
  ellipse,
  type FloorId,
  isWalkable,
  lerp,
  nearestEdge,
  type Path,
  type Poi,
  type Polygon,
  type PropGroup,
  pointAlongPolyline,
  pointInPolygon,
  polygonArea,
  polylineLength,
  rect,
  roundVec,
  type Structure,
  stripPolygon,
  type Vec2,
  yawDegOf,
} from '@campus/map-data';
import type { OsmExtract } from './osm';
import { createRandom } from './random';

const WAY = {
  main: 1176528258,
  block2: 1234832061,
  pool: 1193265278,
  cafeKiosk: 1193135788,
  loop: 899720023,
  roundabout: 899720024,
  forecourtDrive: 899720022,
  riverSpur: 899720025,
  sideStreet: 1240753383,
  roadSouthbound: 1576453086,
  roadNorthbound: 253275100,
  riverBank: 1028834653,
} as const;

const BOUNDS: { min: Vec2; max: Vec2 } = { min: [-200, -90], max: [150, 110] };

/** How far each kind of prop keeps from any point of interest, in metres. */
const PROP_CLEARANCE: Record<string, number> = {
  tree_a: 1.5,
  tree_b: 1.5,
  lamp: 1,
  car: 2.8,
  planter: 1.6,
  // Overhead or on a wall: nothing on the ground to keep clear of.
  canopy_v: 0,
  logo_sign: 0,
  planter_round: 0,
};

/**
 * Ground covered by each piece of fixed furniture, in its own frame (x to its right, z to its
 * front): [left, back, right, front]. Matches the models in apps/web (world/props.ts).
 */
export const EXTENT: Record<string, readonly [number, number, number, number]> = {
  led_wall: [-6, -0.4, 6, 0.4],
  speed_gate: [-0.11, -0.75, 0.11, 0.75],
  reception_desk: [-2.5, -0.45, 2.5, 0.45],
  coffee_bar: [-2.25, -0.4, 2.25, 0.4],
  back_bar: [-2.25, -0.2, 2.25, 0.2],
  food_counter: [-3, -1.4, 3, 0.5],
  canteen_table: [-2.4, -0.45, 2.4, 0.45],
  gym_rack: [-1.05, -0.65, 1.05, 0.65],
  treadmill: [-0.43, -0.95, 0.43, 0.95],
  rower: [-0.28, -1.15, 0.28, 1.15],
  dumbbell_rack: [-1.2, -0.3, 1.2, 0.3],
  mirror_wall: [-5, -0.07, 5, 0.07],
  yoga_mat: [-0.33, -0.9, 0.33, 0.9],
  booth_house: [-1.25, -1.2, 1.25, 1.2],
  meeting_room: [-3, -2.3, 3, 2.3],
  pantry_counter: [-2.5, -0.45, 3.35, 0.35],
  high_table: [-1.2, -0.4, 1.2, 0.4],
  desk_cluster: [-1.7, -1.45, 1.7, 1.45],
  planter_box: [-0.25, -0.8, 0.25, 0.8],
  plant_shelf: [-1.2, -0.22, 1.2, 0.22],
};

const vi = (text: string) => ({ vi: text });
/** A heading in (-180, 180]. */
const normaliseYaw = (yawDeg: number) => {
  const turned = ((yawDeg % 360) + 360) % 360;
  return turned > 180 ? turned - 360 : turned;
};
const round = (points: Polygon) => points.map((point) => roundVec(point));
const pad = (n: number) => String(n).padStart(2, '0');

/** Keeps the part of a polyline whose X lies inside the range, cutting segments at the limits. */
function clipToXRange(points: readonly Vec2[], minX: number, maxX: number): Vec2[] {
  const result: Vec2[] = [];
  const inside = (p: Vec2) => p[0] >= minX && p[0] <= maxX;
  const cut = (a: Vec2, b: Vec2, x: number): Vec2 => lerp(a, b, (x - a[0]) / (b[0] - a[0]));
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as Vec2;
    if (inside(a)) result.push(a);
    const b = points[i + 1];
    if (!b || inside(a) === inside(b)) continue;
    const limit = (inside(a) ? b : a)[0] > maxX ? maxX : minX;
    result.push(cut(a, b, limit));
  }
  return result;
}

/** Z of a roughly horizontal polyline at a given X, by linear interpolation. */
function zAt(points: readonly Vec2[], x: number): number {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i] as Vec2;
    const b = sorted[i + 1] as Vec2;
    if (x >= a[0] && x <= b[0]) return lerp(a, b, (x - a[0]) / (b[0] - a[0]))[1];
  }
  throw new RangeError(`x=${x} is outside the polyline`);
}

export function buildCampusV0(osm: OsmExtract): CampusMap {
  const mainFootprint = osm.way(WAY.main);
  const block2Footprint = osm.way(WAY.block2);
  const poolOutline = osm.way(WAY.pool);
  const cafeKioskFootprint = osm.way(WAY.cafeKiosk);
  const riverBank = osm.way(WAY.riverBank);

  /** Z of the river bank at X; the promenade and the fence follow it. */
  const bankZ = (x: number) => zAt(riverBank, x);

  const floors: CampusMap['floors'] = [
    { id: 'F1', y: 0, height: 5, label: vi('Tầng trệt') },
    { id: 'F2', y: 5, height: 4.5, label: vi('Tầng 2') },
    { id: 'F3', y: 9.5, height: 4.5, label: vi('Tầng 3') },
    { id: 'ROOF', y: 14, height: 3, label: vi('Mái') },
  ];
  const upperFloors: FloorId[] = ['F2', 'F3'];

  // ---------------------------------------------------------------------------------------------
  // Structures
  // ---------------------------------------------------------------------------------------------

  const atriumVoid: Vec2[] = [
    [-14, -12],
    [14, -12],
    [18, -8],
    [18, 12],
    [14, 16],
    [-14, 16],
    [-18, 12],
    [-18, -8],
  ];

  /** Snaps a rough door position onto the nearest wall of a footprint. */
  const onWall = (footprint: Polygon, near: Vec2) => roundVec(nearestEdge(near, footprint).point);

  // The two blocks share one wall; the same doorway is cut into both of them on every floor.
  const blockLink = onWall(mainFootprint, [-58.95, -19.95]);

  // The security booth stands by the vehicle entrance in the north-east corner (assumed spot).
  const gatehouseFootprint = rect(66, -56, 70, -52);

  /** The south facade of the main block, where the main entrance faces the river. */
  const southEdge = nearestEdge([20, 36], mainFootprint).edge;
  const southFacade = {
    a: mainFootprint[southEdge] as Vec2,
    b: mainFootprint[(southEdge + 1) % mainFootprint.length] as Vec2,
  };
  const facadeZ = (x: number) => {
    const { a, b } = southFacade;
    return lerp(a, b, (x - a[0]) / (b[0] - a[0]))[1];
  };
  const outward: Vec2 = (() => {
    const d: Vec2 = [southFacade.b[0] - southFacade.a[0], southFacade.b[1] - southFacade.a[1]];
    const length = Math.hypot(d[0], d[1]);
    const n: Vec2 = [-d[1] / length, d[0] / length];
    return n[1] > 0 ? n : [-n[0], -n[1]];
  })();
  /** The roundabout in front of the entrance has a fountain in its middle (photos, satellite). */
  const fountainCentre: Vec2 = [21.5, 49];

  const structures: Structure[] = [
    {
      id: 'structure.main',
      name: vi('Block chính'),
      footprint: mainFootprint,
      floors: ['F1', 'F2', 'F3'],
      voids: [{ id: 'atrium', polygon: atriumVoid, floors: ['F2', 'F3', 'ROOF'] }],
      openings: [
        // A service door to the garden strip along the main road.
        { id: 'door.main.north', floor: 'F1', at: onWall(mainFootprint, [0, -34.3]), width: 6 },
        { id: 'door.main.west', floor: 'F1', at: onWall(mainFootprint, [-38.7, 17.9]), width: 8 },
        // The main entrance, under the orange V-shaped canopy, facing the fountain and the river.
        { id: 'door.main.south', floor: 'F1', at: onWall(mainFootprint, [20, 35.9]), width: 10 },
        { id: 'door.main.east', floor: 'F1', at: onWall(mainFootprint, [53.8, 10.7]), width: 5 },
        ...(['F1', 'F2', 'F3'] as const).map((floor) => ({
          id: `door.main.link_${floor.toLowerCase()}`,
          floor,
          at: blockLink,
          width: 10,
        })),
      ],
      style: 'office',
    },
    {
      id: 'structure.block2',
      name: vi('Block 2'),
      footprint: block2Footprint,
      floors: ['F1', 'F2', 'F3'],
      voids: [],
      openings: [
        {
          id: 'door.block2.forecourt',
          floor: 'F1',
          at: onWall(block2Footprint, [-88.45, 37.7]),
          width: 6,
        },
        {
          id: 'door.block2.north',
          floor: 'F1',
          at: onWall(block2Footprint, [-92, -37.15]),
          width: 5,
        },
        { id: 'door.block2.west', floor: 'F1', at: onWall(block2Footprint, [-116.6, 5]), width: 5 },
        ...(['F1', 'F2', 'F3'] as const).map((floor) => ({
          id: `door.block2.link_${floor.toLowerCase()}`,
          floor,
          at: blockLink,
          width: 10,
        })),
      ],
      style: 'office',
    },
    {
      id: 'structure.cafe_kiosk',
      name: vi('Quầy cà phê ngoài trời'),
      footprint: cafeKioskFootprint,
      floors: ['F1'],
      voids: [],
      openings: [],
      height: 4,
      style: 'kiosk',
    },
    {
      id: 'structure.gatehouse',
      name: vi('Chốt bảo vệ'),
      footprint: gatehouseFootprint,
      floors: ['F1'],
      voids: [],
      openings: [],
      height: 3,
      style: 'kiosk',
    },
  ];

  // ---------------------------------------------------------------------------------------------
  // Stairs. Each flight is a straight ramp; flights to F3 get their own hole in the F3 slab.
  // ---------------------------------------------------------------------------------------------

  const flight = (
    id: string,
    structure: string,
    lowerFloor: FloorId,
    lowerAt: Vec2,
    upperFloor: FloorId,
    upperAt: Vec2,
  ): Connector => ({
    id: `connector.${id}`,
    kind: 'stairs',
    structure,
    lower: { floor: lowerFloor, at: lowerAt },
    upper: { floor: upperFloor, at: upperAt },
    width: 4,
  });

  // The wooden bleachers rise from the atrium floor to the edge of the F2 gallery, facing the LED
  // wall and the lobby, with a lane of half steps down the middle (photos, map 0.3).
  const bleachers: Connector = {
    id: 'connector.main.bleachers',
    kind: 'bleachers',
    structure: 'structure.main',
    lower: { floor: 'F1', at: [-6, 0] },
    upper: { floor: 'F2', at: [-6, -12] },
    width: 16,
  };
  const connectors: Connector[] = [
    bleachers,
    // A grand stair out of the atrium floor on the other side, to the edge of the F2 gallery.
    flight('main.south_1', 'structure.main', 'F1', [8, 6], 'F2', [8, 16]),
    // Continuing up behind the gallery.
    flight('main.north_2', 'structure.main', 'F2', [6, -16], 'F3', [6, -26]),
    flight('main.south_2', 'structure.main', 'F2', [-6, 20], 'F3', [-6, 30]),
    // A switchback pair in block 2.
    flight('block2.1', 'structure.block2', 'F1', [-95, 0], 'F2', [-95, -10]),
    flight('block2.2', 'structure.block2', 'F2', [-89, -10], 'F3', [-89, 0]),
  ];

  // ---------------------------------------------------------------------------------------------
  // Areas
  // ---------------------------------------------------------------------------------------------

  // Fence line: the road side, the east end, the hedge west of block 2 (the open lot beyond it is
  // not part of the campus, satellite imagery), and four metres back from the river bank.
  const WEST_FENCE = -126;
  const site: Vec2[] = [
    [WEST_FENCE, -57],
    [90, -57],
    [90, bankZ(90) - 4],
    [72.3, bankZ(72.3) - 4],
    [WEST_FENCE, bankZ(WEST_FENCE) - 4],
  ];
  const river: Vec2[] = [
    [BOUNDS.min[0], bankZ(BOUNDS.min[0])],
    [72.3, bankZ(72.3)],
    [BOUNDS.max[0], bankZ(BOUNDS.max[0])],
    [BOUNDS.max[0], BOUNDS.max[1]],
    [BOUNDS.min[0], BOUNDS.max[1]],
  ];
  const koiPond = ellipse([-2, 30], 6, 3.5, 14);
  const fountain = ellipse(fountainCentre, 2.8, 2.8, 16);
  /** The round planter in the middle of the garden between the blocks. */
  const gardenPlanter = ellipse([-52.5, 16], 4.2, 4.2, 16);
  const canteenOutline: Vec2[] = [
    [6, -32],
    [34.7, -32],
    [52, 10],
    [22, 10],
    [22, -14],
    [6, -14],
  ];
  /** Glass meeting rooms along the north wall of the main block, on both office floors. */
  const meetingRoomAt = (i: number): Vec2 => [-41 + i * 6.5, -31.2];
  const pantryOutline = rect(28, -22, 38, -13);
  // The entrance plaza: between the south facade and the drive around the fountain.
  const entrancePlaza: Vec2[] = [
    [10, facadeZ(10) + 0.6],
    [32, facadeZ(32) + 0.6],
    [32, 42.5],
    [10, 43.5],
  ];

  const area = (
    id: string,
    name: string,
    floor: FloorId,
    polygon: readonly Vec2[],
    kind: Area['kind'],
    tags: string[] = [],
  ): Area => ({
    id: `area.${id}`,
    name: vi(name),
    floor,
    polygon: round(polygon),
    kind,
    walkable: kind === 'outdoor' || kind === 'indoor',
    tags,
  });

  const areas: Area[] = [
    // Outdoors
    area('site', 'Khuôn viên', 'F1', site, 'outdoor', ['base']),
    area('river', 'Sông Sài Gòn', 'F1', river, 'water'),
    area('gate_main', 'Cổng chính', 'F1', entrancePlaza, 'outdoor', ['landmark']),
    area('fountain', 'Đài phun nước', 'F1', fountain, 'water', ['landmark']),
    // Nose-in bays along the drive on the river side (cars in the satellite imagery).
    area('parking', 'Bãi xe', 'F1', rect(-74, 57, 6, 67), 'outdoor'),
    area(
      'forecourt',
      'Sân vườn',
      'F1',
      [
        [-98, 50],
        [-75.5, 28],
        [-76, 10.5],
        [-52, -3.5],
        [-25.5, 46],
        [-25.5, 50.5],
      ],
      'outdoor',
      ['landmark', 'green'],
    ),
    area('garden_planter', 'Bồn cây tròn', 'F1', gardenPlanter, 'restricted', ['landmark']),
    area(
      'pool_deck',
      'Khu hồ bơi',
      'F1',
      [
        [36.9, -34],
        [36.9, -44],
        [63, -44],
        [63, 14],
        [56.7, 14],
      ],
      'outdoor',
      [],
    ),
    area('pool', 'Hồ bơi', 'F1', poolOutline, 'water', ['landmark']),
    area(
      'riverside',
      'Công viên ven sông',
      'F1',
      [
        [WEST_FENCE + 2, 69],
        [85, 69],
        [85, bankZ(85) - 4],
        [WEST_FENCE + 2, bankZ(WEST_FENCE + 2) - 4],
      ],
      'outdoor',
      ['landmark', 'green'],
    ),
    area('cafe_terrace', 'Sân cà phê ngoài trời', 'F1', rect(42, 38, 68, 58), 'outdoor'),
    area('cafe_kiosk', 'Quầy cà phê ngoài trời', 'F1', cafeKioskFootprint, 'restricted'),
    area('gatehouse', 'Chốt bảo vệ', 'F1', gatehouseFootprint, 'restricted', ['placeholder']),

    // Ground floor
    area('main.f1', 'Block chính — tầng trệt', 'F1', mainFootprint, 'indoor', ['base']),
    area('block2.f1', 'Block 2 — tầng trệt', 'F1', block2Footprint, 'indoor', ['base']),
    area('atrium', 'Atrium', 'F1', atriumVoid, 'indoor', ['landmark', 'event', 'timber']),
    area('atrium_bleachers', 'Khán đài Atrium', 'F1', connectorFootprint(bleachers), 'indoor', [
      'landmark',
      'event',
    ]),
    // Through the main entrance, past reception, into the atrium (articles, photos).
    area(
      'lobby',
      'Sảnh lễ tân',
      'F1',
      [
        [16, 18],
        [34, 18],
        [34, facadeZ(34) - 0.6],
        [16, facadeZ(16) - 0.6],
      ],
      'indoor',
      ['landmark', 'placeholder'],
    ),
    area('canteen', 'Canteen', 'F1', canteenOutline, 'indoor', [
      'landmark',
      'placeholder',
      'timber',
    ]),
    area(
      'koi',
      'Khu hồ Koi',
      'F1',
      [
        [-14, 21],
        [14, 21],
        [14, 35.5],
        [-14, 42.5],
      ],
      'indoor',
      ['landmark', 'placeholder'],
    ),
    area('koi_pond', 'Hồ cá Koi', 'F1', koiPond, 'water', ['landmark', 'placeholder']),
    area('coffee_main', 'Quầy cà phê', 'F1', rect(5, 22, 13.5, 30), 'indoor', ['placeholder']),
    area('gym', 'Phòng gym', 'F1', rect(-113, -33, -72, -14), 'indoor', ['placeholder', 'rubber']),
    // The yoga room "has the best view in the building" (ictnews): the river end of block 2.
    area('yoga', 'Phòng yoga', 'F3', rect(-115, 31, -103, 44), 'indoor', [
      'room',
      'timber',
      'placeholder',
    ]),

    // Upper floors: open-plan offices around the atrium.
    ...upperFloors.flatMap((floor) => {
      const n = floor === 'F2' ? 2 : 3;
      const key = floor.toLowerCase();
      return [
        area(
          `office.${key}.main`,
          `Văn phòng tầng ${n} — block chính`,
          floor,
          mainFootprint,
          'indoor',
          ['base'],
        ),
        area(
          `office.${key}.block2`,
          `Văn phòng tầng ${n} — block 2`,
          floor,
          block2Footprint,
          'indoor',
          ['base'],
        ),
        ...[0, 1, 2, 3].map((i) => {
          const [x, z] = meetingRoomAt(i);
          return area(
            `meeting.${key}_${pad(i + 1)}`,
            `Phòng họp ${n}.${pad(i + 1)}`,
            floor,
            rect(x - 3, z - 2.25, x + 3, z + 2.25),
            'indoor',
            ['room', 'placeholder'],
          );
        }),
        area(`pantry.${key}`, `Pantry tầng ${n}`, floor, pantryOutline, 'indoor', [
          'room',
          'placeholder',
        ]),
      ];
    }),
  ];

  // ---------------------------------------------------------------------------------------------
  // Roads and walkways
  // ---------------------------------------------------------------------------------------------

  const promenadeAt = (x: number): Vec2 => [x, bankZ(x) - 8];
  const promenade = [WEST_FENCE + 6, -40, 21, 85].map(promenadeAt);
  const loop = osm.way(WAY.loop);

  const path = (
    id: string,
    kind: Path['kind'],
    points: readonly Vec2[],
    width: number,
    closed = false,
  ): Path => ({ id: `path.${id}`, kind, floor: 'F1', points: round(points), width, closed });

  const paths: Path[] = [
    path(
      'road.tan_thuan_a',
      'road',
      clipToXRange(osm.way(WAY.roadSouthbound), BOUNDS.min[0], BOUNDS.max[0]),
      9,
    ),
    path(
      'road.tan_thuan_b',
      'road',
      clipToXRange(osm.way(WAY.roadNorthbound), BOUNDS.min[0], BOUNDS.max[0]),
      9,
    ),
    path('road.side_street', 'road', osm.way(WAY.sideStreet), 7),
    path('road.loop', 'road', loop, 6),
    path('road.roundabout', 'road', osm.way(WAY.roundabout).slice(0, -1), 5, true),
    path('road.forecourt_drive', 'road', osm.way(WAY.forecourtDrive), 6),
    path(
      'walk.river_spur',
      'walkway',
      [...osm.way(WAY.riverSpur).toReversed(), promenadeAt(21)],
      4,
    ),
    path('walk.promenade', 'walkway', promenade, 4),
  ];

  // ---------------------------------------------------------------------------------------------
  // Points of interest. Everything below is checked against the areas above while it is placed.
  // ---------------------------------------------------------------------------------------------

  const draft: CampusMap = {
    version: '0.3.0',
    meta: {
      origin: CAMPUS_FRAME.origin,
      xAxisBearingDeg: CAMPUS_FRAME.xAxisBearingDeg,
      bounds: BOUNDS,
    },
    floors,
    areas,
    structures,
    paths,
    connectors,
    pois: [],
    spawnSets: {},
    props: [],
  };
  const index = createMapIndex(draft);
  const pois: Poi[] = [];
  const spawnSets: Record<string, string[]> = {};
  const floorY = (floor: FloorId) => index.floors.get(floor)?.y ?? 0;

  /** Height of the bleacher tier under a point, if there is one. */
  const tierTopAt = (point: Vec2, floor: FloorId): number | undefined => {
    for (const connector of connectors) {
      if (connector.kind !== 'bleachers' || connector.lower.floor !== floor) continue;
      const lowerY = floorY(connector.lower.floor);
      const layout = bleacherLayout(connector, lowerY, floorY(connector.upper.floor));
      const at = bleacherPosition(connector, layout, point);
      if (at) return lowerY + bleacherHeight(layout, at.along, at.offset);
    }
    return undefined;
  };

  const place = (
    kind: Poi['kind'],
    id: string,
    floor: FloorId,
    position: Vec2,
    extra: Partial<Pick<Poi, 'name' | 'yawDeg' | 'radius' | 'meta' | 'y'>> = {},
  ): string => {
    if (extra.y !== undefined) {
      // Only seats on bleachers stand above their floor.
      const top = tierTopAt(position, floor);
      if (kind !== 'seat' || top === undefined || Math.abs(top - extra.y) > 1e-6) {
        throw new Error(`poi.${id} at ${position.join(', ')} is not on a bleacher tier`);
      }
    } else if (!isWalkable(index, position, floor)) {
      throw new Error(`poi.${id} at ${position.join(', ')} on ${floor} is not on walkable ground`);
    }
    // Things that stay put (furniture, kiosks, characters) must not stand in a roadway.
    if (kind === 'seat' || kind === 'kiosk_spot' || kind === 'npc_spot') {
      const road = paths.find(
        (p) =>
          p.kind === 'road' &&
          p.floor === floor &&
          p.points.some(
            (point, i) =>
              i > 0 &&
              closestPointOnSegment(position, p.points[i - 1] as Vec2, point).distance <
                p.width / 2 + 0.4,
          ),
      );
      if (road) throw new Error(`poi.${id} at ${position.join(', ')} stands on ${road.id}`);
    }
    const poi: Poi = { id: `poi.${id}`, kind, floor, position: roundVec(position), ...extra };
    if (poi.yawDeg !== undefined) poi.yawDeg = Math.round(poi.yawDeg);
    if (poi.y !== undefined) poi.y = Math.round(poi.y * 1000) / 1000;
    pois.push(poi);
    return poi.id;
  };
  const facing = (from: Vec2, to: Vec2) => yawDegOf([to[0] - from[0], to[1] - from[1]]);

  // ---------------------------------------------------------------------------------------------
  // Fixed furniture, from press and VNG photos of the interiors (map 0.3). Laid out before the
  // points of interest so seats can be put on it and items kept off it.
  // ---------------------------------------------------------------------------------------------

  interface Fixture {
    model: string;
    floor: FloorId;
    at: Vec2;
    yawDeg: number;
  }
  const fixtures: Fixture[] = [];
  /** A point given in a fixture's own frame (x to its right, z to its front), on the map. */
  const local = (f: Fixture, x: number, z: number): Vec2 => {
    const yaw = (f.yawDeg * Math.PI) / 180;
    return [
      f.at[0] + x * Math.cos(yaw) + z * Math.sin(yaw),
      f.at[1] - x * Math.sin(yaw) + z * Math.cos(yaw),
    ];
  };
  const outlineOf = (f: Fixture): Vec2[] => {
    const extent = EXTENT[f.model];
    if (!extent) throw new Error(`no extent for ${f.model}`);
    const [x0, z0, x1, z1] = extent;
    return [local(f, x0, z0), local(f, x1, z0), local(f, x1, z1), local(f, x0, z1)];
  };
  const fixture = (model: string, floor: FloorId, at: Vec2, yawDeg = 0): Fixture => {
    const f: Fixture = { model, floor, at: roundVec(at), yawDeg: Math.round(yawDeg) };
    for (const corner of outlineOf(f)) {
      if (!isWalkable(index, corner, floor) && tierTopAt(corner, floor) === undefined) {
        throw new Error(`${model} at ${at.join(', ')} on ${floor} sticks out of the floor`);
      }
    }
    fixtures.push(f);
    return f;
  };
  const fixturesOn = (floor: FloorId) => fixtures.filter((f) => f.floor === floor);
  const WEST: Vec2 = [-1, 0];

  // Atrium: the LED wall faces the bleachers across the atrium floor.
  fixture('led_wall', 'F1', [-6, 13.6], 180);
  // Lobby: speed gates between reception and the atrium (photos), the reception desk to one
  // side so the way from the doors stays open.
  for (let i = 0; i < 10; i++) fixture('speed_gate', 'F1', [17 + i * 1.25, 18.6]);
  const receptionDesk = fixture('reception_desk', 'F1', [31, 26.5], yawDegOf(WEST));
  // The coffee bar by the koi pond, its back bar towards the atrium.
  const coffeeBar = fixture('coffee_bar', 'F1', [9.25, 27.4]);
  fixture('back_bar', 'F1', local(coffeeBar, 0, -1.9), coffeeBar.yawDeg);

  // Canteen: serving counters along the north wall (three kitchens and drinks, ictnews), long
  // tables in rows in front of them.
  for (const x of [10, 16.5, 23, 29.5]) fixture('food_counter', 'F1', [x, -30.9]);
  // The canteen kiosk, the checkpoint at the entrance and a mascot hiding spot.
  const canteenKeepClear: Vec2[] = [
    [8, -20],
    [10, -16],
    [40, -8],
  ];
  const canteenTables: Fixture[] = [];
  const insideCanteen = (p: Vec2) =>
    pointInPolygon(p, canteenOutline) && distanceToOutline(p, canteenOutline) > 0.6;
  for (let z = -27.6; z <= 8.2; z += 3.8) {
    const firstX = z < -14 ? 12 : 25.2;
    for (let x = firstX; x < 52; x += 6.2) {
      const corners: Vec2[] = [
        [x - 2.6, z - 1.25],
        [x + 2.6, z - 1.25],
        [x + 2.6, z + 1.25],
        [x - 2.6, z + 1.25],
      ];
      if (!corners.every(insideCanteen)) continue;
      if (canteenKeepClear.some((p) => distanceToOutline(p, corners) < 1.5)) continue;
      canteenTables.push(fixture('canteen_table', 'F1', [x, z]));
    }
  }

  // Gym (UPFIT): racks in front of a mirror wall, treadmills along the windows, rowers and
  // dumbbells; the middle stays free for classes (photos of the gym).
  for (const x of [-105, -95, -85]) fixture('mirror_wall', 'F1', [x, -32.4]);
  for (const x of [-106.5, -102.5, -98.5, -94.5]) fixture('gym_rack', 'F1', [x, -30.3]);
  for (const x of [-89, -87.8, -86.6, -85.4]) fixture('rower', 'F1', [x, -29.8], 180);
  for (const z of [-26, -22.5]) fixture('dumbbell_rack', 'F1', [-73.4, z], yawDegOf(WEST));
  for (let i = 0; i < 8; i++) fixture('treadmill', 'F1', [-111.3, -31 + i * 1.3], yawDegOf(WEST));
  // Yoga room at the river end of block 2.
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 5; column++) {
      fixture('yoga_mat', 'F3', [-113 + column * 2.2, 33.5 + row * 3.2]);
    }
  }

  // Office floors: house-shaped booths along the east gallery of the atrium, glass meeting rooms
  // along the north wall, a pantry in the east corner.
  const booths: Fixture[] = [];
  const meetingRooms: Fixture[] = [];
  const pantries: { counter: Fixture; table: Fixture; floor: FloorId }[] = [];
  for (const floor of upperFloors) {
    for (let i = 0; i < 5; i++)
      booths.push(fixture('booth_house', floor, [21.6, -6 + i * 2.6], yawDegOf(WEST)));
    for (let i = 0; i < 4; i++) meetingRooms.push(fixture('meeting_room', floor, meetingRoomAt(i)));
    pantries.push({
      floor,
      counter: fixture('pantry_counter', floor, [33, -21.4]),
      table: fixture('high_table', floor, [33, -16.4]),
    });
  }

  // Players arrive at the main entrance facing the doors, as people do off the shuttle bus.
  const entranceDoor = onWall(mainFootprint, [20, 35.9]);
  spawnSets.players_gate = [15.5, 18.5, 21.5, 24.5].flatMap((x, column) =>
    [2, 4].map((back, row) => {
      const at: Vec2 = [x, facadeZ(x) + back];
      return place('spawn', `spawn.gate_${pad(column * 2 + row + 1)}`, 'F1', at, {
        yawDeg: facing(at, entranceDoor),
      });
    }),
  );

  const checkpoint = (id: string, name: string, floor: FloorId, at: Vec2, radius = 3) =>
    place('checkpoint', `checkpoint.${id}`, floor, at, { name: vi(name), radius });

  checkpoint('gate', 'Cổng chính', 'F1', [21, facadeZ(21) + 3]);
  checkpoint('atrium', 'Giữa Atrium', 'F1', [0, 2], 5);
  checkpoint('lobby', 'Sảnh lễ tân', 'F1', [26, 24]);
  checkpoint('canteen', 'Lối vào canteen', 'F1', [10, -16]);
  checkpoint('koi', 'Bên hồ Koi', 'F1', [-2, 24.5]);
  checkpoint('pool', 'Hồ bơi', 'F1', [56.5, 7]);
  checkpoint('forecourt', 'Sân vườn', 'F1', [-60, 30], 4);
  checkpoint('parking', 'Bãi xe', 'F1', [-34, 62], 4);
  checkpoint('riverside', 'Giữa công viên ven sông', 'F1', promenadeAt(-40), 4);
  checkpoint('gym', 'Phòng gym', 'F1', [-92, -24]);
  checkpoint('office_f2', 'Hành lang tầng 2', 'F2', [0, -22]);
  checkpoint('office_f3', 'Hành lang tầng 3', 'F3', [0, 24]);

  // A lap of the internal road, in running order.
  const loopLength = polylineLength(loop);
  spawnSets.race_loop = Array.from({ length: 6 }, (_, i) => {
    const { point } = pointAlongPolyline(loop, (loopLength * (i + 0.5)) / 6);
    return place('checkpoint', `checkpoint.loop_${pad(i + 1)}`, 'F1', point, { radius: 4 });
  });

  /** Furniture drawn as part of another prop, like the chairs round a canteen table. */
  const BUILT_IN = 'built_in';
  const seat = (
    id: string,
    floor: FloorId,
    at: Vec2,
    yawDeg: number,
    furniture: string,
    y?: number,
  ) =>
    place('seat', `seat.${id}`, floor, at, {
      yawDeg: normaliseYaw(yawDeg),
      meta: { furniture },
      ...(y === undefined ? {} : { y }),
    });

  // Benches along the river, facing the water.
  for (let i = 0; i < 10; i++) {
    const x = -112 + i * 21;
    seat(`riverside_${pad(i + 1)}`, 'F1', [x, bankZ(x) - 5.5], 0, 'bench');
  }
  // Around the koi pond, facing it. Only eight: these are meant to be contested.
  ellipse([-2, 30], 7.6, 5.1, 8).forEach((at, i) => {
    seat(`koi_${pad(i + 1)}`, 'F1', at, facing(at, [-2, 30]), 'bench');
  });
  // Stools at the coffee bar, facing it.
  for (let i = 0; i < 6; i++)
    seat(`coffee_${pad(i + 1)}`, 'F1', [6.9 + i * 0.95, 28.6], 180, 'stool');
  // Every chair of the canteen tables, facing the table.
  let canteenSeat = 0;
  for (const table of canteenTables) {
    for (const x of [-1.8, -0.6, 0.6, 1.8]) {
      for (const [z, yawDeg] of [
        [-0.75, 0],
        [0.75, 180],
      ] as const) {
        seat(`canteen_${pad(++canteenSeat)}`, 'F1', local(table, x, z), yawDeg, BUILT_IN);
      }
    }
  }
  // Bean bags here and there on the bleachers, facing the LED wall (photos). Not on the top
  // tiers: from there a sitter would already count as being on the gallery floor above.
  const tiers = bleacherLayout(bleachers, floorY('F1'), floorY('F2'));
  const downTheBleachers = yawDegOf([-tiers.up[0], -tiers.up[1]]);
  (
    [
      [1, -5.5],
      [1, 3],
      [2, -2.2],
      [3, 6],
      [3, -6.5],
      [4, 2],
      [5, -3.6],
      [6, 4.6],
      [7, -6],
      [7, 2.2],
      [8, -2],
      [9, 5.8],
      [10, -4.6],
      [11, 2.6],
      [12, -6.6],
      [13, 6.4],
    ] as const
  ).forEach(([tier, offset], i) => {
    const along = (tier + 0.5) * tiers.depth;
    const at: Vec2 = [
      bleachers.lower.at[0] + tiers.up[0] * along + tiers.across[0] * offset,
      bleachers.lower.at[1] + tiers.up[1] * along + tiers.across[1] * offset,
    ];
    const y = floorY('F1') + bleacherHeight(tiers, along, offset);
    seat(`atrium_${pad(i + 1)}`, 'F1', at, downTheBleachers, 'beanbag', y);
  });
  // The booths' sofas face each other across the table.
  booths.forEach((booth, i) => {
    const key = `${booth.floor.toLowerCase()}_${pad((i % 5) + 1)}`;
    seat(`booth_${key}_a`, booth.floor, local(booth, -0.8, -0.1), booth.yawDeg + 90, BUILT_IN);
    seat(`booth_${key}_b`, booth.floor, local(booth, 0.8, -0.1), booth.yawDeg - 90, BUILT_IN);
  });
  meetingRooms.forEach((room, i) => {
    const key = `${room.floor.toLowerCase()}_${pad((i % 4) + 1)}`;
    [-1.1, 0, 1.1].forEach((x, j) => {
      seat(`meeting_${key}_${j + 1}`, room.floor, local(room, x, -1.2), room.yawDeg, BUILT_IN);
      seat(`meeting_${key}_${j + 4}`, room.floor, local(room, x, 0.6), room.yawDeg + 180, BUILT_IN);
    });
  });
  for (const { floor, table } of pantries) {
    const key = floor.toLowerCase();
    // A red sofa along the west wall of the pantry and stools at the high table (photos).
    for (let i = 0; i < 3; i++)
      seat(`pantry_${key}_sofa_${i + 1}`, floor, [28.9, -20.5 + i], 90, 'sofa');
    [
      [-0.7, -0.75, 0],
      [0.7, -0.75, 0],
      [-0.7, 0.75, 180],
      [0.7, 0.75, 180],
    ].forEach(([x, z, yawDeg], i) => {
      seat(
        `pantry_${key}_stool_${i + 1}`,
        floor,
        local(table, x as number, z as number),
        table.yawDeg + (yawDeg as number),
        'stool',
      );
    });
  }
  // Two rows of loungers on the deck south of the pool, facing the water.
  for (const [i, at] of (
    [
      [51.8, -1],
      [54.3, -1],
      [56.8, -1],
      [53.2, 2.5],
      [55.7, 2.5],
      [58.2, 2.5],
    ] as Vec2[]
  ).entries()) {
    seat(`pool_${pad(i + 1)}`, 'F1', at, 180, 'lounger');
  }
  for (let i = 0; i < 4; i++)
    seat(`cafe_terrace_${pad(i + 1)}`, 'F1', [46 + i * 4, 56.5], 180, 'chair');
  for (let i = 0; i < 4; i++)
    seat(`cafe_terrace_${pad(i + 5)}`, 'F1', [44, 44 + i * 3.5], 90, 'chair');
  for (let i = 0; i < 4; i++) seat(`lobby_${pad(i + 1)}`, 'F1', [17.5, 21 + i * 2.4], 90, 'sofa');

  const receptionist = local(receptionDesk, 0, -1.1);
  place('npc_spot', 'npc.reception', 'F1', receptionist, {
    name: vi('Lễ tân'),
    yawDeg: receptionDesk.yawDeg,
  });
  place('npc_spot', 'npc.security', 'F1', [12, facadeZ(12) + 2], {
    name: vi('Bảo vệ'),
    yawDeg: facing([12, facadeZ(12) + 2], fountainCentre),
  });
  place('npc_spot', 'npc.barista', 'F1', local(coffeeBar, 0, -0.95), {
    name: vi('Nhân viên pha chế'),
    yawDeg: coffeeBar.yawDeg,
  });

  // Hiding places for a wandering mascot (objective type `find`).
  const mascotSpots: Vec2[] = [
    [66, 54],
    [WEST_FENCE + 2.5, -20],
    [WEST_FENCE + 12, bankZ(WEST_FENCE + 12) - 6],
    [50, -42.6],
    [-18, -52],
    [-100, -43],
    [-60, 38],
    [16.6, 11],
    [40, -8],
    [80, 70],
  ];
  spawnSets.mascot_spots = mascotSpots.map((at, i) =>
    place('npc_spot', `npc.mascot_${pad(i + 1)}`, 'F1', at),
  );

  const kiosk = (id: string, name: string, floor: FloorId, at: Vec2, lookAt: Vec2) =>
    place('kiosk_spot', `kiosk.${id}`, floor, at, { name: vi(name), yawDeg: facing(at, lookAt) });

  kiosk('lobby', 'Kiosk sảnh lễ tân', 'F1', [28, 28], entranceDoor);
  kiosk('atrium', 'Kiosk Atrium', 'F1', [15, -9], [0, 2]);
  kiosk('canteen', 'Kiosk canteen', 'F1', [8, -20], [20, -20]);
  kiosk('pool', 'Kiosk hồ bơi', 'F1', [58.2, 11.5], [50, -10]);
  kiosk('riverside', 'Kiosk ven sông', 'F1', [-90, bankZ(-90) - 11], [-90, 40]);
  kiosk('parking', 'Kiosk bãi xe', 'F1', [-71, 62], [-34, 62]);
  kiosk('block2', 'Kiosk block 2', 'F1', [-86, 30], [-70, 40]);
  kiosk('office_f2', 'Kiosk tầng 2', 'F2', [-30, -22], [0, -22]);
  kiosk('office_f3', 'Kiosk tầng 3', 'F3', [30, 24], [0, 24]);

  const photo = (id: string, name: string, at: Vec2, lookAt: Vec2) =>
    place('photo_spot', `photo.${id}`, 'F1', at, {
      name: vi(name),
      yawDeg: facing(at, lookAt),
      radius: 4,
    });

  photo('gate', 'Trước cổng chính', [21, 41], entranceDoor);
  photo('atrium', 'Trước khán đài Atrium', [-6, 9], [-6, -6]);
  photo('riverside', 'Bờ sông', promenadeAt(21), [21, 110]);
  photo('pool', 'Bên hồ bơi', [57.6, -3.2], [47, -22]);

  // --- Scatter sets for collect-style objectives -------------------------------------------------

  const random = createRandom(20261112);

  interface ScatterOptions {
    count: number;
    floor: FloorId;
    /** Regions to draw from; larger regions get proportionally more points. */
    within: readonly Polygon[];
    minSpacing: number;
    /** Outlines to stay clear of (walls, water edges, stairwells) and by how much. */
    clearOf: readonly Polygon[];
    clearance: number;
    /** Furniture to keep out of and the same distance away from. */
    avoid?: readonly Polygon[];
  }

  const scatter = ({
    count,
    floor,
    within,
    minSpacing,
    clearOf,
    clearance,
    avoid = [],
  }: ScatterOptions): Vec2[] => {
    const weights = within.map((region) => polygonArea(region));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const picked: Vec2[] = [];
    for (let attempt = 0; picked.length < count; attempt++) {
      if (attempt > 50_000)
        throw new Error(`could only place ${picked.length} of ${count} points on ${floor}`);
      let roll = random() * total;
      let region = within[0] as Polygon;
      for (let i = 0; i < within.length; i++) {
        roll -= weights[i] as number;
        if (roll <= 0) {
          region = within[i] as Polygon;
          break;
        }
      }
      const xs = region.map((p) => p[0]);
      const zs = region.map((p) => p[1]);
      const candidate: Vec2 = [
        Math.min(...xs) + random() * (Math.max(...xs) - Math.min(...xs)),
        Math.min(...zs) + random() * (Math.max(...zs) - Math.min(...zs)),
      ];
      if (!pointInPolygon(candidate, region) || !isWalkable(index, candidate, floor)) continue;
      if (clearOf.some((outline) => distanceToOutline(candidate, outline) < clearance)) continue;
      if (
        avoid.some(
          (outline) =>
            pointInPolygon(candidate, outline) || distanceToOutline(candidate, outline) < clearance,
        )
      )
        continue;
      if (picked.some((other) => distance(other, candidate) < minSpacing)) continue;
      if (pois.some((poi) => poi.floor === floor && distance(poi.position, candidate) < 1.5))
        continue;
      picked.push(candidate);
    }
    return picked;
  };

  const footprints = structures.map((structure) => structure.footprint);
  const flights = connectors.map(connectorFootprint);

  // Open-plan offices: rows of white desks, two blocks of four end to end with a wooden planter
  // box at the end, and plant shelves here and there (photos). Rooms, booths, the gallery round
  // the atrium and every point of interest are kept clear.
  // Walkways kept free of desks: from the atrium to the doorway into block 2 and on along its
  // spine, and round the top and bottom of every flight of stairs.
  const walkways: Polygon[] = [
    stripPolygon(blockLink, [-26, -20], 4),
    stripPolygon([-26, -20], [-17, -9], 4),
    stripPolygon(blockLink, [-110, -20], 4),
  ];
  const landingsOn = (floor: FloorId): Polygon[] =>
    connectors.flatMap((c) => {
      const run = distance(c.lower.at, c.upper.at);
      const zones: Polygon[] = [];
      if (c.upper.floor === floor)
        zones.push(ellipse(lerp(c.lower.at, c.upper.at, 1 + 2 / run), 3.5, 3.5, 12));
      if (c.lower.floor === floor)
        zones.push(ellipse(lerp(c.lower.at, c.upper.at, -2 / run), 3.5, 3.5, 12));
      return zones;
    });
  for (const floor of upperFloors) {
    const rooms = areas.filter((a) => a.floor === floor && a.tags.includes('room'));
    const keepOut = [
      ...fixturesOn(floor).map(outlineOf),
      ...rooms.map((room) => room.polygon),
      ...walkways,
      ...landingsOn(floor),
    ];
    const walls = [mainFootprint, block2Footprint, ...flights];
    const nearby = pois.filter((poi) => poi.floor === floor).map((poi) => poi.position);
    const clear = (footprint: Polygon, p: Vec2) =>
      pointInPolygon(p, footprint) &&
      isWalkable(index, p, floor) &&
      walls.every((outline) => distanceToOutline(p, outline) > 1) &&
      distanceToOutline(p, atriumVoid) > 3 &&
      keepOut.every(
        (outline) => !pointInPolygon(p, outline) && distanceToOutline(p, outline) > 1.2,
      );
    for (const footprint of [mainFootprint, block2Footprint]) {
      const xs = footprint.map((p) => p[0]);
      const zs = footprint.map((p) => p[1]);
      let row = 0;
      for (let z = Math.ceil(Math.min(...zs)) + 3; z < Math.max(...zs); z += 5.8) {
        for (let x = Math.ceil(Math.min(...xs)) + 3; x < Math.max(...xs); x += 9.8) {
          const reach: Vec2[] = [];
          for (const dx of [-1.9, 1.75, 5.4, 5.9])
            for (const dz of [-1.5, 0, 1.5]) reach.push([x + dx, z + dz]);
          if (!reach.every((p) => clear(footprint, p))) continue;
          if (nearby.some((p) => p[0] > x - 3.4 && p[0] < x + 7.4 && Math.abs(p[1] - z) < 3))
            continue;
          fixture('desk_cluster', floor, [x, z]);
          fixture('desk_cluster', floor, [x + 3.4, z]);
          fixture('planter_box', floor, [x + 5.4, z]);
          row++;
          const shelf: Vec2 = [x + 7.6, z];
          if (
            row % 3 === 0 &&
            clear(footprint, [x + 7.6, z - 1.3]) &&
            clear(footprint, [x + 7.6, z + 1.3])
          )
            fixture('plant_shelf', floor, shelf, 90);
        }
      }
    }
  }

  // Nothing but its own seats may stand in a piece of furniture.
  for (const poi of pois) {
    if (poi.kind === 'seat') continue;
    const blocked = fixturesOn(poi.floor).find(
      (f) =>
        pointInPolygon(poi.position, outlineOf(f)) ||
        distanceToOutline(poi.position, outlineOf(f)) < 0.5,
    );
    if (blocked)
      throw new Error(`${poi.id} stands in ${blocked.model} at ${blocked.at.join(', ')}`);
  }
  const furnitureOn = (floor: FloorId) => fixturesOn(floor).map(outlineOf);
  const itemSet = (name: string, options: ScatterOptions) => {
    spawnSets[name] = scatter(options).map((at, i) =>
      place('item_spot', `item.${name}_${pad(i + 1)}`, options.floor, at),
    );
  };

  itemSet('outdoor_common', {
    count: 40,
    floor: 'F1',
    within: [site],
    minSpacing: 9,
    clearOf: [...footprints, poolOutline, site],
    clearance: 2.5,
  });
  itemSet('indoor_f1_common', {
    count: 24,
    floor: 'F1',
    within: [mainFootprint, block2Footprint],
    minSpacing: 7,
    clearOf: [mainFootprint, block2Footprint, koiPond, ...flights],
    clearance: 2,
    avoid: furnitureOn('F1'),
  });
  for (const floor of upperFloors) {
    itemSet(`office_${floor.toLowerCase()}`, {
      count: 16,
      floor,
      within: [mainFootprint, block2Footprint],
      minSpacing: 9,
      clearOf: [mainFootprint, block2Footprint, atriumVoid, ...flights],
      clearance: 2,
      avoid: furnitureOn(floor),
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Props. Seats are not listed here: the builder draws furniture for every seat POI.
  // ---------------------------------------------------------------------------------------------

  type Instance = PropGroup['instances'][number];
  const groups = new Map<string, Instance[]>();
  const prop = (
    model: string,
    floor: FloorId,
    at: Vec2,
    options: { yawDeg?: number; s?: number } = {},
  ) => {
    // Solid props stay off the spots where items, seats and characters are placed.
    const clearance = PROP_CLEARANCE[model] ?? 1.5;
    if (pois.some((poi) => poi.floor === floor && distance(poi.position, at) < clearance)) return;
    add(model, floor, at, options);
  };
  /** Adds a prop without looking around: fixed furniture was checked when it was laid out. */
  const add = (
    model: string,
    floor: FloorId,
    at: Vec2,
    options: { yawDeg?: number; s?: number },
  ) => {
    const instance: Instance = { p: roundVec(at), floor };
    if (options.yawDeg !== undefined) instance.yawDeg = Math.round(options.yawDeg);
    if (options.s !== undefined) instance.s = Math.round(options.s * 100) / 100;
    const list = groups.get(model) ?? [];
    list.push(instance);
    groups.set(model, list);
  };
  const variation = () => ({ yawDeg: random() * 360, s: 0.85 + random() * 0.35 });

  // A row of trees inside the road-side fence: the campus turns its back to the main road.
  for (let x = WEST_FENCE + 4; x <= 86; x += 9)
    prop('tree_a', 'F1', [x + (random() - 0.5) * 2, -54 + random()], variation());
  // Two staggered rows in the riverside park.
  for (let x = WEST_FENCE + 8; x <= 80; x += 12) {
    for (const [offset, shift] of [
      [14, 0],
      [22, 6],
    ] as const) {
      const at: Vec2 = [x + shift, bankZ(x + shift) - offset];
      if (Math.abs(at[0] - 21) > 4 && isWalkable(index, at, 'F1'))
        prop('tree_b', 'F1', at, variation());
    }
  }
  // The hedge line along the west fence.
  for (let z = -40; z <= 46; z += 8) prop('tree_b', 'F1', [WEST_FENCE + 1.6, z], variation());
  prop('planter_round', 'F1', [-52.5, 16]);
  // Trees around the round planter in the garden.
  for (const at of ellipse([-52.5, 16], 9.5, 9.5, 7)) prop('tree_b', 'F1', at, variation());

  // Street lamps on the outer side of the internal road.
  const campusCentre: Vec2 = [-30, 5];
  for (let along = 6; along < loopLength; along += 22) {
    const { point, direction } = pointAlongPolyline(loop, along);
    const normal: Vec2 = [-direction[1], direction[0]];
    const side =
      (point[0] - campusCentre[0]) * normal[0] + (point[1] - campusCentre[1]) * normal[1] > 0
        ? 1
        : -1;
    const at: Vec2 = [point[0] + normal[0] * side * 4.2, point[1] + normal[1] * side * 4.2];
    if (isWalkable(index, at, 'F1')) prop('lamp', 'F1', at, { yawDeg: yawDegOf(direction) });
  }

  // Parked cars, nose-in along the river-side drive, with a few empty bays.
  for (let x = -66; x <= 4; x += 2.8) {
    if (random() < 0.7) prop('car', 'F1', [x, 62.5], { yawDeg: random() < 0.5 ? 0 : 180 });
  }

  // The main entrance: the orange V-shaped canopy over the doors, and the VNG sign high on the
  // south facade (both in VNG's photos).
  const canopyAt: Vec2 = [entranceDoor[0] + outward[0] * 3.2, entranceDoor[1] + outward[1] * 3.2];
  prop('canopy_v', 'F1', canopyAt, { yawDeg: yawDegOf(outward) });
  const signAt: Vec2 = [-6 + outward[0] * 0.3, facadeZ(-6) + outward[1] * 0.3];
  prop('logo_sign', 'F3', signAt, { yawDeg: yawDegOf(outward), s: 10 });

  for (const at of [
    [-16, -9],
    [15, 13],
    [-15, 13],
    [11, -9],
  ] as Vec2[]) {
    prop('planter', 'F1', at, { s: 1.2 });
  }

  for (const f of fixtures) add(f.model, f.floor, f.at, f.yawDeg === 0 ? {} : { yawDeg: f.yawDeg });
  // Wooden slats with bare bulbs hang over every canteen table (photos).
  for (const table of canteenTables) add('slat_ceiling', 'F1', table.at, {});

  const props: PropGroup[] = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([model, instances]) => ({ model, instances }));

  // Parsing validates the result and normalises key order, so the output is stable to serialise.
  return campusMapSchema.parse({ ...draft, pois, spawnSets, props });
}
