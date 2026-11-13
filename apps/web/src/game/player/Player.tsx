import { areasAt, findArea, floorAt, type Poi, poisOfSet } from '@campus/map-data';
import { campusIndex } from '@campus/map-data/campus';
import { ANIM, type AnimId, MOVEMENT } from '@campus/shared';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { DoubleSide, type PerspectiveCamera, Ray, Vector3 } from 'three';
import { Avatar } from '../avatars/Avatar';
import { input, readMove } from '../core/input';
import { hudSink, useSession } from '../core/session';
import { useSettings } from '../core/settings';
import { playerSink, useDebugStore } from '../debug/debugStore';
import { useWorld } from '../world/CampusWorld';
import { CameraRig } from './CameraRig';
import { CharacterMotor, type MoveIntent } from './CharacterMotor';

const STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;
const TURN_RATE = 12;
const DOWN = new Vector3(0, -1, 0);

/** Shortest signed difference between two angles. */
const angleDelta = (from: number, to: number) =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from));

/** The local player: reads input, moves the character, animates the avatar, drives the camera. */
export function Player() {
  const world = useWorld();
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const following = useDebugStore((state) => state.cameraMode === 'follow');

  const motor = useMemo(() => new CharacterMotor(world.bvh), [world]);
  const avatar = useMemo(() => new Avatar(), []);
  const rig = useMemo(() => new CameraRig(), []);
  const state = useRef({
    yaw: 0,
    accumulator: 0,
    previous: new Vector3(),
    rendered: new Vector3(),
    ray: new Ray(),
    reportIn: 0,
    /** Area seen on the last report; it becomes the location once seen twice in a row. */
    pendingArea: '',
    shownArea: '',
  });

  useEffect(() => () => avatar.dispose(), [avatar]);

  useEffect(() => {
    // `?spawn=poi.some_id` starts somewhere else, for testing one part of the campus.
    const requested = new URLSearchParams(window.location.search).get('spawn');
    const spawn: Poi | undefined =
      (requested && campusIndex.pois.get(requested)) || poisOfSet(campusIndex, 'players_gate')[0];
    const s = state.current;
    if (spawn) {
      motor.teleport(
        spawn.position[0],
        campusIndex.floors.get(spawn.floor)?.y ?? 0,
        spawn.position[1],
      );
      s.yaw = ((spawn.yawDeg ?? 0) * Math.PI) / 180;
    }
    s.previous.copy(motor.position);
    rig.heading = s.yaw;
    rig.snap();
  }, [motor, rig]);

  // Coming back from the free camera: do not ease from wherever it was left.
  useEffect(() => {
    if (following) rig.snap();
  }, [following, rig]);

  useFrame((_, delta) => {
    const s = state.current;
    const dt = Math.min(delta, 0.1);

    const intent: MoveIntent = { x: 0, z: 0, run: false, jump: false };
    if (following) {
      const move = readMove();
      const sin = Math.sin(rig.heading);
      const cos = Math.cos(rig.heading);
      // Forward is the camera heading; right is forward × up.
      intent.x = sin * move.y - cos * move.x;
      intent.z = cos * move.y + sin * move.x;
      intent.run = move.run;
      intent.jump = input.jump;
    }
    input.jump = false;

    s.accumulator += dt;
    let steps = 0;
    while (s.accumulator >= STEP && steps < MAX_STEPS_PER_FRAME) {
      s.previous.copy(motor.position);
      motor.step(STEP, intent);
      intent.jump = false;
      s.accumulator -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) s.accumulator = 0;

    // Draw between the last two simulation steps, so motion stays smooth at any refresh rate.
    s.rendered.lerpVectors(s.previous, motor.position, s.accumulator / STEP);

    if (Math.hypot(intent.x, intent.z) > 0.1) {
      const wanted = Math.atan2(intent.x, intent.z);
      s.yaw += angleDelta(s.yaw, wanted) * Math.min(1, TURN_RATE * dt);
    }

    let anim: AnimId = ANIM.idle;
    if (!motor.grounded) anim = motor.velocity.y > 0 ? ANIM.jump : ANIM.fall;
    else if (motor.speed > (MOVEMENT.walkSpeed + MOVEMENT.runSpeed) / 2) anim = ANIM.run;
    else if (motor.speed > 0.3) anim = ANIM.walk;

    avatar.object.position.copy(s.rendered);
    avatar.object.rotation.y = s.yaw;
    avatar.update(dt, { anim, speed: motor.speed });

    if (motor.grounded) {
      avatar.setHeightAboveGround(0);
    } else {
      s.ray.origin.copy(s.rendered);
      s.ray.direction.copy(DOWN);
      const ground = world.bvh.raycastFirst(s.ray, DoubleSide, 0, 30);
      avatar.setHeightAboveGround(ground ? ground.distance : 30);
    }

    const floorNow = floorAt(campusIndex, s.rendered.y);
    hudSink.player?.(s.rendered.x, s.rendered.z, s.yaw, floorNow);

    if (following) {
      rig.sensitivity = useSettings.getState().lookSensitivity;
      rig.look(input.lookX, input.lookY, input.zoom);
      rig.update(dt, camera, s.rendered, world.bvh);
      // Up close the body would fill the screen.
      avatar.setBodyVisible(rig.armLength > 0.9);
    } else {
      avatar.setBodyVisible(true);
    }
    input.lookX = 0;
    input.lookY = 0;
    input.zoom = 0;

    s.reportIn -= dt;
    if (s.reportIn <= 0) {
      s.reportIn = 0.25;
      const { x, y, z } = motor.position;
      const floor = floorAt(campusIndex, y);
      const area = findArea(campusIndex, [x, z], floor);

      // The named place the player is in: the most specific area that is not just "a floor".
      const containing = areasAt(campusIndex, [x, z], floor);
      const place = containing.find((a) => !a.tags.includes('base')) ?? containing[0];
      const placeId = place ? `${place.id}@${floor}` : '';
      if (placeId === s.pendingArea && placeId !== s.shownArea && place) {
        s.shownArea = placeId;
        useSession.getState().setLocation({
          areaId: place.id,
          name: place.name.vi,
          floorLabel: campusIndex.floors.get(floor)?.label.vi ?? floor,
        });
      }
      s.pendingArea = placeId;

      if (!playerSink.element) return;
      playerSink.element.textContent = `${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)} · ${floor} · ${area?.name.vi ?? '—'}`;
      playerSink.element.dataset.x = x.toFixed(2);
      playerSink.element.dataset.y = y.toFixed(2);
      playerSink.element.dataset.z = z.toFixed(2);
      playerSink.element.dataset.area = area?.id ?? '';
    }
  });

  return <primitive object={avatar.object} />;
}
