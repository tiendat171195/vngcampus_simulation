import type { Poi } from '@campus/map-data';
import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  type Material,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import type { BuildContext, LevelId } from './context';
import { MeshBatch, type Vec3 } from './MeshBatch';
import { CAR_COLOURS, PALETTE } from './palette';

interface PropModel {
  /** Builds the model around its own origin: standing on y = 0 and facing +Z. */
  build(batch: MeshBatch): void;
  /** Size of the box characters collide with, if the prop is solid. */
  collider?: Vec3;
  /** Per-instance tints, cycled deterministically. */
  tints?: readonly string[];
}

const at = (x: number, y: number, z: number, scale: Vec3 = [1, 1, 1]) =>
  new Matrix4().compose(new Vector3(x, y, z), new Quaternion(), new Vector3(...scale));
/** A beam from one point to another (a strut, a slanted column). */
const beam = (batch: MeshBatch, from: Vec3, to: Vec3, thickness: number, colour: string) => {
  const a = new Vector3(...from);
  const b = new Vector3(...to);
  const length = a.distanceTo(b);
  const rotation = new Quaternion().setFromUnitVectors(
    new Vector3(0, 1, 0),
    b.clone().sub(a).normalize(),
  );
  const matrix = new Matrix4().compose(
    a.add(b).multiplyScalar(0.5),
    rotation,
    new Vector3(1, 1, 1),
  );
  batch.merge(new BoxGeometry(thickness, length, thickness), matrix, colour);
};
const blob = (radius: number) => new IcosahedronGeometry(radius, 0);
const pole = (top: number, bottom: number, height: number, sides = 6) =>
  new CylinderGeometry(top, bottom, height, sides);

const seatWithBack = (
  batch: MeshBatch,
  width: number,
  depth: number,
  seatHeight: number,
  colour: string,
) => {
  batch.box([0, seatHeight - 0.04, 0], [width, 0.08, depth], colour);
  batch.box([0, seatHeight + 0.28, -depth / 2 + 0.03], [width, 0.5, 0.06], colour);
};

const MODELS: Record<string, PropModel> = {
  tree_a: {
    collider: [0.6, 3, 0.6],
    build(batch) {
      batch.merge(pole(0.18, 0.26, 2.4), at(0, 1.2, 0), PALETTE.trunk);
      batch.merge(blob(2), at(0, 3.9, 0, [1, 0.85, 1]), PALETTE.leafA);
      batch.merge(blob(1.25), at(0.5, 5.1, 0.2), PALETTE.leafB);
    },
  },
  tree_b: {
    collider: [0.5, 3, 0.5],
    build(batch) {
      batch.merge(pole(0.14, 0.2, 3), at(0, 1.5, 0), PALETTE.trunk);
      batch.merge(blob(1.7), at(0, 4.1, 0), PALETTE.leafB);
      batch.merge(blob(1.15), at(-0.8, 3.4, 0.4), PALETTE.leafA);
    },
  },
  lamp: {
    build(batch) {
      batch.merge(pole(0.06, 0.09, 4.4, 5), at(0, 2.2, 0), PALETTE.lamp);
      batch.box([0, 4.4, 0.25], [0.3, 0.12, 0.7], PALETTE.lampHead);
    },
  },
  car: {
    collider: [1.9, 1.5, 4.3],
    tints: CAR_COLOURS,
    build(batch) {
      batch.box([0, 0.65, 0], [1.8, 0.7, 4.2], PALETTE.carBody);
      batch.box([0, 1.28, -0.2], [1.6, 0.56, 2.2], PALETTE.carGlass);
      for (const x of [-0.85, 0.85]) {
        for (const z of [-1.3, 1.3]) batch.box([x, 0.32, z], [0.25, 0.64, 0.64], PALETTE.carTyre);
      }
    },
  },
  planter: {
    collider: [1.4, 1, 1.4],
    build(batch) {
      batch.box([0, 0.3, 0], [1.4, 0.6, 1.4], PALETTE.planter);
      batch.merge(blob(0.85), at(0, 1.15, 0), PALETTE.leafA);
    },
  },
  desk_cluster: {
    collider: [3.4, 0.9, 1.7],
    build(batch) {
      batch.box([0, 0.72, 0], [3.4, 0.06, 1.7], PALETTE.desk);
      for (const x of [-0.85, 0.85]) {
        for (const side of [-1, 1]) {
          batch.box([x, 1, side * 0.18], [0.56, 0.36, 0.04], PALETTE.monitor);
          batch.box([x, 0.46, side * 1.15], [0.5, 0.08, 0.5], PALETTE.chair);
          batch.box([x, 0.76, side * 1.38], [0.5, 0.52, 0.06], PALETTE.chair);
        }
      }
    },
  },
  /**
   * The canopy over the main entrance: a light roof on orange V-shaped columns, open at the
   * sides (VNG's photos). Faces +Z, away from the doors; overhead only, so nothing collides.
   */
  canopy_v: {
    build(batch) {
      batch.box([0, 4.6, 0], [14, 0.35, 7], PALETTE.canopy);
      batch.box([0, 4.35, 3.4], [14, 0.25, 0.3], PALETTE.brandOrange);
      // A V at each end, out of the way of people walking to the doors.
      for (const x of [-6.2, 6.2]) {
        beam(batch, [x, 0, 2.6], [x - 1.2, 4.4, 2.6], 0.3, PALETTE.brandOrange);
        beam(batch, [x, 0, 2.6], [x + 1.2, 4.4, 2.6], 0.3, PALETTE.brandOrange);
      }
    },
  },
  /** The round planter in the garden between the blocks. */
  planter_round: {
    collider: [6.4, 0.8, 6.4],
    build(batch) {
      batch.merge(pole(4.2, 4.3, 0.6, 20), at(0, 0.3, 0), PALETTE.planter);
      batch.merge(pole(3.9, 3.9, 0.1, 20), at(0, 0.62, 0), PALETTE.park);
      for (const [x, z, r] of [
        [0, 0, 1.6],
        [-2, 1.4, 1],
        [2.1, -1, 1.1],
        [1.2, 2.2, 0.8],
      ] as const) {
        batch.merge(blob(r), at(x, 0.6 + r * 0.7, z), r > 1.2 ? PALETTE.leafA : PALETTE.leafB);
      }
    },
  },
  plant_shelf: {
    collider: [2.4, 1.4, 0.45],
    build(batch) {
      batch.box([0, 0.65, 0], [2.4, 1.3, 0.4], PALETTE.shelf);
      for (const [i, x] of [-0.8, 0, 0.8].entries()) {
        batch.merge(blob(0.32), at(x, 1.5, 0), i % 2 === 0 ? PALETTE.leafA : PALETTE.leafB);
      }
    },
  },
};

/** Props drawn elsewhere because they need a texture rather than vertex colours. */
export const TEXTURED = new Set(['logo_sign']);

/** Furniture drawn for seat POIs, keyed by their `meta.furniture`. */
const FURNITURE: Record<string, PropModel> = {
  bench: {
    build(batch) {
      seatWithBack(batch, 1.6, 0.5, 0.48, PALETTE.bench);
      for (const x of [-0.65, 0.65]) batch.box([x, 0.22, 0], [0.08, 0.44, 0.44], PALETTE.lamp);
    },
  },
  chair: {
    build(batch) {
      seatWithBack(batch, 0.46, 0.46, 0.48, PALETTE.chair);
    },
  },
  stool: {
    build(batch) {
      batch.merge(pole(0.2, 0.16, 0.7, 8), at(0, 0.35, 0), PALETTE.bench);
    },
  },
  lounger: {
    build(batch) {
      batch.box([0, 0.2, 0.1], [0.7, 0.16, 1.7], PALETTE.lounger);
      batch.box([0, 0.42, -0.72], [0.7, 0.5, 0.12], PALETTE.lounger);
    },
  },
  sofa: {
    build(batch) {
      batch.box([0, 0.24, 0], [0.9, 0.44, 0.9], PALETTE.sofa);
      batch.box([0, 0.62, -0.38], [0.9, 0.5, 0.16], PALETTE.sofa);
    },
  },
  step: {
    build(batch) {
      batch.box([0, 0.22, 0], [0.9, 0.44, 0.7], PALETTE.stairs);
    },
  },
};

interface Placement {
  x: number;
  y: number;
  z: number;
  yawDeg: number;
  scale: number;
}

const DEG = Math.PI / 180;

function instanced(
  model: PropModel,
  material: Material,
  placements: readonly Placement[],
  cache: Map<PropModel, BufferGeometry>,
): InstancedMesh {
  let geometry = cache.get(model);
  if (!geometry) {
    const batch = new MeshBatch();
    model.build(batch);
    geometry = batch.toGeometry();
    cache.set(model, geometry);
  }
  const mesh = new InstancedMesh(geometry, material, placements.length);
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const tint = new Color();
  placements.forEach((p, i) => {
    rotation.setFromAxisAngle(up, p.yawDeg * DEG);
    matrix.compose(new Vector3(p.x, p.y, p.z), rotation, new Vector3(p.scale, p.scale, p.scale));
    mesh.setMatrixAt(i, matrix);
    if (model.tints) mesh.setColorAt(i, tint.set(model.tints[i % model.tints.length] as string));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

export interface BuiltProps {
  level: LevelId;
  mesh: InstancedMesh;
}

/** Instanced props and seat furniture, one mesh per model per level. Adds their colliders. */
export function buildProps(ctx: BuildContext, material: Material): BuiltProps[] {
  const geometries = new Map<PropModel, BufferGeometry>();
  const result: BuiltProps[] = [];

  const emit = (name: string, model: PropModel | undefined, byLevel: Map<LevelId, Placement[]>) => {
    if (!model) {
      console.warn(`No prop model for "${name}"`);
      return;
    }
    for (const [level, placements] of byLevel) {
      const mesh = instanced(model, material, placements, geometries);
      mesh.name = `${name}@${level}`;
      result.push({ level, mesh });
      if (!model.collider) continue;
      const [sx, sy, sz] = model.collider;
      for (const p of placements) {
        ctx.collider.box(
          [p.x, p.y + (sy * p.scale) / 2, p.z],
          [sx * p.scale, sy * p.scale, sz * p.scale],
          PALETTE.planter,
          p.yawDeg * DEG,
        );
      }
    }
  };

  const group = <T>(items: readonly T[], place: (item: T) => [LevelId, Placement]) => {
    const byLevel = new Map<LevelId, Placement[]>();
    for (const item of items) {
      const [level, placement] = place(item);
      const list = byLevel.get(level) ?? [];
      list.push(placement);
      byLevel.set(level, list);
    }
    return byLevel;
  };

  for (const props of ctx.map.props) {
    // Signs carry the official artwork as a texture; LogoSigns draws them.
    if (TEXTURED.has(props.model)) continue;
    emit(
      props.model,
      MODELS[props.model],
      group(props.instances, (instance) => [
        instance.floor,
        {
          x: instance.p[0],
          y: ctx.floorY(instance.floor),
          z: instance.p[1],
          yawDeg: instance.yawDeg ?? 0,
          scale: instance.s ?? 1,
        },
      ]),
    );
  }

  const seats = new Map<string, Poi[]>();
  for (const poi of ctx.map.pois) {
    if (poi.kind !== 'seat') continue;
    const furniture = typeof poi.meta?.furniture === 'string' ? poi.meta.furniture : 'chair';
    const list = seats.get(furniture) ?? [];
    list.push(poi);
    seats.set(furniture, list);
  }
  for (const [furniture, pois] of seats) {
    emit(
      `seat:${furniture}`,
      FURNITURE[furniture],
      group(pois, (poi) => [
        poi.floor,
        {
          x: poi.position[0],
          y: poi.y ?? ctx.floorY(poi.floor),
          z: poi.position[1],
          yawDeg: poi.yawDeg ?? 0,
          scale: 1,
        },
      ]),
    );
  }

  return result;
}
