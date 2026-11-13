import { type CampusMap, createMapIndex, type FloorId } from '@campus/map-data';
import {
  DoubleSide,
  Group,
  type InstancedMesh,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
} from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { type BuildContext, LEVEL_ORDER, type LevelBatches, type LevelId } from './context';
import { buildGround } from './ground';
import { MeshBatch } from './MeshBatch';
import { PALETTE } from './palette';
import { buildProps } from './props';
import { buildStructures } from './structures';

export interface World {
  /** Everything visible. Add it to the scene. */
  root: Group;
  /** One group per storey; `ground` is everything outdoors. */
  levels: ReadonlyMap<LevelId, Group>;
  /** Static collision mesh. Not part of `root`; add it to the scene to inspect it. */
  collider: Mesh;
  /** Acceleration structure over the collider, for character movement and camera rays. */
  bvh: MeshBVH;
  stats: { triangles: number; drawCalls: number; colliderTriangles: number };
  /** Hides every storey above the given one, for looking into the buildings from above. */
  showUpTo(level: LevelId): void;
  dispose(): void;
}

/**
 * Turns a map into a walkable greybox world: the visible scene and its collision mesh.
 * Pure three.js with no DOM access, so it also runs in Node (tests, tools).
 */
export function buildWorld(map: CampusMap): World {
  const index = createMapIndex(map);
  const batches = new Map<LevelId, LevelBatches>();
  const ctx: BuildContext = {
    map,
    index,
    collider: new MeshBatch(),
    level(id) {
      let level = batches.get(id);
      if (!level) {
        level = { solid: new MeshBatch(), glass: new MeshBatch() };
        batches.set(id, level);
      }
      return level;
    },
    floorY(id: FloorId) {
      const floor = index.floors.get(id);
      if (!floor) throw new Error(`Map has no floor "${id}"`);
      return floor.y;
    },
  };

  const solidMaterial = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const glassMaterial = new MeshLambertMaterial({
    color: PALETTE.glass,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    side: DoubleSide,
  });
  const materials: Material[] = [solidMaterial, glassMaterial];

  buildGround(ctx);
  buildStructures(ctx);
  const props = buildProps(ctx, solidMaterial);

  const root = new Group();
  root.name = 'campus';
  const levels = new Map<LevelId, Group>();
  let triangles = 0;
  let drawCalls = 0;

  for (const id of LEVEL_ORDER) {
    const group = new Group();
    group.name = `level:${id}`;
    const level = batches.get(id);
    if (level && !level.solid.isEmpty) {
      const mesh = new Mesh(level.solid.toGeometry(), solidMaterial);
      mesh.name = `${id}:solid`;
      group.add(mesh);
      triangles += level.solid.triangleCount;
      drawCalls++;
    }
    if (level && !level.glass.isEmpty) {
      const mesh = new Mesh(level.glass.toGeometry({ colours: false }), glassMaterial);
      mesh.name = `${id}:glass`;
      mesh.renderOrder = 1;
      group.add(mesh);
      triangles += level.glass.triangleCount;
      drawCalls++;
    }
    for (const prop of props.filter((p) => p.level === id)) {
      group.add(prop.mesh);
      const index = prop.mesh.geometry.getIndex();
      triangles += ((index?.count ?? 0) / 3) * prop.mesh.count;
      drawCalls++;
    }
    levels.set(id, group);
    root.add(group);
  }

  const colliderGeometry = ctx.collider.toGeometry({ colours: false });
  const bvh = new MeshBVH(colliderGeometry);
  colliderGeometry.boundsTree = bvh;
  const colliderMaterial = new MeshBasicMaterial({ color: '#ff3ea5', wireframe: true });
  materials.push(colliderMaterial);
  const collider = new Mesh(colliderGeometry, colliderMaterial);
  collider.name = 'collider';
  collider.visible = false;

  return {
    root,
    levels,
    collider,
    bvh,
    stats: { triangles, drawCalls, colliderTriangles: ctx.collider.triangleCount },
    showUpTo(level) {
      const limit = LEVEL_ORDER.indexOf(level);
      for (const [id, group] of levels) group.visible = LEVEL_ORDER.indexOf(id) <= limit;
    },
    dispose() {
      root.traverse((object) => {
        const mesh = object as Mesh | InstancedMesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
      colliderGeometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
