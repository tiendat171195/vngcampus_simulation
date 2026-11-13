import { distance, floorAt, type Poi } from '@campus/map-data';
import { campusIndex, campusMap } from '@campus/map-data/campus';
import { ANIM, type AnimId, MOVEMENT } from '@campus/shared';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { DoubleSide, Group, Ray, Vector3 } from 'three';
import type { MeshBVH } from 'three-mesh-bvh';
import { Avatar } from '../avatars/Avatar';
import { randomLook } from '../avatars/looks';
import { QUALITY_PRESETS } from '../core/quality';
import { useSession } from '../core/session';
import { useDebugStore } from '../debug/debugStore';
import { CharacterMotor } from '../player/CharacterMotor';
import { useWorld } from '../world/CampusWorld';

/** Where bots may go: spots meant for people to walk to. */
const DESTINATION_KINDS = new Set<Poi['kind']>([
  'item_spot',
  'checkpoint',
  'kiosk_spot',
  'photo_spot',
]);
const SIGHT_HEIGHT = 0.9;
const STEP = 1 / 30;

const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)] as T;

interface Bot {
  avatar: Avatar;
  motor: CharacterMotor;
  target: Poi | null;
  yaw: number;
  /** Seconds to stand still before choosing the next destination. */
  pause: number;
  /** Progress check: where it was and how long ago. */
  checkpoint: Vector3;
  checkIn: number;
  runner: boolean;
  animAccumulator: number;
  stepAccumulator: number;
}

/** Destination on the bot's floor, 6–45 m away, that it can see without a wall in between. */
function chooseTarget(bot: Bot, bvh: MeshBVH, ray: Ray): Poi | null {
  const { position } = bot.motor;
  const floor = floorAt(campusIndex, position.y);
  const candidates = campusMap.pois.filter((poi) => {
    if (poi.floor !== floor || !DESTINATION_KINDS.has(poi.kind)) return false;
    const d = distance(poi.position, [position.x, position.z]);
    return d > 6 && d < 45;
  });
  for (let attempt = 0; attempt < 10 && candidates.length > 0; attempt++) {
    const poi = pick(candidates);
    const target = new Vector3(poi.position[0], position.y + SIGHT_HEIGHT, poi.position[1]);
    ray.origin.set(position.x, position.y + SIGHT_HEIGHT, position.z);
    const length = ray.origin.distanceTo(target);
    ray.direction.copy(target).sub(ray.origin).normalize();
    const hit = bvh.raycastFirst(ray, DoubleSide, 0, length);
    if (!hit) return poi;
  }
  return null;
}

/**
 * Fake colleagues that wander between points of interest, for measuring how a crowd renders
 * (docs/04-client.md §13). Each one is a full avatar on its own character motor; animation is
 * updated less often for bots far from the camera.
 */
export function BotCrowd() {
  const world = useWorld();
  const count = useDebugStore((state) => state.bots);
  const group = useMemo(() => new Group(), []);

  const bots = useMemo(() => {
    const spots = campusMap.pois.filter((poi) => poi.kind === 'item_spot');
    return Array.from({ length: count }, (): Bot => {
      const spot = pick(spots);
      const motor = new CharacterMotor(world.bvh);
      motor.teleport(
        spot.position[0],
        campusIndex.floors.get(spot.floor)?.y ?? 0,
        spot.position[1],
      );
      const avatar = new Avatar(randomLook());
      return {
        avatar,
        motor,
        target: null,
        yaw: Math.random() * Math.PI * 2,
        pause: Math.random() * 3,
        checkpoint: motor.position.clone(),
        checkIn: 3,
        runner: Math.random() < 0.15,
        animAccumulator: Math.random() * 0.2,
        stepAccumulator: 0,
      };
    });
  }, [count, world]);

  useEffect(() => {
    for (const bot of bots) group.add(bot.avatar.object);
    return () => {
      for (const bot of bots) bot.avatar.dispose();
    };
  }, [bots, group]);

  const ray = useMemo(() => new Ray(), []);

  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, 0.1);
    const preset = QUALITY_PRESETS[useSession.getState().quality.level];

    for (const bot of bots) {
      const { motor, avatar } = bot;
      let x = 0;
      let z = 0;
      let run = false;

      if (bot.pause > 0) {
        bot.pause -= dt;
      } else if (!bot.target) {
        bot.target = chooseTarget(bot, world.bvh, ray);
        if (!bot.target) bot.pause = 1 + Math.random() * 2;
        bot.checkpoint.copy(motor.position);
        bot.checkIn = 3;
      } else {
        const dx = bot.target.position[0] - motor.position.x;
        const dz = bot.target.position[1] - motor.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 1) {
          bot.target = null;
          bot.pause = 1 + Math.random() * 4;
        } else {
          x = dx / d;
          z = dz / d;
          run = bot.runner && d > 8;
          bot.checkIn -= dt;
          if (bot.checkIn <= 0) {
            // Blocked by furniture or another obstacle: give up on this one.
            if (bot.checkpoint.distanceTo(motor.position) < 1) {
              bot.target = null;
              bot.pause = 0.5;
            }
            bot.checkpoint.copy(motor.position);
            bot.checkIn = 3;
          }
        }
      }

      bot.stepAccumulator += dt;
      while (bot.stepAccumulator >= STEP) {
        motor.step(STEP, { x, z, run, jump: false });
        bot.stepAccumulator -= STEP;
      }

      if (x !== 0 || z !== 0) {
        const wanted = Math.atan2(x, z);
        bot.yaw +=
          Math.atan2(Math.sin(wanted - bot.yaw), Math.cos(wanted - bot.yaw)) * Math.min(1, 10 * dt);
      }
      avatar.object.position.copy(motor.position);
      avatar.object.rotation.y = bot.yaw;

      // Animation level of detail: every frame up close, 15 Hz further out, 5 Hz far away.
      const fromCamera = camera.position.distanceTo(motor.position);
      const interval =
        fromCamera < preset.fullAnimationDistance
          ? 0
          : fromCamera < preset.reducedAnimationDistance
            ? 1 / 15
            : 1 / 5;
      bot.animAccumulator += dt;
      if (bot.animAccumulator >= interval) {
        let anim: AnimId = ANIM.idle;
        if (!motor.grounded) anim = ANIM.fall;
        else if (motor.speed > (MOVEMENT.walkSpeed + MOVEMENT.runSpeed) / 2) anim = ANIM.run;
        else if (motor.speed > 0.3) anim = ANIM.walk;
        avatar.update(bot.animAccumulator, { anim, speed: motor.speed });
        bot.animAccumulator = 0;
      }
    }
  });

  return <primitive object={group} />;
}
