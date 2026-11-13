import { readFileSync } from 'node:fs';
import {
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
import { buildCampusV0 } from './campus-v0';
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

  it('puts every POI where there is floor to stand on', () => {
    const stranded = map.pois.filter((poi) => !isWalkable(index, poi.position, poi.floor));
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
    const guessed = ['area.lobby', 'area.canteen', 'area.koi', 'area.gate_main', 'area.gym'];
    for (const id of guessed) expect(index.areas.get(id)?.tags, id).toContain('placeholder');
  });
});
