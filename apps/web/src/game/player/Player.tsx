import { areasAt, distance, findArea, floorAt, type Poi, poisOfSet } from '@campus/map-data';
import { campusIndex } from '@campus/map-data/campus';
import { ANIM, type AnimId, EMOTE_BY_ID, EMOTES, MOVEMENT } from '@campus/shared';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { DoubleSide, type PerspectiveCamera, Ray, Vector3 } from 'three';
import { Avatar } from '../avatars/Avatar';
import { input, readMove } from '../core/input';
import { hudSink, useSession } from '../core/session';
import { useSettings } from '../core/settings';
import { playerSink, useDebugStore } from '../debug/debugStore';
import { net } from '../net/net';
import { useWorld } from '../world/CampusWorld';
import { CameraRig } from './CameraRig';
import { CharacterMotor, type MoveIntent } from './CharacterMotor';

const STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;
const TURN_RATE = 12;
const DOWN = new Vector3(0, -1, 0);
/** A free seat is offered when the player stands this close to it. */
const PROMPT_REACH = 1.6;
const SEATS: readonly Poi[] = [...campusIndex.pois.values()].filter((poi) => poi.kind === 'seat');

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
    /** Emote being performed: which one, a counter that restarts it, and when it ends (ms). */
    emote: { id: 0, seq: 0, until: 0 },
    /** Seat granted by the server, '' when standing. */
    seatId: '',
    promptIn: 0,
    promptSeat: '',
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

  // The server decides where we start and can send us back after a rejected move.
  useEffect(() => {
    const s = state.current;
    net.onSpawn = ({ x, y, z, yaw }) => {
      motor.teleport(x, y, z);
      s.previous.copy(motor.position);
      s.yaw = yaw;
      rig.heading = yaw;
      rig.snap();
    };
    net.onSeat = (seatId) => {
      s.seatId = seatId;
      const seat = seatId ? campusIndex.pois.get(seatId) : undefined;
      if (!seat) return;
      // Settle onto the seat, facing the way it faces.
      motor.teleport(
        seat.position[0],
        campusIndex.floors.get(seat.floor)?.y ?? 0,
        seat.position[1],
      );
      s.previous.copy(motor.position);
      s.yaw = ((seat.yawDeg ?? 0) * Math.PI) / 180;
      s.emote.until = 0;
    };
    net.onCorrect = (x, y, z) => {
      motor.teleport(x, y, z);
      s.previous.copy(motor.position);
    };
    return () => {
      net.onSpawn = null;
      net.onCorrect = null;
      net.onSeat = null;
    };
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
    const now = performance.now();
    const wantsToMove = Math.hypot(intent.x, intent.z) > 0.1 || intent.jump;

    // Sitting: any movement stands up; until then the body stays on the seat.
    if (s.seatId) {
      if (wantsToMove) {
        net.leaveSeat();
        s.seatId = '';
      } else {
        intent.x = 0;
        intent.z = 0;
      }
    }

    // Emotes: start on request when standing still on the ground, stop as soon as the player moves.
    const requested = input.emote;
    input.emote = 0;
    if (wantsToMove) s.emote.until = 0;
    const emoteName = EMOTE_BY_ID.get(requested);
    if (emoteName && !wantsToMove && motor.grounded && !s.seatId) {
      s.emote = {
        id: requested,
        seq: s.emote.seq + 1,
        until: now + EMOTES[emoteName].seconds * 1000,
      };
      net.sendEmote(requested);
    }

    // Interaction: sit on the free seat the prompt points at.
    if (input.interact) {
      input.interact = false;
      if (s.promptSeat && !s.seatId) net.takeSeat(s.promptSeat);
    }

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
    if (s.seatId) anim = ANIM.sit;
    else if (now < s.emote.until && motor.grounded) anim = ANIM.emote;
    else if (!motor.grounded) anim = motor.velocity.y > 0 ? ANIM.jump : ANIM.fall;
    else if (motor.speed > (MOVEMENT.walkSpeed + MOVEMENT.runSpeed) / 2) anim = ANIM.run;
    else if (motor.speed > 0.3) anim = ANIM.walk;

    net.update(performance.now(), {
      x: motor.position.x,
      y: motor.position.y,
      z: motor.position.z,
      yaw: s.yaw,
      anim,
    });

    avatar.object.position.copy(s.rendered);
    avatar.object.rotation.y = s.yaw;
    avatar.update(dt, { anim, speed: motor.speed, emote: s.emote.id, emoteSeq: s.emote.seq });

    // Offer the nearest free seat within reach.
    s.promptIn -= dt;
    if (s.promptIn <= 0) {
      s.promptIn = 0.15;
      let best = '';
      let bestDistance = PROMPT_REACH;
      if (!s.seatId && motor.grounded) {
        const floor = floorAt(campusIndex, motor.position.y);
        for (const seat of SEATS) {
          if (seat.floor !== floor) continue;
          const d = distance(seat.position, [motor.position.x, motor.position.z]);
          const holder = net.seats.get(seat.id);
          if (d < bestDistance && (!holder || holder === '')) {
            best = seat.id;
            bestDistance = d;
          }
        }
      }
      if (best !== s.promptSeat) {
        s.promptSeat = best;
        useSession.getState().setPrompt(best ? { seatId: best, label: 'Ngồi xuống' } : null);
      }
    }

    if (motor.grounded) {
      avatar.setHeightAboveGround(0);
    } else {
      s.ray.origin.copy(s.rendered);
      s.ray.direction.copy(DOWN);
      const ground = world.bvh.raycastFirst(s.ray, DoubleSide, 0, 30);
      avatar.setHeightAboveGround(ground ? ground.distance : 30);
    }

    const floorNow = floorAt(campusIndex, s.rendered.y);
    hudSink.player?.(s.rendered.x, s.rendered.z, s.yaw, floorNow, rig.heading);

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
