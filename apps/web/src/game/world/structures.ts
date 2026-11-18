import {
  BLEACHER_LANE,
  bleacherLayout,
  type Connector,
  closestPointOnSegment,
  connectorFootprint,
  type FloorId,
  nearestEdge,
  type Polygon,
  pointInPolygon,
  polygonCentroid,
  type ReadonlyVec2,
  type Structure,
  type Vec2,
} from '@campus/map-data';
import { type BuildContext, LAYER, type LevelId } from './context';
import { along, spansOutsideGaps } from './ground';
import { PALETTE } from './palette';

const WALL_THICKNESS = 0.3;
const GLASS_THICKNESS = 0.08;
/** Opaque band at the foot of each storey. */
const SPANDREL = 0.9;
/** Opaque band under each ceiling. */
const HEADER = 0.6;
const DOOR_HEIGHT = 2.8;
const LINTEL = 0.3;
const SLAB_THICKNESS = 0.3;
const RAIL_HEIGHT = 1.05;
const RAIL_THICKNESS = 0.08;
/** The steel top rail over the glass of a balustrade. */
const TOP_RAIL = 0.06;
const STEP_RISE = 0.18;

const edgeKey = (a: ReadonlyVec2, b: ReadonlyVec2) => {
  const key = (p: ReadonlyVec2) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  return [key(a), key(b)].sort().join('|');
};

interface Storey {
  floor: FloorId;
  y0: number;
  y1: number;
}

function storeysOf(ctx: BuildContext, structure: Structure): Storey[] {
  return structure.floors.map((floor, i) => {
    const y0 = ctx.floorY(floor);
    const next = structure.floors[i + 1];
    const height = structure.height ?? ctx.index.floors.get(floor)?.height ?? 4;
    return { floor, y0, y1: next ? ctx.floorY(next) : y0 + height };
  });
}

/** Holes in the slab of one floor: declared voids plus stairwells that are not already inside one. */
function slabHoles(
  ctx: BuildContext,
  structure: Structure,
  floor: FloorId,
): { voids: Polygon[]; stairwells: Connector[] } {
  const voids = structure.voids
    .filter((v) => v.floors.includes(floor))
    .map((v) => v.polygon as Polygon);
  const stairwells = ctx.map.connectors.filter((connector) => {
    if (connector.structure !== structure.id || connector.upper.floor !== floor) return false;
    const centre = polygonCentroid(connectorFootprint(connector));
    return !voids.some((hole) => pointInPolygon(centre, hole));
  });
  return { voids, stairwells };
}

function buildWalls(
  ctx: BuildContext,
  structure: Structure,
  shared: Map<string, number>,
  built: Set<string>,
): void {
  const solidStyle = structure.style === 'kiosk';
  const footprint = structure.footprint;

  for (const storey of storeysOf(ctx, structure)) {
    const { solid, glass } = ctx.level(storey.floor);
    const { y0, y1 } = storey;
    const header = Math.min(HEADER, (y1 - y0) / 4);

    for (let i = 0; i < footprint.length; i++) {
      const a = footprint[i] as ReadonlyVec2;
      const b = footprint[(i + 1) % footprint.length] as ReadonlyVec2;
      const key = `${edgeKey(a, b)}@${storey.floor}`;
      // A wall shared by two buildings is built once, as an interior partition.
      if (built.has(key)) continue;
      built.add(key);
      const interior = (shared.get(edgeKey(a, b)) ?? 0) > 1;
      const colour = solidStyle ? PALETTE.kiosk : interior ? PALETTE.interiorWall : PALETTE.wall;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);

      const doors = structure.openings
        .filter((opening) => opening.floor === storey.floor)
        .flatMap((opening) => {
          const hit = nearestEdge(opening.at, footprint);
          if (hit.edge !== i || hit.distance > 0.2) return [];
          const centre = hit.t * length;
          return [[centre - opening.width / 2, centre + opening.width / 2] as [number, number]];
        });
      const doorTop = y0 + Math.min(DOOR_HEIGHT, y1 - y0 - header - 0.2);

      for (const [from, to] of spansOutsideGaps(length, doors)) {
        const p = along(a, b, from);
        const q = along(a, b, to);
        ctx.collider.wall(p, q, WALL_THICKNESS, y0, y1, colour);
        if (solidStyle || interior) {
          solid.wall(p, q, WALL_THICKNESS, y0, y1 - header, colour);
        } else {
          solid.wall(p, q, WALL_THICKNESS, y0, y0 + SPANDREL, colour);
          glass.wall(p, q, GLASS_THICKNESS, y0 + SPANDREL, y1 - header, PALETTE.glass);
        }
      }
      solid.wall(a, b, WALL_THICKNESS, y1 - header, y1, colour);

      for (const [from, to] of doors) {
        const p = along(a, b, Math.max(0, from));
        const q = along(a, b, Math.min(length, to));
        ctx.collider.wall(p, q, WALL_THICKNESS, doorTop, y1, colour);
        solid.wall(p, q, WALL_THICKNESS + 0.1, doorTop, doorTop + LINTEL, PALETTE.wallAccent);
        if (interior) solid.wall(p, q, WALL_THICKNESS, doorTop + LINTEL, y1 - header, colour);
        else glass.wall(p, q, GLASS_THICKNESS, doorTop + LINTEL, y1 - header, PALETTE.glass);
        for (const post of [p, q]) {
          solid.box(
            [post[0], (y0 + doorTop) / 2, post[1]],
            [0.4, doorTop - y0, 0.4],
            PALETTE.wallAccent,
          );
        }
      }
    }
  }
}

function buildSlabs(ctx: BuildContext, structure: Structure): void {
  const storeys = storeysOf(ctx, structure);
  const ground = storeys[0] as Storey;

  // Interior finish of the ground floor; named rooms are tinted on top of it by buildRooms.
  const finish = structure.style === 'kiosk' ? PALETTE.kiosk : PALETTE.floor;
  if (ground.y0 === 0) ctx.flat('floor').polygon(structure.footprint, LAYER.floor, finish);
  else ctx.level(ground.floor).solid.polygon(structure.footprint, ground.y0 + 0.01, finish);

  for (const storey of storeys.slice(1)) {
    const { voids, stairwells } = slabHoles(ctx, structure, storey.floor);
    const holes = [...voids, ...stairwells.map((c) => connectorFootprint(c) as Polygon)];
    ctx
      .level(storey.floor)
      .solid.slab(
        structure.footprint,
        holes,
        storey.y0,
        SLAB_THICKNESS,
        PALETTE.floor,
        PALETTE.slabEdge,
        structure.style === 'office' ? PALETTE.ceiling : PALETTE.slabEdge,
      );
    ctx.collider.slab(structure.footprint, holes, storey.y0, SLAB_THICKNESS, PALETTE.slab);
  }

  // Roof, with skylights left open and glazed over.
  const top = storeys[storeys.length - 1] as Storey;
  const roofLevel: LevelId = storeys.length > 1 ? 'ROOF' : top.floor;
  const skylights = structure.voids
    .filter((v) => v.floors.includes('ROOF'))
    .map((v) => v.polygon as Polygon);
  const roofTop = top.y1 + SLAB_THICKNESS;
  ctx
    .level(roofLevel)
    .solid.slab(
      structure.footprint,
      skylights,
      roofTop,
      SLAB_THICKNESS,
      PALETTE.roof,
      PALETTE.slabEdge,
      structure.style === 'office' ? PALETTE.ceiling : PALETTE.slabEdge,
    );
  ctx.collider.slab(structure.footprint, skylights, roofTop, SLAB_THICKNESS, PALETTE.roof);
  for (const skylight of skylights) {
    ctx.level(roofLevel).glass.polygon(skylight, roofTop - 0.05, PALETTE.glass);
  }
}

/** Floor finish of a room, from its tags: what the photos show, else a tint by importance. */
function finishOf(tags: readonly string[]): string {
  if (tags.includes('timber')) return PALETTE.timberFloor;
  if (tags.includes('rubber')) return PALETTE.rubberFloor;
  return tags.includes('landmark') ? PALETTE.landmark : PALETTE.room;
}

function buildRooms(ctx: BuildContext): void {
  for (const area of ctx.map.areas) {
    if (area.kind !== 'indoor' || area.tags.includes('base')) continue;
    const colour = finishOf(area.tags);
    const y = ctx.floorY(area.floor);
    if (y === 0) ctx.flat('room').polygon(area.polygon, LAYER.room, colour);
    else ctx.level(area.floor).solid.polygon(area.polygon, y + 0.02, colour);
  }
}

function rail(
  ctx: BuildContext,
  level: LevelId,
  a: ReadonlyVec2,
  b: ReadonlyVec2,
  atA: number,
  atB: number,
): void {
  // Glass under a steel top rail, as around the atrium in the photos.
  const { solid, glass } = ctx.level(level);
  const top = RAIL_HEIGHT - TOP_RAIL;
  glass.slopedWall(a, b, GLASS_THICKNESS, [atA, atA + top], [atB, atB + top], PALETTE.glass);
  solid.slopedWall(
    a,
    b,
    RAIL_THICKNESS,
    [atA + top, atA + RAIL_HEIGHT],
    [atB + top, atB + RAIL_HEIGHT],
    PALETTE.handrail,
  );
  ctx.collider.slopedWall(
    a,
    b,
    RAIL_THICKNESS * 2,
    [atA, atA + RAIL_HEIGHT],
    [atB, atB + RAIL_HEIGHT],
    PALETTE.rail,
  );
}

/**
 * Bleachers: tiers people step up and sit on, with a lane of half steps down the middle. Unlike
 * stairs, what is drawn is what is walked on, so seats sit right on the tiers.
 */
function buildBleachers(ctx: BuildContext, connector: Connector): void {
  const level = connector.lower.floor;
  const { solid } = ctx.level(level);
  const y0 = ctx.floorY(connector.lower.floor);
  const y1 = ctx.floorY(connector.upper.floor);
  const { tiers, rise, depth, up, across } = bleacherLayout(connector, y0, y1);
  const foot = connector.lower.at;
  const yaw = Math.atan2(up[0], up[1]);
  const half = connector.width / 2;
  const lane = BLEACHER_LANE / 2;

  const block = (
    from: number,
    to: number,
    left: number,
    right: number,
    top: number,
    colour: string,
  ) => {
    const along = (from + to) / 2;
    const offset = (left + right) / 2;
    const centre = [
      foot[0] + up[0] * along + across[0] * offset,
      (y0 + top) / 2,
      foot[1] + up[1] * along + across[1] * offset,
    ] as const;
    const size = [right - left, top - y0, to - from] as const;
    solid.box(centre, size, colour, yaw);
    ctx.collider.box(centre, size, colour, yaw);
  };

  for (let i = 0; i < tiers; i++) {
    const top = y0 + (i + 1) * rise;
    block(i * depth, (i + 1) * depth, -half, -lane, top, PALETTE.timber);
    block(i * depth, (i + 1) * depth, lane, half, top, PALETTE.timber);
  }
  for (let i = 0; i < tiers * 2; i++) {
    block(
      (i * depth) / 2,
      ((i + 1) * depth) / 2,
      -lane,
      lane,
      y0 + ((i + 1) * rise) / 2,
      PALETTE.timberDark,
    );
  }

  // Glass balustrades down both sides; the top is open onto the gallery.
  const [sideA1, sideB1, sideB2, sideA2] = connectorFootprint(connector) as [
    Vec2,
    Vec2,
    Vec2,
    Vec2,
  ];
  rail(ctx, level, sideA1, sideB1, y0 + rise, y1);
  rail(ctx, level, sideA2, sideB2, y0 + rise, y1);
}

function buildStairs(ctx: BuildContext, connector: Connector): void {
  const level = connector.lower.floor;
  const { solid } = ctx.level(level);
  const a = connector.lower.at;
  const b = connector.upper.at;
  const yA = ctx.floorY(connector.lower.floor);
  const yB = ctx.floorY(connector.upper.floor);
  const run = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const rise = yB - yA;

  // Characters walk on a smooth ramp; the steps are only drawn (docs/04-client.md §6).
  ctx.collider.slopedWall(a, b, connector.width, [yA - 0.25, yA], [yB - 0.25, yB], PALETTE.stairs);
  solid.slopedWall(
    a,
    b,
    connector.width,
    [yA - 0.3, yA - 0.1],
    [yB - 0.3, yB - 0.1],
    PALETTE.slabEdge,
  );

  const steps = Math.max(2, Math.round(rise / STEP_RISE));
  const stepHeight = rise / steps;
  for (let i = 0; i < steps; i++) {
    const from = along(a, b, (run * i) / steps);
    const to = along(a, b, (run * (i + 1)) / steps);
    // Treads sit half a step low so the ramp passes through the middle of each one.
    const top = yA + (i + 0.5) * stepHeight;
    solid.wall(from, to, connector.width, top - stepHeight - 0.05, top, PALETTE.stairs);
  }

  const [sideA1, sideB1, sideB2, sideA2] = connectorFootprint(connector) as [
    Vec2,
    Vec2,
    Vec2,
    Vec2,
  ];
  rail(ctx, level, sideA1, sideB1, yA, yB);
  rail(ctx, level, sideA2, sideB2, yA, yB);
}

/** Guard rails around every hole in an upper floor, open where a flight of stairs lands. */
function buildRailings(ctx: BuildContext, structure: Structure): void {
  for (const floor of structure.floors.slice(1)) {
    const y = ctx.floorY(floor);
    const { voids, stairwells } = slabHoles(ctx, structure, floor);
    const rings = [...voids, ...stairwells.map((c) => connectorFootprint(c) as Polygon)];
    const landings = ctx.map.connectors.filter(
      (c) => c.structure === structure.id && c.upper.floor === floor,
    );

    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i] as ReadonlyVec2;
        const b = ring[(i + 1) % ring.length] as ReadonlyVec2;
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const gaps = landings.flatMap((connector) => {
          const hit = closestPointOnSegment(connector.upper.at, a, b);
          if (hit.distance > 0.3) return [];
          const centre = hit.t * length;
          return [[centre - connector.width / 2, centre + connector.width / 2] as [number, number]];
        });
        for (const [from, to] of spansOutsideGaps(length, gaps)) {
          rail(ctx, floor, along(a, b, from), along(a, b, to), y, y);
        }
      }
    }
  }
}

export function buildStructures(ctx: BuildContext): void {
  const shared = new Map<string, number>();
  for (const structure of ctx.map.structures) {
    const { footprint } = structure;
    for (let i = 0; i < footprint.length; i++) {
      const key = edgeKey(
        footprint[i] as ReadonlyVec2,
        footprint[(i + 1) % footprint.length] as ReadonlyVec2,
      );
      shared.set(key, (shared.get(key) ?? 0) + 1);
    }
  }

  const built = new Set<string>();
  for (const structure of ctx.map.structures) {
    buildWalls(ctx, structure, shared, built);
    buildSlabs(ctx, structure);
    buildRailings(ctx, structure);
  }
  buildRooms(ctx);
  for (const connector of ctx.map.connectors) {
    if (connector.kind === 'bleachers') buildBleachers(ctx, connector);
    else buildStairs(ctx, connector);
  }
}
