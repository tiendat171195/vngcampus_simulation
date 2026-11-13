import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Object3D,
  OctahedronGeometry,
  RingGeometry,
  Vector3,
} from 'three';
import { playerPose } from '../core/pose';
import { createLabelSprite } from '../world/labels';
import { missionWorld, useMissions } from './missionStore';
import { type WaypointTarget, waypointTarget } from './target';

/** One shared set of geometries and materials for every mission thing. */
const parts = {
  cup: new CylinderGeometry(0.11, 0.09, 0.2, 10),
  coffee: new CylinderGeometry(0.1, 0.1, 0.02, 10),
  gem: new OctahedronGeometry(0.16),
  ring: new RingGeometry(0.35, 0.5, 24).rotateX(-Math.PI / 2),
  kiosk: new BoxGeometry(0.6, 1.4, 0.35),
  screen: new BoxGeometry(0.46, 0.5, 0.02),
  beam: new CylinderGeometry(0.45, 0.45, 40, 16, 1, true),
  white: new MeshLambertMaterial({ color: '#f6f2ea' }),
  brown: new MeshLambertMaterial({ color: '#6b3d22' }),
  gold: new MeshLambertMaterial({ color: '#ffcf3f', emissive: '#7a4a00' }),
  kioskBody: new MeshLambertMaterial({ color: '#f28c28' }),
  kioskScreen: new MeshBasicMaterial({ color: '#3d7fd9' }),
  glow: new MeshBasicMaterial({
    color: '#ffb24a',
    transparent: true,
    opacity: 0.55,
    side: DoubleSide,
    depthWrite: false,
  }),
  beamMaterial: new MeshBasicMaterial({
    color: '#ffb24a',
    transparent: true,
    opacity: 0.18,
    side: DoubleSide,
    depthWrite: false,
    blending: AdditiveBlending,
  }),
};

function buildItem(item: string | undefined): Object3D {
  const floating = new Group();
  floating.name = 'floating';
  floating.userData.baseY = 0.9;
  if (item === 'coffee_cup' || item === 'tea_cup') {
    floating.add(new Mesh(parts.cup, parts.white));
    const top = new Mesh(parts.coffee, parts.brown);
    top.position.y = 0.095;
    floating.add(top);
  } else floating.add(new Mesh(parts.gem, parts.gold));
  return floating;
}

function buildKiosk(): Object3D {
  const kiosk = new Group();
  const body = new Mesh(parts.kiosk, parts.kioskBody);
  body.position.y = 0.7;
  const screen = new Mesh(parts.screen, parts.kioskScreen);
  screen.position.set(0, 1.1, 0.18);
  const sign = createLabelSprite('?', 0.4);
  sign.position.y = 1.9;
  sign.name = 'floating';
  sign.userData.baseY = 1.9;
  kiosk.add(body, screen, sign);
  return kiosk;
}

/**
 * Mission things in the world (docs/06 §8): items float and turn over a glowing ring, kiosks
 * carry a question mark. Rebuilt only when the server sends a new list; the tracked target gets
 * a column of light.
 */
export function MissionEntities() {
  const group = useMemo(() => new Group(), []);
  const beam = useMemo(() => {
    const mesh = new Mesh(parts.beam, parts.beamMaterial);
    mesh.visible = false;
    mesh.renderOrder = 2;
    return mesh;
  }, []);
  const scene = useThree((state) => state.scene);
  const state = useMemo(
    () => ({
      version: -1,
      clock: 0,
      targetIn: 0,
      target: null as WaypointTarget | null,
      at: new Vector3(),
    }),
    [],
  );

  useEffect(() => {
    scene.add(group, beam);
    return () => {
      scene.remove(group, beam);
    };
  }, [scene, group, beam]);

  useFrame((_, dt) => {
    state.clock += dt;
    if (state.version !== missionWorld.version) {
      state.version = missionWorld.version;
      group.clear();
      for (const entity of missionWorld.entities) {
        const root = new Group();
        root.name = entity.id;
        root.position.set(entity.x, entity.y, entity.z);
        if (entity.kind === 'item') {
          const ring = new Mesh(parts.ring, parts.glow);
          ring.position.y = 0.04;
          const floating = buildItem(entity.item);
          floating.position.y = 0.9;
          root.add(ring, floating);
        } else root.add(buildKiosk());
        group.add(root);
      }
    }
    for (const [i, root] of group.children.entries()) {
      const floating = root.getObjectByName('floating');
      if (!floating) continue;
      floating.rotation.y = state.clock * 1.6 + i;
      floating.position.y =
        ((floating.userData.baseY as number | undefined) ?? 0.9) +
        Math.sin(state.clock * 2.4 + i) * 0.08;
    }

    // The column of light over the tracked target, recomputed a few times a second.
    state.targetIn -= dt;
    if (state.targetIn <= 0) {
      state.targetIn = 0.25;
      const { tracked, missions } = useMissions.getState();
      state.target = playerPose.ready
        ? waypointTarget(tracked, missions, missionWorld.entities, playerPose)
        : null;
      waypointSink.target = state.target;
    }
    beam.visible = state.target !== null;
    if (state.target) beam.position.set(state.target.x, state.target.y + 20, state.target.z);
  });

  return null;
}

/** The current waypoint for the HUD compass; written here, read by WaypointCompass. */
export const waypointSink: { target: WaypointTarget | null } = { target: null };
