import type { Poi } from '@campus/map-data';
import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  InstancedMesh,
  type Material,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import type { BuildContext, LevelId } from './context';
import { MeshBatch, type Vec3 } from './MeshBatch';
import { BEANBAG_COLOURS, BOOTH_COLOURS, CAR_COLOURS, MAT_COLOURS, PALETTE } from './palette';

/** A box characters collide with, in the model's own frame. */
interface ColliderBox {
  at: Vec3;
  size: Vec3;
}

interface PropModel {
  /**
   * Builds the model around its own origin: standing on y = 0 and facing +Z. `variant` counts
   * the instances of a baked model, so each one can differ (a colour, say).
   */
  build(batch: MeshBatch, variant: number): void;
  /** Glass parts, drawn with the storey's window glass. Baked models only. */
  glass?(batch: MeshBatch): void;
  /** Size of the box characters collide with, centred on the model, if the prop is solid. */
  collider?: Vec3;
  /** Several boxes instead, for props people can step into (booths, meeting rooms). */
  colliders?: readonly ColliderBox[];
  /** Per-instance tints, cycled deterministically. Instanced models only. */
  tints?: readonly string[];
  /**
   * Merged into the storey's own mesh instead of drawn with instancing: fixed furniture that
   * comes in ones and twos would otherwise cost a draw call per model per storey.
   */
  bake?: boolean;
}

const at = (x: number, y: number, z: number, scale: Vec3 = [1, 1, 1]) =>
  new Matrix4().compose(new Vector3(x, y, z), new Quaternion(), new Vector3(...scale));
const turned = (x: number, y: number, z: number, rx: number, ry: number, rz: number) =>
  new Matrix4().compose(
    new Vector3(x, y, z),
    new Quaternion().setFromEuler(new Euler(rx, ry, rz)),
    new Vector3(1, 1, 1),
  );
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

/** A chair at (x, z) whose sitter faces `facing` (+1: towards +Z, -1: towards -Z). */
const chairAt = (batch: MeshBatch, x: number, z: number, facing: 1 | -1, colour: string) => {
  batch.box([x, 0.44, z], [0.44, 0.06, 0.44], colour);
  batch.box([x, 0.7, z - facing * 0.2], [0.44, 0.46, 0.05], colour);
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
  /** Four white desks in a block, black mesh chairs, monitors along the middle (photos). */
  desk_cluster: {
    collider: [3.4, 0.9, 1.7],
    build(batch) {
      batch.box([0, 0.72, 0], [3.4, 0.06, 1.7], PALETTE.desk);
      batch.box([0, 0.86, 0], [3.4, 0.22, 0.04], PALETTE.shelf);
      for (const x of [-0.85, 0.85]) {
        for (const side of [-1, 1]) {
          batch.box([x, 1, side * 0.18], [0.56, 0.36, 0.04], PALETTE.monitor);
          batch.box([x, 0.46, side * 1.15], [0.5, 0.08, 0.5], PALETTE.chair);
          batch.box([x, 0.76, side * 1.38], [0.5, 0.52, 0.06], PALETTE.chair);
        }
      }
    },
  },
  /** The wooden planter box at the end of each row of desks (photos). */
  planter_box: {
    collider: [0.5, 0.75, 1.6],
    build(batch) {
      batch.box([0, 0.38, 0], [0.5, 0.75, 1.6], PALETTE.shelf);
      batch.merge(blob(0.36), at(0, 0.95, -0.4), PALETTE.leafA);
      batch.merge(blob(0.4), at(0, 1, 0.35), PALETTE.leafB);
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

  // --- Atrium and lobby ------------------------------------------------------------------------

  /**
   * The big screen facing the bleachers, set in a block clad in herringbone timber (photos of
   * the atrium). The picture on it is a generic slide, not any real content.
   */
  led_wall: {
    bake: true,
    collider: [12, 6.5, 0.8],
    build(batch) {
      batch.box([0, 3.25, 0], [12, 6.5, 0.8], PALETTE.herringbone);
      batch.box([0, 3.6, 0.42], [9, 3.2, 0.06], PALETTE.screen);
      batch.box([-2.2, 3.9, 0.46], [3.4, 1.7, 0.03], PALETTE.screenLight);
      batch.box([2.2, 3.9, 0.46], [3, 1.7, 0.03], PALETTE.brandOrange);
      batch.box([0, 2.45, 0.46], [7.6, 0.3, 0.03], PALETTE.screenLight);
    },
  },
  /** One cabinet of the speed gates between the lobby and the atrium (photos). */
  speed_gate: {
    bake: true,
    collider: [0.22, 1, 1.5],
    build(batch) {
      batch.box([0, 0.5, 0], [0.22, 1, 1.5], PALETTE.gate);
      batch.box([0, 1.01, 0], [0.18, 0.03, 1.3], PALETTE.darkSteel);
      batch.box([0, 0.95, 0.6], [0.23, 0.06, 0.12], PALETTE.gateLight);
    },
    glass(batch) {
      // The flaps, folded back into the cabinet's sides.
      for (const x of [-0.14, 0.14]) batch.box([x, 0.85, 0], [0.02, 0.45, 0.7], PALETTE.glass);
    },
  },
  reception_desk: {
    bake: true,
    collider: [5, 1.1, 0.9],
    build(batch) {
      batch.box([0, 0.55, 0.3], [5, 1.1, 0.3], PALETTE.white);
      batch.box([0, 0.3, 0.46], [5, 0.12, 0.02], PALETTE.brandOrange);
      batch.box([0, 1.12, 0.1], [5.1, 0.05, 0.9], PALETTE.timber);
      batch.box([0, 0.74, -0.2], [4.8, 0.05, 0.5], PALETTE.counterTop);
      for (const x of [-1.2, 1.2]) batch.box([x, 0.95, -0.2], [0.5, 0.35, 0.04], PALETTE.monitor);
    },
  },

  // --- Food and drink --------------------------------------------------------------------------

  /** The coffee bar: herringbone front, a stone top, the espresso machine and a cake case. */
  coffee_bar: {
    bake: true,
    collider: [4.5, 1.05, 0.8],
    build(batch) {
      batch.box([0, 0.5, 0.05], [4.5, 1, 0.7], PALETTE.herringbone);
      batch.box([0, 1.03, 0], [4.6, 0.06, 0.85], PALETTE.counterTop);
      batch.box([-1.2, 1.29, -0.1], [0.7, 0.45, 0.5], PALETTE.steel);
    },
    glass(batch) {
      batch.box([1, 1.2, 0.1], [1.2, 0.28, 0.4], PALETTE.glass);
    },
  },
  /** Shelves of cups and bottles behind the coffee bar, under a menu board. */
  back_bar: {
    bake: true,
    collider: [4.5, 2.2, 0.4],
    build(batch) {
      batch.box([0, 1.1, 0], [4.5, 2.2, 0.4], PALETTE.timberDark);
      for (const y of [1.2, 1.65]) {
        for (let x = -1.9; x <= 1.9; x += 0.32)
          batch.box([x, y, 0.24], [0.1, 0.28, 0.1], PALETTE.white);
      }
      batch.box([0, 2.65, 0.22], [3, 0.8, 0.05], PALETTE.menuBoard);
    },
  },
  /**
   * A serving counter of the canteen: herringbone front, steel top under a sneeze guard, a dark
   * back wall with menu screens above (photos of the canteen).
   */
  food_counter: {
    bake: true,
    colliders: [
      { at: [0, 0.55, 0], size: [6, 1.1, 1] },
      { at: [0, 1.5, -1.3], size: [6, 3, 0.15] },
    ],
    build(batch) {
      batch.box([0, 0.5, 0.05], [6, 1, 0.9], PALETTE.herringbone);
      batch.box([0, 1.02, 0], [6.1, 0.05, 1], PALETTE.steel);
      for (let x = -2.4; x <= 2.4; x += 1.2)
        batch.box([x, 1.1, -0.1], [0.9, 0.12, 0.5], PALETTE.counterTop);
      batch.box([0, 1.5, -1.3], [6, 3, 0.15], PALETTE.menuBoard);
      for (const x of [-1.6, 1.6])
        batch.box([x, 2.55, -1.2], [1.6, 0.9, 0.05], PALETTE.screenLight);
    },
    glass(batch) {
      batch.box([0, 1.4, 0.32], [6, 0.5, 0.02], PALETTE.glass);
    },
  },
  /** A long canteen table with four teal chairs a side (photos). The chairs are seats. */
  canteen_table: {
    bake: true,
    collider: [4.8, 0.78, 0.9],
    build(batch) {
      batch.box([0, 0.75, 0], [4.8, 0.05, 0.9], PALETTE.canteenTable);
      for (const x of [-2.1, 2.1]) batch.box([x, 0.37, 0], [0.06, 0.72, 0.8], PALETTE.darkSteel);
      for (const x of [-1.8, -0.6, 0.6, 1.8]) {
        chairAt(batch, x, -0.75, 1, PALETTE.canteenChair);
        chairAt(batch, x, 0.75, -1, PALETTE.canteenChair);
      }
    },
  },
  /** A frame of wooden slats hung under the ceiling, with bare bulbs (photos). Overhead only. */
  slat_ceiling: {
    bake: true,
    build(batch) {
      for (let z = -1.2; z <= 1.21; z += 0.4)
        batch.box([0, 3.8, z], [5.2, 0.12, 0.08], PALETTE.slats);
      for (const x of [-2.4, 2.4]) batch.box([x, 3.72, 0], [0.08, 0.06, 2.6], PALETTE.slats);
      for (const x of [-1.8, -0.6, 0.6, 1.8]) {
        batch.box([x, 3.5, 0], [0.015, 0.5, 0.015], PALETTE.darkSteel);
        batch.box([x, 3.2, 0], [0.14, 0.16, 0.14], PALETTE.bulb);
      }
    },
  },
  /** The pantry on each office floor: brick wall, counter, coffee machine, fridge (photos). */
  pantry_counter: {
    bake: true,
    colliders: [
      { at: [0, 0.48, 0], size: [5, 0.95, 0.65] },
      { at: [2.95, 0.95, 0], size: [0.8, 1.9, 0.7] },
      { at: [0.3, 1.3, -0.4], size: [5.6, 2.6, 0.1] },
    ],
    build(batch) {
      batch.box([0.3, 1.3, -0.4], [5.6, 2.6, 0.1], PALETTE.brick);
      batch.box([0, 0.45, 0], [5, 0.9, 0.65], PALETTE.white);
      batch.box([0, 0.92, 0], [5.05, 0.05, 0.7], PALETTE.timber);
      batch.box([-1.6, 1.15, -0.1], [0.45, 0.42, 0.4], PALETTE.darkSteel);
      batch.box([2.95, 0.95, 0], [0.8, 1.9, 0.7], PALETTE.steel);
      batch.box([0, 1.95, -0.2], [5, 0.6, 0.35], PALETTE.white);
    },
  },
  high_table: {
    bake: true,
    collider: [2.4, 1.08, 0.8],
    build(batch) {
      batch.box([0, 1.05, 0], [2.4, 0.05, 0.8], PALETTE.white);
      for (const x of [-1, 1]) batch.box([x, 0.52, 0], [0.06, 1.02, 0.6], PALETTE.darkSteel);
    },
  },

  // --- Gym -------------------------------------------------------------------------------------

  /** A power rack with a loaded bar and a bench inside (photos of the gym). */
  gym_rack: {
    bake: true,
    collider: [2.1, 2.3, 1.3],
    build(batch) {
      for (const x of [-0.95, 0.95]) {
        for (const z of [-0.55, 0.55])
          batch.box([x, 1.15, z], [0.08, 2.3, 0.08], PALETTE.darkSteel);
        batch.box([x, 2.27, 0], [0.08, 0.06, 1.18], PALETTE.darkSteel);
      }
      for (const z of [-0.55, 0.55]) batch.box([0, 2.27, z], [1.98, 0.06, 0.08], PALETTE.darkSteel);
      batch.box([0, 1.35, 0.35], [2.4, 0.04, 0.04], PALETTE.steel);
      for (const x of [-1.12, -1.05, 1.05, 1.12]) {
        batch.merge(
          pole(0.22, 0.22, 0.05, 10),
          turned(x, 1.35, 0.35, 0, 0, Math.PI / 2),
          PALETTE.darkSteel,
        );
      }
      batch.box([0, 0.42, 0], [0.32, 0.1, 1.15], PALETTE.darkSteel);
      batch.box([0, 0.2, 0], [0.1, 0.38, 0.9], PALETTE.steel);
    },
  },
  treadmill: {
    bake: true,
    collider: [0.85, 1.4, 1.9],
    build(batch) {
      batch.box([0, 0.12, 0], [0.8, 0.24, 1.9], PALETTE.darkSteel);
      batch.box([0, 0.25, -0.1], [0.55, 0.03, 1.5], PALETTE.rubberFloor);
      for (const x of [-0.36, 0.36])
        beam(batch, [x, 0.2, 0.75], [x, 1.25, 0.85], 0.06, PALETTE.darkSteel);
      batch.box([0, 1.3, 0.85], [0.75, 0.25, 0.2], PALETTE.monitor);
      batch.box([0, 1.32, 0.74], [0.4, 0.18, 0.02], PALETTE.brandOrange);
    },
  },
  rower: {
    bake: true,
    collider: [0.55, 0.9, 2.3],
    build(batch) {
      batch.box([0, 0.2, 0], [0.16, 0.12, 2.3], PALETTE.darkSteel);
      batch.merge(
        pole(0.3, 0.3, 0.22, 12),
        turned(0, 0.45, 0.9, 0, 0, Math.PI / 2),
        PALETTE.darkSteel,
      );
      batch.box([0, 0.36, -0.3], [0.34, 0.08, 0.36], PALETTE.brandOrange);
      for (const z of [-1.1, 1.05]) batch.box([0, 0.08, z], [0.5, 0.16, 0.12], PALETTE.darkSteel);
    },
  },
  dumbbell_rack: {
    bake: true,
    collider: [2.4, 0.9, 0.6],
    build(batch) {
      for (const x of [-1.15, 1.15]) batch.box([x, 0.45, 0], [0.08, 0.9, 0.55], PALETTE.darkSteel);
      for (const [y, z] of [
        [0.45, 0.12],
        [0.8, -0.12],
      ] as const) {
        batch.box([0, y - 0.06, z], [2.3, 0.04, 0.24], PALETTE.darkSteel);
        for (let x = -1; x <= 1.01; x += 0.25)
          batch.box([x, y, z], [0.12, 0.1, 0.2], PALETTE.monitor);
      }
    },
  },
  /** A mirrored partition on a timber skirting, the length of the free-weights area. */
  mirror_wall: {
    bake: true,
    collider: [10, 2.7, 0.12],
    build(batch) {
      batch.box([0, 0.15, 0], [10, 0.3, 0.14], PALETTE.timber);
      batch.box([0, 1.5, 0], [10, 2.4, 0.06], PALETTE.mirror);
      for (const x of [-5, -2.5, 0, 2.5, 5])
        batch.box([x, 1.5, 0], [0.05, 2.4, 0.1], PALETTE.darkSteel);
    },
  },
  yoga_mat: {
    bake: true,
    build(batch, variant) {
      batch.box(
        [0, 0.035, 0],
        [0.65, 0.02, 1.8],
        MAT_COLOURS[variant % MAT_COLOURS.length] as string,
      );
    },
  },

  // --- Office floors ---------------------------------------------------------------------------

  /**
   * A booth with a gabled roof, two sofas facing each other across a table, open towards +Z
   * (photos of the booths along the atrium galleries). The sofas are seats.
   */
  booth_house: {
    bake: true,
    colliders: [
      { at: [-1.2, 1.1, 0], size: [0.12, 2.2, 2.4] },
      { at: [1.2, 1.1, 0], size: [0.12, 2.2, 2.4] },
      { at: [0, 1.1, -1.15], size: [2.4, 2.2, 0.1] },
      { at: [0, 0.39, -0.1], size: [0.8, 0.78, 1.5] },
    ],
    build(batch, variant) {
      const shell = BOOTH_COLOURS[variant % BOOTH_COLOURS.length] as string;
      for (const x of [-1.2, 1.2]) batch.box([x, 1.1, 0], [0.1, 2.2, 2.4], shell);
      batch.box([0, 1.1, -1.15], [2.4, 2.2, 0.1], shell);
      // Two roof planes meeting at a ridge along the booth.
      const pitch = Math.atan2(0.9, 1.25);
      const plane = Math.hypot(0.9, 1.25) + 0.05;
      for (const side of [-1, 1]) {
        batch.merge(
          new BoxGeometry(plane, 0.08, 2.4),
          turned(side * 0.62, 2.65, 0, 0, 0, -side * pitch),
          shell,
        );
      }
      // The gable closing the back.
      batch.slopedWall([-1.25, -1.15], [0, -1.15], 0.1, [2.2, 2.2], [2.2, 3.1], shell);
      batch.slopedWall([0, -1.15], [1.25, -1.15], 0.1, [2.2, 3.1], [2.2, 2.2], shell);
      for (const side of [-1, 1]) {
        batch.box([side * 0.8, 0.24, -0.1], [0.62, 0.45, 2.0], PALETTE.booth);
        batch.box([side * 1.08, 0.75, -0.1], [0.12, 0.65, 2.0], PALETTE.booth);
      }
      batch.box([0, 0.75, -0.1], [0.8, 0.05, 1.5], PALETTE.white);
      batch.box([0, 0.37, -0.1], [0.1, 0.72, 0.1], PALETTE.steel);
    },
  },
  /**
   * A glass meeting room, 6 × 4.5 m: herringbone floor, a table for six, a screen on the solid
   * back wall, the door at the front right (photos). The chairs are seats.
   */
  meeting_room: {
    bake: true,
    colliders: [
      { at: [0, 1.5, -2.25], size: [6, 3, 0.12] },
      { at: [-3, 1.5, 0], size: [0.1, 3, 4.5] },
      { at: [3, 1.5, 0], size: [0.1, 3, 4.5] },
      { at: [-0.8, 1.5, 2.25], size: [4.4, 3, 0.1] },
      { at: [2.8, 1.5, 2.25], size: [0.4, 3, 0.1] },
      { at: [0, 0.39, -0.3], size: [3.2, 0.78, 1.2] },
    ],
    build(batch) {
      batch.box([0, 0.035, 0], [5.9, 0.02, 4.4], PALETTE.timberFloor);
      batch.box([0, 1.5, -2.25], [6, 3, 0.12], PALETTE.white);
      batch.box([0, 1.55, -2.17], [1.8, 1, 0.05], PALETTE.monitor);
      for (const [x, z] of [
        [-3, 2.25],
        [3, 2.25],
        [-3, -2.25],
        [3, -2.25],
        [1.4, 2.25],
        [2.6, 2.25],
      ] as const) {
        batch.box([x, 1.5, z], [0.08, 3, 0.08], PALETTE.darkSteel);
      }
      for (const [x, z, w, d] of [
        [0, 2.25, 6, 0.08],
        [-3, 0, 0.08, 4.5],
        [3, 0, 0.08, 4.5],
      ] as const) {
        batch.box([x, 3, z], [w, 0.08, d], PALETTE.darkSteel);
      }
      batch.box([0, 0.75, -0.3], [3.2, 0.05, 1.2], PALETTE.white);
      for (const x of [-1, 1]) batch.box([x, 0.37, -0.3], [0.08, 0.72, 0.9], PALETTE.steel);
      for (const x of [-1.1, 0, 1.1]) {
        chairAt(batch, x, -1.2, 1, PALETTE.rail);
        chairAt(batch, x, 0.6, -1, PALETTE.rail);
      }
    },
    glass(batch) {
      batch.box([-0.8, 1.5, 2.25], [4.4, 3, 0.04], PALETTE.glass);
      batch.box([2.8, 1.5, 2.25], [0.4, 3, 0.04], PALETTE.glass);
      for (const x of [-3, 3]) batch.box([x, 1.5, 0], [0.04, 3, 4.5], PALETTE.glass);
    },
  },
};

/** Props drawn elsewhere because they need a texture rather than vertex colours. */
export const TEXTURED = new Set(['logo_sign']);

/** Furniture that is part of another prop (canteen tables, booths, meeting rooms). */
const BUILT_IN = 'built_in';

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
  /** Bean bags lying about on the bleachers (photos). */
  beanbag: {
    tints: BEANBAG_COLOURS,
    build(batch) {
      batch.merge(blob(0.45), at(0, 0.2, 0.05, [1.15, 0.5, 1.1]), PALETTE.white);
      batch.merge(blob(0.32), at(0, 0.42, -0.3, [1.2, 0.8, 0.6]), PALETTE.white);
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
const UP = new Vector3(0, 1, 0);

const placementMatrix = (p: Placement, matrix = new Matrix4(), rotation = new Quaternion()) => {
  rotation.setFromAxisAngle(UP, p.yawDeg * DEG);
  return matrix.compose(
    new Vector3(p.x, p.y, p.z),
    rotation,
    new Vector3(p.scale, p.scale, p.scale),
  );
};

function instanced(
  model: PropModel,
  material: Material,
  placements: readonly Placement[],
  cache: Map<PropModel, BufferGeometry>,
): InstancedMesh {
  let geometry = cache.get(model);
  if (!geometry) {
    const batch = new MeshBatch();
    model.build(batch, 0);
    geometry = batch.toGeometry();
    cache.set(model, geometry);
  }
  const mesh = new InstancedMesh(geometry, material, placements.length);
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const tint = new Color();
  placements.forEach((p, i) => {
    mesh.setMatrixAt(i, placementMatrix(p, matrix, rotation));
    if (model.tints) mesh.setColorAt(i, tint.set(model.tints[i % model.tints.length] as string));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Copies each placement of a baked model into its storey's own meshes. */
function bake(
  ctx: BuildContext,
  model: PropModel,
  level: LevelId,
  placements: readonly Placement[],
) {
  const { solid, glass } = ctx.level(level);
  let glassParts: MeshBatch | undefined;
  if (model.glass) {
    glassParts = new MeshBatch();
    model.glass(glassParts);
  }
  placements.forEach((p, variant) => {
    const parts = new MeshBatch();
    model.build(parts, variant);
    const matrix = placementMatrix(p);
    solid.append(parts, matrix);
    if (glassParts) glass.append(glassParts, matrix);
  });
}

function addColliders(ctx: BuildContext, model: PropModel, placements: readonly Placement[]) {
  const boxes: ColliderBox[] = model.colliders
    ? [...model.colliders]
    : model.collider
      ? [{ at: [0, model.collider[1] / 2, 0], size: model.collider }]
      : [];
  for (const p of placements) {
    const yaw = p.yawDeg * DEG;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    for (const box of boxes) {
      const [x, y, z] = box.at;
      const [sx, sy, sz] = box.size;
      ctx.collider.box(
        [
          p.x + (x * cos + z * sin) * p.scale,
          p.y + y * p.scale,
          p.z + (-x * sin + z * cos) * p.scale,
        ],
        [sx * p.scale, sy * p.scale, sz * p.scale],
        PALETTE.planter,
        yaw,
      );
    }
  }
}

export interface BuiltProps {
  level: LevelId;
  mesh: InstancedMesh;
}

/**
 * Instanced props and seat furniture, one mesh per model per level; baked props go into the
 * storeys' own meshes. Adds their colliders.
 */
export function buildProps(ctx: BuildContext, material: Material): BuiltProps[] {
  const geometries = new Map<PropModel, BufferGeometry>();
  const result: BuiltProps[] = [];

  const emit = (name: string, model: PropModel | undefined, byLevel: Map<LevelId, Placement[]>) => {
    if (!model) {
      console.warn(`No prop model for "${name}"`);
      return;
    }
    for (const [level, placements] of byLevel) {
      if (model.bake) bake(ctx, model, level, placements);
      else {
        const mesh = instanced(model, material, placements, geometries);
        mesh.name = `${name}@${level}`;
        result.push({ level, mesh });
      }
      addColliders(ctx, model, placements);
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
    if (furniture === BUILT_IN) continue;
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
