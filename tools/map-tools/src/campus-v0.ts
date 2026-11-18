/**
 * Builds the campus map: real footprints from OpenStreetMap, the outdoor layout checked against
 * satellite imagery and VNG's own photos (map 0.2, docs/03-world-and-assets.md §1.3), and an
 * assumed layout for what no public source shows yet (interiors, stairs, seats). Assumed pieces
 * carry the `placeholder` tag and get corrected against real floor plans later (P6.2).
 *
 * The output is deterministic: the same extract always yields the same map.
 */
import {
  type Area,
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
  desk_cluster: 2.6,
  plant_shelf: 1.8,
  // Overhead or on a wall: nothing on the ground to keep clear of.
  canopy_v: 0,
  logo_sign: 0,
  planter_round: 0,
};

const vi = (text: string) => ({ vi: text });
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

  const connectors: Connector[] = [
    // Two grand stairs rising out of the atrium floor to the edge of the F2 gallery.
    flight('main.north_1', 'structure.main', 'F1', [-8, -2], 'F2', [-8, -12]),
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
    area('atrium', 'Atrium', 'F1', atriumVoid, 'indoor', ['landmark', 'event']),
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
    area(
      'canteen',
      'Canteen',
      'F1',
      [
        [6, -32],
        [34.7, -32],
        [52, 10],
        [22, 10],
        [22, -14],
        [6, -14],
      ],
      'indoor',
      ['landmark', 'placeholder'],
    ),
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
    area('gym', 'Phòng gym', 'F1', rect(-113, -33, -72, -14), 'indoor', ['placeholder']),

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
    version: '0.2.0',
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

  const place = (
    kind: Poi['kind'],
    id: string,
    floor: FloorId,
    position: Vec2,
    extra: Partial<Pick<Poi, 'name' | 'yawDeg' | 'radius' | 'meta'>> = {},
  ): string => {
    if (!isWalkable(index, position, floor)) {
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
    pois.push(poi);
    return poi.id;
  };
  const facing = (from: Vec2, to: Vec2) => yawDegOf([to[0] - from[0], to[1] - from[1]]);

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

  const seat = (id: string, floor: FloorId, at: Vec2, yawDeg: number, furniture: string) =>
    place('seat', `seat.${id}`, floor, at, { yawDeg, meta: { furniture } });

  // Benches along the river, facing the water.
  for (let i = 0; i < 10; i++) {
    const x = -112 + i * 21;
    seat(`riverside_${pad(i + 1)}`, 'F1', [x, bankZ(x) - 5.5], 0, 'bench');
  }
  // Around the koi pond, facing it. Only eight: these are meant to be contested.
  ellipse([-2, 30], 7.6, 5.1, 8).forEach((at, i) => {
    seat(`koi_${pad(i + 1)}`, 'F1', at, facing(at, [-2, 30]), 'bench');
  });
  for (let i = 0; i < 6; i++)
    seat(`coffee_${pad(i + 1)}`, 'F1', [6.5 + i * 1.2, 28.6], 180, 'stool');
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 6; column++) {
      const at: Vec2 = [10 + column * 4.2, -29 + row * 3.6];
      seat(`canteen_${pad(row * 6 + column + 1)}`, 'F1', at, row % 2 === 0 ? 0 : 180, 'chair');
    }
  }
  for (let i = 0; i < 8; i++) seat(`atrium_${pad(i + 1)}`, 'F1', [-16.5, -6 + i * 2], 90, 'step');
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
  for (let i = 0; i < 4; i++) seat(`lobby_${pad(i + 1)}`, 'F1', [32, 19.5 + i * 2.6], -90, 'sofa');

  place('npc_spot', 'npc.reception', 'F1', [21, 22], {
    name: vi('Lễ tân'),
    yawDeg: facing([21, 22], entranceDoor),
  });
  place('npc_spot', 'npc.security', 'F1', [12, facadeZ(12) + 2], {
    name: vi('Bảo vệ'),
    yawDeg: facing([12, facadeZ(12) + 2], fountainCentre),
  });
  place('npc_spot', 'npc.barista', 'F1', [9, 23.5], { name: vi('Nhân viên pha chế'), yawDeg: 0 });

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
  photo('atrium', 'Giữa Atrium', [0, 10], [0, -12]);
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
  }

  const scatter = ({
    count,
    floor,
    within,
    minSpacing,
    clearOf,
    clearance,
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
      if (picked.some((other) => distance(other, candidate) < minSpacing)) continue;
      if (pois.some((poi) => poi.floor === floor && distance(poi.position, candidate) < 1.5))
        continue;
      picked.push(candidate);
    }
    return picked;
  };

  const footprints = structures.map((structure) => structure.footprint);
  const flights = connectors.map(connectorFootprint);
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
  });
  for (const floor of upperFloors) {
    itemSet(`office_${floor.toLowerCase()}`, {
      count: 16,
      floor,
      within: [mainFootprint, block2Footprint],
      minSpacing: 9,
      clearOf: [mainFootprint, block2Footprint, atriumVoid, ...flights],
      clearance: 2,
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
    [-15, -9],
    [15, 13],
    [-15, 13],
    [11, -9],
  ] as Vec2[]) {
    prop('planter', 'F1', at, { s: 1.2 });
  }

  // Open-plan offices: a grid of desk clusters with a plant shelf between some of them.
  for (const floor of upperFloors) {
    const obstacles = [mainFootprint, block2Footprint, atriumVoid, ...flights];
    for (const footprint of [mainFootprint, block2Footprint]) {
      const xs = footprint.map((p) => p[0]);
      const zs = footprint.map((p) => p[1]);
      let cell = 0;
      for (let x = Math.ceil(Math.min(...xs)) + 5; x < Math.max(...xs); x += 9) {
        for (let z = Math.ceil(Math.min(...zs)) + 5; z < Math.max(...zs); z += 7) {
          cell++;
          const at: Vec2 = [x, z];
          const clear = (p: Vec2, margin: number) =>
            pointInPolygon(p, footprint) &&
            isWalkable(index, p, floor) &&
            obstacles.every((outline) => distanceToOutline(p, outline) > margin);
          if (clear(at, 4)) prop('desk_cluster', floor, at, { yawDeg: cell % 2 === 0 ? 0 : 90 });
          const between: Vec2 = [x + 4.5, z + 3.5];
          if (cell % 3 === 0 && clear(between, 3))
            prop('plant_shelf', floor, between, { yawDeg: 90 });
        }
      }
    }
  }

  const props: PropGroup[] = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([model, instances]) => ({ model, instances }));

  // Parsing validates the result and normalises key order, so the output is stable to serialise.
  return campusMapSchema.parse({ ...draft, pois, spawnSets, props });
}
