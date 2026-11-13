import { ANIM, type AnimId, MOVEMENT } from '@campus/shared';
import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Skeleton,
  SkinnedMesh,
} from 'three';
import { MeshBatch, type Vec3 } from '../world/MeshBatch';

/**
 * Placeholder avatar: a blocky figure built in code, rigidly skinned to a small skeleton and
 * animated procedurally. One draw call per avatar; every avatar shares the same vertex and
 * skinning buffers and only owns its colours.
 *
 * The model stands on y = 0 and faces +Z; its left side is +X.
 */

export interface AvatarLook {
  skin: string;
  hair: string;
  top: string;
  bottom: string;
  shoes: string;
}

export const DEFAULT_LOOK: AvatarLook = {
  skin: '#f1c7a0',
  hair: '#3a2a22',
  top: '#3d7fd9',
  bottom: '#2f3a4a',
  shoes: '#f4f4f4',
};

type Slot = keyof AvatarLook | 'lanyard' | 'badge' | 'eyes';
const FIXED_COLOURS: Record<'lanyard' | 'badge' | 'eyes', string> = {
  lanyard: '#f28c28',
  badge: '#ffffff',
  eyes: '#26201c',
};

const BONE_NAMES = [
  'root',
  'hips',
  'spine',
  'head',
  'armL',
  'forearmL',
  'armR',
  'forearmR',
  'legL',
  'shinL',
  'legR',
  'shinR',
] as const;
type BoneName = (typeof BONE_NAMES)[number];

/** Joint positions in the bind pose, in model space. */
const JOINTS: Record<BoneName, { parent: BoneName | null; at: Vec3 }> = {
  root: { parent: null, at: [0, 0, 0] },
  hips: { parent: 'root', at: [0, 0.72, 0] },
  spine: { parent: 'hips', at: [0, 0.74, 0] },
  head: { parent: 'spine', at: [0, 1.2, 0] },
  armL: { parent: 'spine', at: [0.27, 1.14, 0] },
  forearmL: { parent: 'armL', at: [0.27, 0.88, 0] },
  armR: { parent: 'spine', at: [-0.27, 1.14, 0] },
  forearmR: { parent: 'armR', at: [-0.27, 0.88, 0] },
  legL: { parent: 'hips', at: [0.11, 0.72, 0] },
  shinL: { parent: 'legL', at: [0.11, 0.38, 0] },
  legR: { parent: 'hips', at: [-0.11, 0.72, 0] },
  shinR: { parent: 'legR', at: [-0.11, 0.38, 0] },
};

interface Template {
  position: BufferAttribute;
  skinIndex: BufferAttribute;
  skinWeight: BufferAttribute;
  index: BufferAttribute;
  /** Which colour slot each vertex takes. */
  slots: Slot[];
}

let template: Template | undefined;

function buildTemplate(): Template {
  const batch = new MeshBatch();
  const bones: number[] = [];
  const slots: Slot[] = [];
  const part = (bone: BoneName, slot: Slot, centre: Vec3, size: Vec3) => {
    const before = batch.vertexCount;
    batch.box(centre, size, '#ffffff');
    for (let i = before; i < batch.vertexCount; i++) {
      bones.push(BONE_NAMES.indexOf(bone));
      slots.push(slot);
    }
  };

  part('hips', 'bottom', [0, 0.69, 0], [0.36, 0.14, 0.24]);
  part('spine', 'top', [0, 0.97, 0], [0.42, 0.46, 0.26]);
  part('spine', 'lanyard', [0, 1.03, 0.134], [0.05, 0.28, 0.012]);
  part('spine', 'badge', [0, 0.86, 0.138], [0.1, 0.13, 0.012]);
  part('head', 'skin', [0, 1.43, 0], [0.44, 0.42, 0.42]);
  part('head', 'hair', [0, 1.61, -0.02], [0.47, 0.14, 0.46]);
  part('head', 'hair', [0, 1.48, -0.2], [0.47, 0.32, 0.08]);
  for (const side of [1, -1]) {
    const arm = side === 1 ? 'armL' : 'armR';
    const forearm = side === 1 ? 'forearmL' : 'forearmR';
    const leg = side === 1 ? 'legL' : 'legR';
    const shin = side === 1 ? 'shinL' : 'shinR';
    part('head', 'eyes', [side * 0.1, 1.44, 0.212], [0.05, 0.07, 0.01]);
    part(arm, 'top', [side * 0.27, 1.01, 0], [0.12, 0.28, 0.13]);
    part(forearm, 'skin', [side * 0.27, 0.76, 0], [0.11, 0.24, 0.12]);
    part(forearm, 'skin', [side * 0.27, 0.6, 0], [0.115, 0.1, 0.125]);
    part(leg, 'bottom', [side * 0.11, 0.55, 0], [0.17, 0.36, 0.2]);
    part(shin, 'bottom', [side * 0.11, 0.24, 0], [0.16, 0.3, 0.19]);
    part(shin, 'shoes', [side * 0.11, 0.05, 0.03], [0.17, 0.1, 0.28]);
  }

  const geometry = batch.toGeometry({ colours: false });
  const count = batch.vertexCount;
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    skinIndex[i * 4] = bones[i] as number;
    skinWeight[i * 4] = 1;
  }
  return {
    position: geometry.getAttribute('position') as BufferAttribute,
    index: geometry.getIndex() as BufferAttribute,
    skinIndex: new BufferAttribute(skinIndex, 4),
    skinWeight: new BufferAttribute(skinWeight, 4),
    slots,
  };
}

const bodyMaterial = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
const shadowGeometry = new CircleGeometry(0.42, 20).rotateX(-Math.PI / 2);
const shadowMaterial = new MeshBasicMaterial({
  color: '#000000',
  transparent: true,
  opacity: 0.22,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -8,
  polygonOffsetUnits: -16,
});

/** Joint angles of one pose. Positive swing is forwards, positive bend closes the joint. */
interface Pose {
  hipsY: number;
  lean: number;
  twist: number;
  headYaw: number;
  armL: number;
  armR: number;
  spread: number;
  elbowL: number;
  elbowR: number;
  legL: number;
  legR: number;
  kneeL: number;
  kneeR: number;
}
const POSE_KEYS: (keyof Pose)[] = [
  'hipsY',
  'lean',
  'twist',
  'headYaw',
  'armL',
  'armR',
  'spread',
  'elbowL',
  'elbowR',
  'legL',
  'legR',
  'kneeL',
  'kneeR',
];
const emptyPose = (): Pose => ({
  hipsY: 0,
  lean: 0,
  twist: 0,
  headYaw: 0,
  armL: 0,
  armR: 0,
  spread: 0,
  elbowL: 0,
  elbowR: 0,
  legL: 0,
  legR: 0,
  kneeL: 0,
  kneeR: 0,
});

/** The poses that get cross-faded. Walking and running are one continuous "move" pose. */
type Mode = 'idle' | 'move' | 'jump' | 'fall' | 'sit';
const MODES: Mode[] = ['idle', 'move', 'jump', 'fall', 'sit'];

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export interface AvatarMotion {
  anim: AnimId;
  /** Horizontal speed in m/s; sets the pace and reach of the stride. */
  speed: number;
}

export class Avatar {
  /** Add this to the scene. Position it at the feet; rotate it about Y to face a direction. */
  readonly object = new Group();

  private readonly mesh: SkinnedMesh;
  private readonly shadow: Mesh;
  private readonly bones = {} as Record<BoneName, Bone>;
  private readonly weights: Record<Mode, number> = { idle: 1, move: 0, jump: 0, fall: 0, sit: 0 };
  private readonly poses: Record<Mode, Pose> = {
    idle: emptyPose(),
    move: emptyPose(),
    jump: emptyPose(),
    fall: emptyPose(),
    sit: emptyPose(),
  };
  private readonly blended = emptyPose();
  private stride = 0;
  private clock = 0;
  private landing = 0;
  private wasAirborne = false;

  constructor(look: AvatarLook = DEFAULT_LOOK) {
    template ??= buildTemplate();

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', template.position);
    geometry.setAttribute('skinIndex', template.skinIndex);
    geometry.setAttribute('skinWeight', template.skinWeight);
    geometry.setIndex(template.index);
    geometry.setAttribute(
      'color',
      new BufferAttribute(new Float32Array(template.slots.length * 3), 3),
    );
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();

    this.mesh = new SkinnedMesh(geometry, bodyMaterial);
    this.mesh.name = 'avatar';
    for (const name of BONE_NAMES) {
      const bone = new Bone();
      bone.name = name;
      const { parent, at } = JOINTS[name];
      const origin = parent ? JOINTS[parent].at : ([0, 0, 0] as const);
      bone.position.set(at[0] - origin[0], at[1] - origin[1], at[2] - origin[2]);
      if (parent) this.bones[parent].add(bone);
      this.bones[name] = bone;
    }
    this.mesh.add(this.bones.root);
    this.mesh.bind(new Skeleton(BONE_NAMES.map((name) => this.bones[name])));

    this.shadow = new Mesh(shadowGeometry, shadowMaterial);
    this.shadow.name = 'avatar-shadow';
    this.shadow.position.y = 0.02;
    this.object.add(this.mesh, this.shadow);
    this.setLook(look);
  }

  setLook(look: AvatarLook): void {
    if (!template) return;
    const colours = this.mesh.geometry.getAttribute('color') as BufferAttribute;
    const colour = new Color();
    template.slots.forEach((slot, i) => {
      colour.set(
        slot in look
          ? look[slot as keyof AvatarLook]
          : FIXED_COLOURS[slot as keyof typeof FIXED_COLOURS],
      );
      colours.setXYZ(i, colour.r, colour.g, colour.b);
    });
    colours.needsUpdate = true;
  }

  /** How far below the feet the ground is (0 when standing on it); moves and fades the shadow. */
  setHeightAboveGround(height: number): void {
    const clamped = Math.max(0, height);
    this.shadow.position.y = 0.02 - clamped;
    this.shadow.scale.setScalar(Math.max(0.35, 1 - clamped * 0.25));
  }

  setBodyVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  /** Advances the animation by `dt` seconds. */
  update(dt: number, motion: AvatarMotion): void {
    this.clock += dt;
    const mode: Mode =
      motion.anim === ANIM.sit
        ? 'sit'
        : motion.anim === ANIM.jump
          ? 'jump'
          : motion.anim === ANIM.fall
            ? 'fall'
            : motion.anim === ANIM.walk || motion.anim === ANIM.run
              ? 'move'
              : 'idle';

    const airborne = mode === 'jump' || mode === 'fall';
    if (this.wasAirborne && !airborne) this.landing = 1;
    this.wasAirborne = airborne;
    this.landing = Math.max(0, this.landing - dt / 0.22);

    // Cross-fade between modes.
    const fade = 1 - Math.exp(-dt * 12);
    let total = 0;
    for (const key of MODES) {
      this.weights[key] += ((key === mode ? 1 : 0) - this.weights[key]) * fade;
      total += this.weights[key];
    }

    // How far between a walk (0) and a full run (1), and how big the stride is.
    const runBlend = Math.min(
      1,
      Math.max(0, (motion.speed - MOVEMENT.walkSpeed) / (MOVEMENT.runSpeed - MOVEMENT.walkSpeed)),
    );
    const reach = Math.min(1, motion.speed / MOVEMENT.walkSpeed);
    this.stride += ((motion.speed * dt) / mix(1.25, 2.3, runBlend)) * Math.PI * 2;

    this.poseIdle(this.poses.idle);
    this.poseMove(this.poses.move, runBlend, reach);
    this.poseJump(this.poses.jump);
    this.poseFall(this.poses.fall);
    this.poseSit(this.poses.sit);

    for (const key of POSE_KEYS) {
      let value = 0;
      for (const m of MODES) value += this.poses[m][key] * this.weights[m];
      this.blended[key] = value / total;
    }
    this.apply(this.blended);
  }

  private poseIdle(pose: Pose): void {
    const t = this.clock;
    pose.hipsY = Math.sin(t * 1.7) * 0.006;
    pose.lean = Math.sin(t * 1.7) * 0.015;
    pose.twist = 0;
    pose.headYaw = Math.sin(t * 0.45) * 0.14;
    pose.armL = pose.armR = Math.sin(t * 1.1) * 0.03;
    pose.spread = 0.07;
    pose.elbowL = pose.elbowR = 0.12;
    pose.legL = pose.legR = 0;
    pose.kneeL = pose.kneeR = 0;
  }

  private poseMove(pose: Pose, run: number, reach: number): void {
    const swing = Math.sin(this.stride);
    const lift = Math.cos(this.stride);
    const legSwing = mix(0.55, 0.95, run) * reach;
    const armSwing = mix(0.45, 0.9, run) * reach;
    const kneeBend = mix(0.9, 1.5, run) * reach;
    pose.hipsY = -mix(0.025, 0.05, run) * Math.abs(swing) * reach;
    pose.lean = mix(0.04, 0.2, run);
    pose.twist = swing * 0.12 * reach;
    pose.headYaw = 0;
    pose.legL = swing * legSwing;
    pose.legR = -swing * legSwing;
    // A knee bends while its leg swings forward through the air.
    pose.kneeL = Math.max(0, lift) * kneeBend;
    pose.kneeR = Math.max(0, -lift) * kneeBend;
    pose.armL = -swing * armSwing;
    pose.armR = swing * armSwing;
    pose.spread = 0.05;
    pose.elbowL = pose.elbowR = mix(0.25, 1.3, run);
  }

  private poseJump(pose: Pose): void {
    Object.assign(pose, emptyPose(), {
      lean: -0.05,
      armL: 2.3,
      armR: 2.3,
      spread: 0.2,
      elbowL: 0.3,
      elbowR: 0.3,
      legL: 0.55,
      kneeL: 1.1,
      legR: 0.15,
      kneeR: 0.5,
    });
  }

  private poseFall(pose: Pose): void {
    Object.assign(pose, emptyPose(), {
      lean: 0.1,
      armL: 0.4,
      armR: 0.4,
      spread: 1.1,
      elbowL: 0.3,
      elbowR: 0.3,
      legL: 0.25,
      kneeL: 0.5,
      legR: -0.15,
      kneeR: 0.3,
    });
  }

  private poseSit(pose: Pose): void {
    Object.assign(pose, emptyPose(), {
      hipsY: -0.16,
      armL: 0.55,
      armR: 0.55,
      spread: 0.05,
      elbowL: 0.9,
      elbowR: 0.9,
      legL: 1.5,
      legR: 1.5,
      kneeL: 1.5,
      kneeR: 1.5,
      headYaw: Math.sin(this.clock * 0.4) * 0.2,
    });
  }

  private apply(pose: Pose): void {
    const b = this.bones;
    // Landing: a short dip that eases out.
    const dip = this.landing * this.landing * 0.09;
    b.hips.position.y = JOINTS.hips.at[1] + pose.hipsY - dip;
    b.spine.rotation.set(pose.lean, pose.twist, 0);
    b.head.rotation.set(-pose.lean * 0.6, pose.headYaw - pose.twist * 0.7, 0);
    // Limbs hang along -Y: a negative rotation about X swings them forwards (+Z).
    b.armL.rotation.set(-pose.armL, 0, pose.spread);
    b.armR.rotation.set(-pose.armR, 0, -pose.spread);
    b.forearmL.rotation.x = -pose.elbowL;
    b.forearmR.rotation.x = -pose.elbowR;
    b.legL.rotation.x = -pose.legL - dip * 3;
    b.legR.rotation.x = -pose.legR - dip * 3;
    b.shinL.rotation.x = pose.kneeL + dip * 6;
    b.shinR.rotation.x = pose.kneeR + dip * 6;
  }

  dispose(): void {
    this.object.removeFromParent();
    const geometry = this.mesh.geometry;
    // Shared buffers stay alive for other avatars; only this avatar's colours are released.
    geometry.deleteAttribute('position');
    geometry.deleteAttribute('skinIndex');
    geometry.deleteAttribute('skinWeight');
    geometry.setIndex(null);
    geometry.dispose();
    this.mesh.skeleton.dispose();
  }
}
