/**
 * The campus map format (docs/03-world-and-assets.md §4). One document describes the geography
 * that the client renders, the realtime server validates against and the admin tools pick from.
 *
 * Conventions:
 * - Coordinates are `[x, z]` in campus-local metres (see ./frame.ts).
 * - Yaw is in degrees about the up axis: 0° faces +Z (the river), 90° faces +X (north-east).
 * - Ids are stable keys. Missions reference them, so renaming or removing one is a breaking
 *   change and needs a major version bump.
 */
import { z } from 'zod';

export const vec2Schema = z.tuple([z.number(), z.number()]);
export const polygonSchema = z.array(vec2Schema).min(3);
export const floorIdSchema = z.enum(['F1', 'F2', 'F3', 'ROOF']);
export const localizedTextSchema = z.object({ vi: z.string().min(1), en: z.string().optional() });

const id = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}\\.[a-z0-9_.]+$`), `must look like "${prefix}.some_name"`);

export const floorSchema = z.object({
  id: floorIdSchema,
  /** Height of the walking surface above the ground. */
  y: z.number(),
  /** Clear height up to the next slab. */
  height: z.number().positive(),
  label: localizedTextSchema,
});

export const areaSchema = z.object({
  id: id('area'),
  name: localizedTextSchema,
  floor: floorIdSchema,
  polygon: polygonSchema,
  kind: z.enum(['outdoor', 'indoor', 'water', 'restricted']),
  walkable: z.boolean(),
  /** Free-form markers: `base`, `landmark`, `event`, `placeholder`… */
  tags: z.array(z.string()),
});

export const structureSchema = z.object({
  id: id('structure'),
  name: localizedTextSchema,
  footprint: polygonSchema,
  /** Floors with a slab to stand on, lowest first. The roof sits on top of the last one. */
  floors: z.array(floorIdSchema).min(1),
  /** Holes in slabs, such as the atrium. `ROOF` in `floors` makes it a skylight. */
  voids: z.array(
    z.object({
      id: z.string().min(1),
      polygon: polygonSchema,
      floors: z.array(floorIdSchema).min(1),
    }),
  ),
  /** Doorways. `at` lies on a footprint edge; the wall is cut `width` metres wide around it. */
  openings: z.array(
    z.object({
      id: id('door'),
      floor: floorIdSchema,
      at: vec2Schema,
      width: z.number().positive(),
    }),
  ),
  /** Roof level for a single-storey building that is lower than a full floor. */
  height: z.number().positive().optional(),
  /** Key the greybox builder uses to pick colours and wall treatment. */
  style: z.string().min(1),
  /** Asset key of the modelled replacement, once art exists. */
  model: z.string().optional(),
});

export const pathSchema = z.object({
  id: id('path'),
  kind: z.enum(['road', 'walkway', 'track']),
  floor: floorIdSchema,
  points: z.array(vec2Schema).min(2),
  width: z.number().positive(),
  closed: z.boolean(),
});

const connectorEndSchema = z.object({ floor: floorIdSchema, at: vec2Schema });

/**
 * A straight flight between two floors: a ramp surface from `lower.at` up to `upper.at`.
 * The builder cuts the strip out of the upper slab so there is headroom.
 */
export const connectorSchema = z.object({
  id: id('connector'),
  kind: z.enum(['stairs', 'ramp']),
  structure: id('structure'),
  lower: connectorEndSchema,
  upper: connectorEndSchema,
  width: z.number().positive(),
});

export const poiSchema = z.object({
  id: id('poi'),
  kind: z.enum([
    'spawn',
    'checkpoint',
    'seat',
    'npc_spot',
    'kiosk_spot',
    'photo_spot',
    'item_spot',
  ]),
  name: localizedTextSchema.optional(),
  floor: floorIdSchema,
  position: vec2Schema,
  /** Overrides the floor height, for things that are not at floor level. */
  y: z.number().optional(),
  yawDeg: z.number().optional(),
  radius: z.number().positive().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const propGroupSchema = z.object({
  /** Asset key; every instance is drawn with instancing. */
  model: z.string().min(1),
  instances: z.array(
    z.object({
      p: vec2Schema,
      floor: floorIdSchema,
      yawDeg: z.number().optional(),
      /** Uniform scale, default 1. */
      s: z.number().positive().optional(),
    }),
  ),
});

const FLOOR_ORDER = floorIdSchema.options;

export const campusMapSchema = z
  .object({
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'must be semver'),
    meta: z.object({
      origin: z.object({ lat: z.number(), lon: z.number() }),
      xAxisBearingDeg: z.number(),
      /** Everything in the map lies inside this box; nothing outside it is reachable. */
      bounds: z.object({ min: vec2Schema, max: vec2Schema }),
    }),
    floors: z.array(floorSchema).min(1),
    areas: z.array(areaSchema),
    structures: z.array(structureSchema),
    paths: z.array(pathSchema),
    connectors: z.array(connectorSchema),
    pois: z.array(poiSchema),
    /** Named groups of POI ids: spawn groups for players, scatter sets for mission items. */
    spawnSets: z.record(z.string(), z.array(id('poi')).min(1)),
    props: z.array(propGroupSchema),
  })
  .superRefine((map, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });

    const floorIds = new Set(map.floors.map((floor) => floor.id));
    if (floorIds.size !== map.floors.length) issue(['floors'], 'duplicate floor id');
    for (let i = 1; i < map.floors.length; i++) {
      if ((map.floors[i]?.y ?? 0) <= (map.floors[i - 1]?.y ?? 0)) {
        issue(['floors', i, 'y'], 'floors must be listed from lowest to highest');
      }
    }

    const collections = {
      areas: map.areas,
      structures: map.structures,
      paths: map.paths,
      connectors: map.connectors,
      pois: map.pois,
    };
    for (const [name, items] of Object.entries(collections)) {
      const seen = new Set<string>();
      items.forEach((item, index) => {
        if (seen.has(item.id)) issue([name, index, 'id'], `duplicate id "${item.id}"`);
        seen.add(item.id);
      });
    }

    const needsFloor = (floor: string, path: (string | number)[]) => {
      if (!floorIds.has(floor as (typeof FLOOR_ORDER)[number]))
        issue(path, `unknown floor "${floor}"`);
    };
    for (const [i, area] of map.areas.entries()) needsFloor(area.floor, ['areas', i, 'floor']);
    for (const [i, path] of map.paths.entries()) needsFloor(path.floor, ['paths', i, 'floor']);
    for (const [i, poi] of map.pois.entries()) needsFloor(poi.floor, ['pois', i, 'floor']);
    for (const [g, group] of map.props.entries()) {
      for (const [i, instance] of group.instances.entries()) {
        needsFloor(instance.floor, ['props', g, 'instances', i, 'floor']);
      }
    }

    const structures = new Map(map.structures.map((structure) => [structure.id, structure]));
    map.structures.forEach((structure, s) => {
      for (const [i, floor] of structure.floors.entries()) {
        needsFloor(floor, ['structures', s, 'floors', i]);
      }
      structure.openings.forEach((opening, i) => {
        if (!structure.floors.includes(opening.floor)) {
          issue(
            ['structures', s, 'openings', i, 'floor'],
            'opening is on a floor the structure does not have',
          );
        }
      });
      structure.voids.forEach((hole, i) => {
        for (const floor of hole.floors) {
          if (floor !== 'ROOF' && !structure.floors.includes(floor)) {
            issue(
              ['structures', s, 'voids', i, 'floors'],
              `void is on "${floor}", which the structure does not have`,
            );
          }
        }
      });
    });

    map.connectors.forEach((connector, i) => {
      const structure = structures.get(connector.structure);
      if (!structure) {
        issue(['connectors', i, 'structure'], `unknown structure "${connector.structure}"`);
        return;
      }
      const lower = structure.floors.indexOf(connector.lower.floor);
      const upper = structure.floors.indexOf(connector.upper.floor);
      if (lower < 0 || upper < 0)
        issue(['connectors', i], 'connects a floor the structure does not have');
      else if (upper !== lower + 1)
        issue(['connectors', i], 'must connect a floor to the one directly above');
    });

    const poiIds = new Set(map.pois.map((poi) => poi.id));
    for (const [name, ids] of Object.entries(map.spawnSets)) {
      ids.forEach((poiId, i) => {
        if (!poiIds.has(poiId)) issue(['spawnSets', name, i], `unknown POI "${poiId}"`);
      });
    }
  });

export type FloorId = z.infer<typeof floorIdSchema>;
export type LocalizedText = z.infer<typeof localizedTextSchema>;
export type Floor = z.infer<typeof floorSchema>;
export type Area = z.infer<typeof areaSchema>;
export type Structure = z.infer<typeof structureSchema>;
export type Path = z.infer<typeof pathSchema>;
export type Connector = z.infer<typeof connectorSchema>;
export type Poi = z.infer<typeof poiSchema>;
export type PoiKind = Poi['kind'];
export type PropGroup = z.infer<typeof propGroupSchema>;
export type CampusMap = z.infer<typeof campusMapSchema>;
