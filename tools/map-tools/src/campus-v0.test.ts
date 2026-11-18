import { readFileSync } from 'node:fs';
import {
  BLEACHER_MAX_RISE,
  bleacherHeight,
  bleacherLayout,
  bleacherPosition,
  boundsContain,
  campusMapSchema,
  connectorFootprint,
  createMapIndex,
  distance,
  distanceToOutline,
  isWalkable,
  lerp,
  nearestEdge,
  pointInPolygon,
  type Vec2,
} from '@campus/map-data';
import { describe, expect, it } from 'vitest';
import { buildCampusV0, EXTENT } from './campus-v0';
import { formatCampusMap } from './format';
import { loadOsmExtract } from './osm';
import { CAMPUS_JSON, OSM_EXTRACT } from './paths';

const build = () => buildCampusV0(loadOsmExtract(OSM_EXTRACT));
const map = build();
const index = createMapIndex(map);
const structure = (id: string) => {
  const found = index.structures.get(id);
  if (!found) throw new Error(`no structure ${id}`);
  return found;
};

describe('campus v0', () => {
  it('satisfies the schema', () => {
    expect(campusMapSchema.safeParse(map).error?.issues ?? []).toEqual([]);
  });

  it('is deterministic', () => {
    expect(formatCampusMap(build())).toBe(formatCampusMap(map));
  });

  it('is what is committed in packages/map-data — run `pnpm map:build` after changing the generator', () => {
    expect(formatCampusMap(map)).toBe(readFileSync(CAMPUS_JSON, 'utf8'));
  });

  it('keeps everything inside the map bounds', () => {
    const { bounds } = map.meta;
    const outside = [
      ...map.areas.flatMap((area) => area.polygon.map((p) => [area.id, p] as const)),
      ...map.structures.flatMap((s) => s.footprint.map((p) => [s.id, p] as const)),
      ...map.paths.flatMap((path) => path.points.map((p) => [path.id, p] as const)),
      ...map.pois.map((poi) => [poi.id, poi.position] as const),
      ...map.props.flatMap((group) => group.instances.map((i) => [group.model, i.p] as const)),
    ].filter(([, point]) => !boundsContain(bounds, point));
    expect(outside).toEqual([]);
  });

  it('puts every POI where there is floor to stand on, or a seat on a bleacher tier', () => {
    const onTier = (poi: (typeof map.pois)[number]) =>
      map.connectors.some((connector) => {
        if (connector.kind !== 'bleachers' || connector.lower.floor !== poi.floor) return false;
        const y0 = index.floors.get(connector.lower.floor)?.y ?? 0;
        const layout = bleacherLayout(
          connector,
          y0,
          index.floors.get(connector.upper.floor)?.y ?? 0,
        );
        const at = bleacherPosition(connector, layout, poi.position);
        return (
          at !== null &&
          Math.abs(y0 + bleacherHeight(layout, at.along, at.offset) - (poi.y ?? 0)) < 0.01
        );
      });
    const stranded = map.pois.filter((poi) =>
      poi.y === undefined
        ? !isWalkable(index, poi.position, poi.floor)
        : poi.kind !== 'seat' || !onTier(poi),
    );
    expect(stranded.map((poi) => poi.id)).toEqual([]);
  });

  it('gives every seat room of its own', () => {
    const seats = map.pois.filter((poi) => poi.kind === 'seat');
    expect(seats.length).toBeGreaterThanOrEqual(60);
    for (const a of seats) {
      for (const b of seats) {
        if (a !== b && a.floor === b.floor) {
          expect(distance(a.position, b.position), `${a.id} / ${b.id}`).toBeGreaterThan(0.9);
        }
      }
    }
  });

  it('cuts every doorway into a wall of its own structure', () => {
    for (const s of map.structures) {
      for (const opening of s.openings) {
        expect(nearestEdge(opening.at, s.footprint).distance, opening.id).toBeLessThan(0.05);
      }
    }
  });

  it('keeps slab holes inside their structure, clear of the outer walls', () => {
    for (const s of map.structures) {
      for (const hole of s.voids) {
        for (const vertex of hole.polygon) {
          expect(pointInPolygon(vertex, s.footprint), `${s.id}/${hole.id}`).toBe(true);
          expect(distanceToOutline(vertex, s.footprint), `${s.id}/${hole.id}`).toBeGreaterThan(2);
        }
      }
    }
  });

  it('keeps indoor areas inside a building', () => {
    for (const area of map.areas.filter((a) => a.kind === 'indoor')) {
      const inside = (p: Vec2) =>
        map.structures.some(
          (s) => pointInPolygon(p, s.footprint) || distanceToOutline(p, s.footprint) < 0.05,
        );
      expect(area.polygon.every(inside), area.id).toBe(true);
    }
  });

  it('builds stairs that are gentle enough to climb and that land on a floor at both ends', () => {
    expect(map.connectors.length).toBeGreaterThanOrEqual(6);
    for (const connector of map.connectors) {
      const lowerY = index.floors.get(connector.lower.floor)?.y ?? Number.NaN;
      const upperY = index.floors.get(connector.upper.floor)?.y ?? Number.NaN;
      const run = distance(connector.lower.at, connector.upper.at);
      const slopeDeg = (Math.atan2(upperY - lowerY, run) * 180) / Math.PI;
      expect(slopeDeg, connector.id).toBeGreaterThan(10);
      expect(slopeDeg, connector.id).toBeLessThan(35);

      const footprint = structure(connector.structure).footprint;
      for (const corner of connectorFootprint(connector)) {
        expect(pointInPolygon(corner, footprint), connector.id).toBe(true);
      }

      // One metre before the bottom step and one metre past the top step.
      const before = lerp(connector.lower.at, connector.upper.at, -1 / run);
      const beyond = lerp(connector.lower.at, connector.upper.at, 1 + 1 / run);
      expect(isWalkable(index, before, connector.lower.floor), `${connector.id} bottom`).toBe(true);
      expect(isWalkable(index, beyond, connector.upper.floor), `${connector.id} top`).toBe(true);
    }
  });

  it('lets every upper floor be reached from the ground in both blocks', () => {
    for (const id of ['structure.main', 'structure.block2']) {
      const reached = new Set(['F1']);
      for (const connector of map.connectors.filter((c) => c.structure === id)) {
        if (reached.has(connector.lower.floor)) reached.add(connector.upper.floor);
      }
      expect([...reached].sort(), id).toEqual(structure(id).floors);
    }
  });

  it('provides the sets that spawning and missions rely on', () => {
    const sizes = Object.fromEntries(
      Object.entries(map.spawnSets).map(([name, ids]) => [name, ids.length]),
    );
    expect(sizes).toEqual({
      players_gate: 8,
      race_loop: 6,
      mascot_spots: 10,
      outdoor_common: 40,
      indoor_f1_common: 24,
      office_f2: 16,
      office_f3: 16,
    });
  });

  it('marks guessed interiors as placeholders', () => {
    const guessed = [
      'area.lobby',
      'area.canteen',
      'area.koi',
      'area.gym',
      'area.yoga',
      'area.meeting.f2_01',
      'area.pantry.f3',
    ];
    for (const id of guessed) expect(index.areas.get(id)?.tags, id).toContain('placeholder');
  });
});

describe('outdoor layout checked against public sources (map 0.2)', () => {
  const areaOf = (id: string) => map.areas.find((area) => area.id === id);

  it('has the main entrance on the river side, in front of the doors under the canopy', () => {
    const gate = areaOf('area.gate_main');
    expect(gate?.tags).not.toContain('placeholder');
    const door = map.structures[0]?.openings.find((o) => o.id === 'door.main.south');
    const spawns = map.pois.filter((poi) => poi.id.startsWith('poi.spawn.gate_'));
    expect(spawns).toHaveLength(8);
    for (const spawn of spawns) {
      expect(spawn.position[1]).toBeGreaterThan(30);
      expect(
        Math.hypot(spawn.position[0] - (door?.at[0] ?? 0), spawn.position[1] - (door?.at[1] ?? 0)),
      ).toBeLessThan(10);
    }
    const canopy = map.props.find((group) => group.model === 'canopy_v')?.instances ?? [];
    expect(canopy).toHaveLength(1);
  });

  it('parks cars along the river-side drive, not on the open lot to the west', () => {
    const cars = map.props.find((group) => group.model === 'car')?.instances ?? [];
    expect(cars.length).toBeGreaterThan(10);
    for (const car of cars) {
      expect(car.p[1]).toBeGreaterThan(57);
      expect(car.p[0]).toBeGreaterThan(-126);
    }
  });

  it('puts the VNG sign high on the south facade, facing the river', () => {
    const [sign] = map.props.find((group) => group.model === 'logo_sign')?.instances ?? [];
    expect(sign?.floor).toBe('F3');
    expect(Math.abs((sign?.yawDeg ?? 90) - 0)).toBeLessThan(30);
  });
});

describe('interiors furnished after public photos (map 0.3)', () => {
  const instances = (model: string) =>
    map.props.find((group) => group.model === model)?.instances ?? [];
  /** Ground a prop covers, from the same extents the generator uses. */
  const outline = (model: string, instance: { p: Vec2; yawDeg?: number }): Vec2[] => {
    const [x0, z0, x1, z1] = EXTENT[model] ?? [0, 0, 0, 0];
    const yaw = ((instance.yawDeg ?? 0) * Math.PI) / 180;
    const local = (x: number, z: number): Vec2 => [
      instance.p[0] + x * Math.cos(yaw) + z * Math.sin(yaw),
      instance.p[1] - x * Math.sin(yaw) + z * Math.cos(yaw),
    ];
    return [local(x0, z0), local(x1, z0), local(x1, z1), local(x0, z1)];
  };
  const inArea = (id: string, point: Vec2) => {
    const area = index.areas.get(id);
    return area !== undefined && pointInPolygon(point, area.polygon);
  };

  it('has wooden bleachers from the atrium floor to the F2 gallery, facing the LED wall', () => {
    const bleachers = map.connectors.filter((c) => c.kind === 'bleachers');
    expect(bleachers).toHaveLength(1);
    const [connector] = bleachers;
    if (!connector) return;
    expect([connector.lower.floor, connector.upper.floor]).toEqual(['F1', 'F2']);
    const layout = bleacherLayout(connector, 0, 5);
    expect(layout.rise).toBeLessThanOrEqual(BLEACHER_MAX_RISE);
    expect(layout.depth).toBeGreaterThan(0.6);

    const [wall] = instances('led_wall');
    if (!wall) throw new Error('no LED wall');
    // Downhill from the bleachers is the way the wall faces back from.
    const downhill: Vec2 = [-layout.up[0], -layout.up[1]];
    const toWall: Vec2 = [wall.p[0] - connector.lower.at[0], wall.p[1] - connector.lower.at[1]];
    expect(toWall[0] * downhill[0] + toWall[1] * downhill[1]).toBeGreaterThan(8);
    const beanbags = map.pois.filter((poi) => poi.meta?.furniture === 'beanbag');
    expect(beanbags.length).toBeGreaterThanOrEqual(12);
    for (const seat of beanbags) expect(seat.y, seat.id).toBeGreaterThan(0);
  });

  it('puts the speed gates between the entrance and the atrium, with lanes to walk through', () => {
    const gates = instances('speed_gate').sort((a, b) => a.p[0] - b.p[0]);
    expect(gates.length).toBeGreaterThanOrEqual(6);
    for (const gate of gates) expect(inArea('area.lobby', gate.p), `${gate.p}`).toBe(true);
    for (let i = 1; i < gates.length; i++) {
      const lane = (gates[i]?.p[0] ?? 0) - (gates[i - 1]?.p[0] ?? 0) - 0.22;
      expect(lane).toBeGreaterThan(0.9);
    }
  });

  it('fills the canteen with long tables in front of the serving counters', () => {
    const tables = instances('canteen_table');
    expect(tables.length).toBeGreaterThanOrEqual(20);
    for (const table of tables) {
      for (const corner of outline('canteen_table', table)) {
        expect(inArea('area.canteen', corner), `${table.p}`).toBe(true);
      }
    }
    const counters = instances('food_counter');
    expect(counters.length).toBeGreaterThanOrEqual(3);
    const backRow = Math.min(...tables.map((t) => t.p[1]));
    for (const counter of counters) expect(counter.p[1]).toBeLessThan(backRow);
    const chairs = map.pois.filter((poi) => poi.id.startsWith('poi.seat.canteen_'));
    expect(chairs).toHaveLength(tables.length * 8);
  });

  it('equips the gym inside the gym', () => {
    for (const model of ['gym_rack', 'treadmill', 'rower', 'dumbbell_rack', 'mirror_wall']) {
      expect(instances(model).length, model).toBeGreaterThan(0);
      for (const instance of instances(model)) {
        for (const corner of outline(model, instance)) {
          expect(inArea('area.gym', corner), `${model} ${instance.p}`).toBe(true);
        }
      }
    }
  });

  it('gives each office floor booths, glass meeting rooms with seats, and a pantry', () => {
    for (const floor of ['F2', 'F3'] as const) {
      const on = (model: string) => instances(model).filter((i) => i.floor === floor);
      expect(on('booth_house'), floor).toHaveLength(5);
      expect(on('meeting_room'), floor).toHaveLength(4);
      expect(on('pantry_counter'), floor).toHaveLength(1);
      const key = floor.toLowerCase();
      for (let i = 1; i <= 4; i++) {
        const room = `area.meeting.${key}_0${i}`;
        const seats = map.pois.filter((poi) => poi.id.startsWith(`poi.seat.meeting_${key}_0${i}_`));
        expect(seats, room).toHaveLength(6);
        for (const seat of seats) expect(inArea(room, seat.position), seat.id).toBe(true);
      }
    }
  });

  it('keeps desks out of rooms, and items out of all furniture', () => {
    const rooms = map.areas.filter((area) => area.tags.includes('room'));
    for (const desk of instances('desk_cluster')) {
      const inside = rooms.find(
        (room) =>
          room.floor === desk.floor &&
          outline('desk_cluster', desk).some((p) => pointInPolygon(p, room.polygon)),
      );
      expect(inside?.id, `desk at ${desk.p}`).toBeUndefined();
    }
    const furniture = map.props
      .filter((group) => EXTENT[group.model])
      .flatMap((group) =>
        group.instances.map((i) => ({ floor: i.floor, outline: outline(group.model, i) })),
      );
    const items = map.pois.filter((poi) => poi.kind === 'item_spot');
    for (const item of items) {
      const hit = furniture.find(
        (f) => f.floor === item.floor && pointInPolygon(item.position, f.outline),
      );
      expect(hit, item.id).toBeUndefined();
    }
  });
});
