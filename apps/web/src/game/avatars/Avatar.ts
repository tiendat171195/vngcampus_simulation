import {
  ANIM,
  type AnimId,
  type AvatarConfig,
  CLOTH_COLOURS,
  DEFAULT_AVATAR,
  EMOTE_BY_ID,
  formatAvatar,
  HAIR_COLOURS,
  MOVEMENT,
  SKIN_TONES,
} from '@campus/shared';
import {
  Bone,
  BufferAttribute,
  type BufferGeometry,
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
 * The avatar: a low-poly figure assembled in code from parts chosen by an AvatarConfig (body
 * build, hair, top, bottom, shoes, accessory, colours; docs/03 §7), rigidly skinned to one small
 * skeleton and animated procedurally. The parts are merged into a single skinned mesh coloured
 * per vertex, so each avatar is one draw call; avatars that look the same share one geometry.
 *
 * The model stands on y = 0 and faces +Z; its left side is +X.
 */

/** Colours that are the same on everyone: the staff lanyard and badge are the game's mark. */
const FIXED = {
  lanyard: '#f28c28',
  badge: '#ffffff',
  eyes: '#26201c',
  sole: '#f4f4f4',
  darkSole: '#2a211b',
  shirt: '#f4f4f4',
  frame: '#22262b',
  lens: '#15181c',
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

/** Builds the merged geometry of one avatar, with vertex colours and rigid skinning. */
export function buildAvatarGeometry(config: AvatarConfig): BufferGeometry {
  const batch = new MeshBatch();
  const bones: number[] = [];
  const part = (bone: BoneName, colour: string | Color, centre: Vec3, size: Vec3) => {
    const before = batch.vertexCount;
    batch.box(centre, size, colour);
    for (let i = before; i < batch.vertexCount; i++) bones.push(BONE_NAMES.indexOf(bone));
  };
  const pick = (palette: readonly string[], index: number) =>
    palette[index] ?? palette[0] ?? '#888';
  const shade = (hex: string, factor: number) => new Color(hex).multiplyScalar(factor);

  const skin = pick(SKIN_TONES, config.skin);
  const hair = pick(HAIR_COLOURS, config.hairColour);
  const top = pick(CLOTH_COLOURS, config.topColour);
  const bottom = pick(CLOTH_COLOURS, config.bottomColour);
  const shoes = pick(CLOTH_COLOURS, config.shoesColour);
  // Build: slim, regular, sturdy. Joints stay put; only the volumes change.
  const w = [0.88, 1, 1.14][config.body] ?? 1;
  const d = [0.92, 1, 1.12][config.body] ?? 1;
  const limb = [0.92, 1, 1.1][config.body] ?? 1;

  // Torso and top.
  let front = 0.13 * d;
  const longSleeves = config.top !== 0;
  if (config.top === 2) {
    // Hoodie: roomier, with a hood at the back and a front pocket.
    front = 0.14 * d;
    part('spine', top, [0, 0.96, 0], [0.44 * w, 0.48, 0.28 * d]);
    part('spine', shade(top, 0.82), [0, 1.2, -0.1 * d], [0.36 * w, 0.12, 0.12]);
    part('spine', shade(top, 0.82), [0, 0.84, front + 0.005], [0.24 * w, 0.1, 0.01]);
  } else if (config.top === 3) {
    // Jacket, open over a white shirt.
    front = 0.135 * d;
    part('spine', top, [0, 0.95, 0], [0.43 * w, 0.5, 0.27 * d]);
    part('spine', FIXED.shirt, [0, 1.0, front + 0.004], [0.12 * w, 0.4, 0.008]);
  } else {
    part('spine', top, [0, 0.97, 0], [0.42 * w, 0.46, 0.26 * d]);
    if (config.top === 1) {
      // Shirt: collar and a button placket.
      part('spine', FIXED.shirt, [0, 1.19, 0], [0.3 * w, 0.05, 0.22 * d]);
      part('spine', shade(top, 0.8), [0, 0.97, front + 0.004], [0.02, 0.4, 0.008]);
    }
  }
  part('spine', FIXED.lanyard, [0, 1.03, front + 0.008], [0.05, 0.28, 0.012]);
  part('spine', FIXED.badge, [0, 0.86, front + 0.012], [0.1, 0.13, 0.012]);

  // Head.
  part('head', skin, [0, 1.43, 0], [0.44, 0.42, 0.42]);
  for (const side of [1, -1])
    part('head', FIXED.eyes, [side * 0.1, 1.44, 0.212], [0.05, 0.07, 0.01]);
  buildHair(part, config.hair, hair);
  buildAccessory(part, config.accessory, top, shade);

  // Arms.
  for (const side of [1, -1]) {
    const arm = side === 1 ? 'armL' : 'armR';
    const forearm = side === 1 ? 'forearmL' : 'forearmR';
    part(arm, top, [side * 0.27, 1.01, 0], [0.12 * limb, 0.28, 0.13]);
    part(forearm, longSleeves ? top : skin, [side * 0.27, 0.76, 0], [0.11 * limb, 0.24, 0.12]);
    part(forearm, skin, [side * 0.27, 0.6, 0], [0.115, 0.1, 0.125]);
  }

  // Hips, legs and bottom.
  part('hips', bottom, [0, 0.69, 0], [0.36 * w, 0.14, 0.24 * d]);
  if (config.bottom === 2) part('hips', bottom, [0, 0.55, 0], [0.42 * w, 0.32, 0.3 * d]);
  for (const side of [1, -1]) {
    const leg = side === 1 ? 'legL' : 'legR';
    const shin = side === 1 ? 'shinL' : 'shinR';
    const x = side * 0.11;
    if (config.bottom === 0) {
      part(leg, bottom, [x, 0.55, 0], [0.17 * limb, 0.36, 0.2]);
      part(shin, bottom, [x, 0.24, 0], [0.16 * limb, 0.3, 0.19]);
    } else if (config.bottom === 1) {
      part(leg, bottom, [x, 0.6, 0], [0.175 * limb, 0.26, 0.205]);
      part(leg, skin, [x, 0.44, 0], [0.15 * limb, 0.14, 0.18]);
      part(shin, skin, [x, 0.24, 0], [0.14 * limb, 0.3, 0.17]);
    } else {
      part(leg, skin, [x, 0.5, 0], [0.14 * limb, 0.3, 0.17]);
      part(shin, skin, [x, 0.24, 0], [0.14 * limb, 0.3, 0.17]);
    }
    // Shoes.
    if (config.shoes === 1) {
      part(shin, shoes, [x, 0.052, 0.035], [0.16, 0.08, 0.27]);
      part(shin, FIXED.darkSole, [x, 0.012, 0.035], [0.165, 0.024, 0.275]);
    } else if (config.shoes === 2) {
      part(shin, shoes, [x, 0.115, 0.02], [0.18, 0.2, 0.27]);
      part(shin, FIXED.darkSole, [x, 0.012, 0.02], [0.185, 0.024, 0.275]);
    } else {
      part(shin, shoes, [x, 0.065, 0.03], [0.17, 0.09, 0.28]);
      part(shin, FIXED.sole, [x, 0.015, 0.03], [0.175, 0.03, 0.285]);
    }
  }

  const geometry = batch.toGeometry();
  const count = batch.vertexCount;
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    skinIndex[i * 4] = bones[i] as number;
    skinWeight[i * 4] = 1;
  }
  geometry.setAttribute('skinIndex', new BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(skinWeight, 4));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

type Part = (bone: BoneName, colour: string | Color, centre: Vec3, size: Vec3) => void;

/** The head is 0.44 × 0.42 × 0.42 m around (0, 1.43, 0). */
function buildHair(part: Part, style: number, colour: string): void {
  const cap = () => part('head', colour, [0, 1.61, -0.02], [0.47, 0.14, 0.46]);
  const back = (height = 0.32, y = 1.48) =>
    part('head', colour, [0, y, -0.2], [0.47, height, 0.08]);
  switch (style) {
    case 0: // none
      return;
    case 2: // buzz cut
      part('head', colour, [0, 1.615, -0.01], [0.455, 0.07, 0.44]);
      part('head', colour, [0, 1.5, -0.205], [0.455, 0.24, 0.04]);
      for (const side of [1, -1])
        part('head', colour, [side * 0.222, 1.52, -0.04], [0.02, 0.16, 0.3]);
      return;
    case 3: // side part
      cap();
      back();
      part('head', colour, [0.07, 1.585, 0.215], [0.3, 0.09, 0.05]);
      return;
    case 4: // long
      cap();
      back(0.62, 1.33);
      for (const side of [1, -1])
        part('head', colour, [side * 0.235, 1.42, -0.03], [0.035, 0.38, 0.36]);
      return;
    case 5: // bun
      cap();
      back();
      part('head', colour, [0, 1.72, -0.12], [0.17, 0.15, 0.17]);
      return;
    case 6: // ponytail
      cap();
      back();
      part('head', colour, [0, 1.5, -0.25], [0.08, 0.08, 0.06]);
      part('head', colour, [0, 1.36, -0.27], [0.1, 0.26, 0.08]);
      return;
    case 7: // bob
      cap();
      back(0.44, 1.42);
      for (const side of [1, -1])
        part('head', colour, [side * 0.235, 1.44, 0.02], [0.035, 0.36, 0.4]);
      part('head', colour, [0, 1.59, 0.215], [0.44, 0.08, 0.04]);
      return;
    case 8: // curly
      back();
      for (const sx of [1, -1])
        for (const sz of [1, -1])
          part('head', colour, [sx * 0.12, 1.66, sz * 0.1 - 0.02], [0.24, 0.16, 0.24]);
      part('head', colour, [0, 1.69, -0.02], [0.2, 0.12, 0.2]);
      return;
    default: // short
      cap();
      back();
  }
}

function buildAccessory(
  part: Part,
  accessory: number,
  colour: string,
  shade: (hex: string, factor: number) => Color,
): void {
  const temples = () => {
    for (const side of [1, -1])
      part('head', FIXED.frame, [side * 0.225, 1.47, 0.1], [0.012, 0.02, 0.22]);
    part('head', FIXED.frame, [0, 1.47, 0.218], [0.05, 0.02, 0.012]);
  };
  switch (accessory) {
    case 1: // glasses: frames around the eyes
      for (const side of [1, -1]) {
        const x = side * 0.1;
        part('head', FIXED.frame, [x, 1.485, 0.218], [0.13, 0.025, 0.012]);
        part('head', FIXED.frame, [x, 1.395, 0.218], [0.13, 0.02, 0.012]);
        part('head', FIXED.frame, [x + side * 0.065, 1.44, 0.218], [0.02, 0.09, 0.012]);
        part('head', FIXED.frame, [x - side * 0.065, 1.44, 0.218], [0.02, 0.09, 0.012]);
      }
      temples();
      return;
    case 2: // sunglasses
      for (const side of [1, -1])
        part('head', FIXED.lens, [side * 0.1, 1.445, 0.219], [0.14, 0.1, 0.012]);
      temples();
      return;
    case 3: // cap
      part('head', colour, [0, 1.665, -0.01], [0.49, 0.12, 0.48]);
      part('head', shade(colour, 0.85), [0, 1.625, 0.29], [0.42, 0.03, 0.18]);
      return;
    case 4: // beanie
      part('head', colour, [0, 1.675, -0.01], [0.49, 0.17, 0.48]);
      part('head', shade(colour, 0.8), [0, 1.6, -0.01], [0.5, 0.06, 0.49]);
      part('head', shade(colour, 0.8), [0, 1.77, -0.01], [0.09, 0.05, 0.09]);
      return;
    case 5: // headphones
      part('head', FIXED.frame, [0, 1.675, 0], [0.5, 0.04, 0.07]);
      for (const side of [1, -1]) {
        part('head', FIXED.frame, [side * 0.245, 1.6, 0], [0.03, 0.14, 0.06]);
        part('head', colour, [side * 0.25, 1.45, 0], [0.06, 0.16, 0.15]);
      }
      return;
  }
}

/** Avatars that look alike share one geometry; it is freed when the last one goes. */
const geometries = new Map<string, { geometry: BufferGeometry; users: number }>();

function acquireGeometry(key: string, config: AvatarConfig): BufferGeometry {
  let entry = geometries.get(key);
  if (!entry) {
    entry = { geometry: buildAvatarGeometry(config), users: 0 };
    geometries.set(key, entry);
  }
  entry.users++;
  return entry.geometry;
}

function releaseGeometry(key: string): void {
  const entry = geometries.get(key);
  if (!entry) return;
  entry.users--;
  if (entry.users > 0) return;
  entry.geometry.dispose();
  geometries.delete(key);
}

/** How many distinct avatar geometries are alive (for tests and the debug panel). */
export const liveAvatarGeometries = () => geometries.size;

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
  spreadL: number;
  spreadR: number;
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
  'spreadL',
  'spreadR',
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
  spreadL: 0,
  spreadR: 0,
  elbowL: 0,
  elbowR: 0,
  legL: 0,
  legR: 0,
  kneeL: 0,
  kneeR: 0,
});

/** The poses that get cross-faded. Walking and running are one continuous "move" pose. */
type Mode = 'idle' | 'move' | 'jump' | 'fall' | 'sit' | 'emote';
const MODES: Mode[] = ['idle', 'move', 'jump', 'fall', 'sit', 'emote'];

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export interface AvatarMotion {
  anim: AnimId;
  /** Horizontal speed in m/s; sets the pace and reach of the stride. */
  speed: number;
  /** EMOTES id played while `anim` is ANIM.emote. */
  emote?: number;
  /** Changes every time an emote starts, so the same emote twice restarts it. */
  emoteSeq?: number;
}

export class Avatar {
  /** Add this to the scene. Position it at the feet; rotate it about Y to face a direction. */
  readonly object = new Group();

  private readonly mesh: SkinnedMesh;
  /** Key of the shared geometry in use. */
  private key: string;
  private readonly shadow: Mesh;
  private readonly bones = {} as Record<BoneName, Bone>;
  private readonly weights: Record<Mode, number> = {
    idle: 1,
    move: 0,
    jump: 0,
    fall: 0,
    sit: 0,
    emote: 0,
  };
  private readonly poses: Record<Mode, Pose> = {
    idle: emptyPose(),
    move: emptyPose(),
    jump: emptyPose(),
    fall: emptyPose(),
    sit: emptyPose(),
    emote: emptyPose(),
  };
  private emoteKey = '';
  private emoteClock = 0;
  private readonly blended = emptyPose();
  private stride = 0;
  private clock = 0;
  private landing = 0;
  private wasAirborne = false;

  constructor(config: AvatarConfig = DEFAULT_AVATAR) {
    this.key = formatAvatar(config);
    this.mesh = new SkinnedMesh(acquireGeometry(this.key, config), bodyMaterial);
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
  }

  /** The avatar string currently shown. */
  get avatar(): string {
    return this.key;
  }

  /** Dresses the avatar differently; the skeleton and the animation carry on. */
  setAvatar(config: AvatarConfig): void {
    const key = formatAvatar(config);
    if (key === this.key) return;
    const previous = this.key;
    this.key = key;
    this.mesh.geometry = acquireGeometry(key, config);
    releaseGeometry(previous);
  }

  /** Triangles drawn for this avatar. */
  get triangles(): number {
    const index = this.mesh.geometry.getIndex();
    return (index ? index.count : this.mesh.geometry.getAttribute('position').count) / 3;
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
    const emoteKey = `${motion.emote ?? 0}:${motion.emoteSeq ?? 0}`;
    if (emoteKey !== this.emoteKey) {
      this.emoteKey = emoteKey;
      this.emoteClock = 0;
    }
    this.emoteClock += dt;
    const mode: Mode =
      motion.anim === ANIM.emote && motion.emote
        ? 'emote'
        : motion.anim === ANIM.sit
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
    this.poseEmote(this.poses.emote, motion.emote ?? 0);

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
    pose.spreadL = pose.spreadR = 0.07;
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
    pose.spreadL = pose.spreadR = 0.05;
    pose.elbowL = pose.elbowR = mix(0.25, 1.3, run);
  }

  private poseJump(pose: Pose): void {
    Object.assign(pose, emptyPose(), {
      lean: -0.05,
      armL: 2.3,
      armR: 2.3,
      spreadL: 0.2,
      spreadR: 0.2,
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
      spreadL: 1.1,
      spreadR: 1.1,
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
      spreadL: 0.05,
      spreadR: 0.05,
      elbowL: 0.9,
      elbowR: 0.9,
      legL: 1.5,
      legR: 1.5,
      kneeL: 1.5,
      kneeR: 1.5,
      headYaw: Math.sin(this.clock * 0.4) * 0.2,
    });
  }

  private poseEmote(pose: Pose, id: number): void {
    const t = this.emoteClock;
    Object.assign(pose, emptyPose());
    pose.spreadL = pose.spreadR = 0.07;
    pose.elbowL = pose.elbowR = 0.12;
    switch (EMOTE_BY_ID.get(id)) {
      case 'wave':
        pose.armR = 2.65;
        pose.spreadR = 0.2 + 0.3 * Math.sin(t * 11);
        pose.elbowR = 0.35 + 0.25 * Math.sin(t * 11 + 1);
        pose.headYaw = -0.15;
        break;
      case 'clap': {
        const beat = Math.abs(Math.sin(t * 8));
        pose.armL = pose.armR = 1.25;
        pose.spreadL = pose.spreadR = 0.05 + 0.32 * beat;
        pose.elbowL = pose.elbowR = 0.55;
        break;
      }
      case 'bow': {
        // Down quickly, hold, back up.
        const k = t < 0.45 ? t / 0.45 : t < 1.1 ? 1 : Math.max(0, 1 - (t - 1.1) / 0.5);
        pose.lean = 0.8 * k * k * (3 - 2 * k);
        pose.armL = pose.armR = -0.1 * k;
        break;
      }
      case 'cheer': {
        const bounce = Math.abs(Math.sin(t * 7));
        pose.armL = pose.armR = 2.85;
        pose.spreadL = pose.spreadR = 0.35;
        pose.hipsY = 0.05 * bounce;
        pose.kneeL = pose.kneeR = 0.25 * (1 - bounce);
        pose.legL = pose.legR = 0.1 * (1 - bounce);
        break;
      }
      case 'dance': {
        const beat = t * 6;
        pose.hipsY = -0.05 * Math.abs(Math.sin(beat));
        pose.twist = 0.35 * Math.sin(beat / 2);
        pose.armL = 1.2 + 0.9 * Math.sin(beat);
        pose.armR = 1.2 + 0.9 * Math.sin(beat + Math.PI);
        pose.spreadL = pose.spreadR = 0.4;
        pose.elbowL = pose.elbowR = 1;
        pose.kneeL = 0.5 * Math.max(0, Math.sin(beat));
        pose.kneeR = 0.5 * Math.max(0, -Math.sin(beat));
        pose.legL = pose.kneeL * 0.6;
        pose.legR = pose.kneeR * 0.6;
        pose.headYaw = 0.25 * Math.sin(beat / 2);
        break;
      }
      case 'think':
        pose.armR = 1.75;
        pose.elbowR = 2.3;
        pose.spreadR = 0.15;
        pose.armL = 0.55;
        pose.elbowL = 1.4;
        pose.headYaw = 0.2;
        pose.lean = -0.04;
        break;
      default:
        break;
    }
  }

  private apply(pose: Pose): void {
    const b = this.bones;
    // Landing: a short dip that eases out.
    const dip = this.landing * this.landing * 0.09;
    b.hips.position.y = JOINTS.hips.at[1] + pose.hipsY - dip;
    b.spine.rotation.set(pose.lean, pose.twist, 0);
    b.head.rotation.set(-pose.lean * 0.6, pose.headYaw - pose.twist * 0.7, 0);
    // Limbs hang along -Y: a negative rotation about X swings them forwards (+Z).
    b.armL.rotation.set(-pose.armL, 0, pose.spreadL);
    b.armR.rotation.set(-pose.armR, 0, -pose.spreadR);
    b.forearmL.rotation.x = -pose.elbowL;
    b.forearmR.rotation.x = -pose.elbowR;
    b.legL.rotation.x = -pose.legL - dip * 3;
    b.legR.rotation.x = -pose.legR - dip * 3;
    b.shinL.rotation.x = pose.kneeL + dip * 6;
    b.shinR.rotation.x = pose.kneeR + dip * 6;
  }

  dispose(): void {
    this.object.removeFromParent();
    // The geometry may still be drawn by others who look the same.
    releaseGeometry(this.key);
    this.mesh.skeleton.dispose();
  }
}
