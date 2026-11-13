import { MOVEMENT } from '@campus/shared';
import { Box3, DoubleSide, Line3, Ray, Vector3 } from 'three';
import type { MeshBVH } from 'three-mesh-bvh';

/** What the player (or a bot) wants to do this step. */
export interface MoveIntent {
  /** Desired horizontal direction in world space. Length 0..1; longer vectors are clamped. */
  x: number;
  z: number;
  run: boolean;
  /** True on the step the jump was requested. */
  jump: boolean;
}

/** Ledges and steps up to this height are walked over without jumping. */
const STEP_HEIGHT = 0.35;
/** How far below the feet ground may be and still be "walked down" instead of fallen onto. */
const SNAP_DOWN = 0.35;
const MAX_SLOPE_COS = Math.cos((MOVEMENT.maxSlopeDeg * Math.PI) / 180);
const JUMP_SPEED = Math.sqrt(2 * -MOVEMENT.gravity * MOVEMENT.jumpHeight);
/** Keeps one step of falling shorter than the ground probe, so floors are never skipped. */
const MAX_FALL_SPEED = 18;
const GROUND_ACCELERATION = 40;
const AIR_ACCELERATION = 10;
/** Anything that falls this low has left the world and is put back. */
const KILL_PLANE = -10;

const DOWN = new Vector3(0, -1, 0);

/**
 * Moves a capsule-shaped character through the static world.
 *
 * Height comes from a ray cast under the feet, which is what makes stairs (ramps in the collision
 * mesh) and small ledges smooth and keeps the character from creeping down slopes. Walls are
 * handled by pushing a capsule, lifted by the step height, out of anything it overlaps.
 *
 * No rendering or input code here: the same class drives tests and, later, bots.
 */
export class CharacterMotor {
  /** Position of the feet. */
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  grounded = false;

  private readonly bvh: MeshBVH;
  private readonly safePosition = new Vector3();
  private readonly ray = new Ray();
  private readonly segment = new Line3();
  private readonly box = new Box3();
  private readonly trianglePoint = new Vector3();
  private readonly capsulePoint = new Vector3();
  private readonly push = new Vector3();

  constructor(bvh: MeshBVH) {
    this.bvh = bvh;
  }

  /** Horizontal speed in metres per second. */
  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  teleport(x: number, y: number, z: number): void {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.safePosition.copy(this.position);
    this.grounded = this.probeGround(SNAP_DOWN) !== null;
  }

  /** Advances the simulation by `dt` seconds. Call with a fixed step (1/60 s). */
  step(dt: number, intent: MoveIntent): void {
    const { position, velocity } = this;

    // Horizontal velocity eases towards what the intent asks for.
    const magnitude = Math.hypot(intent.x, intent.z);
    const scale = magnitude > 1 ? 1 / magnitude : 1;
    const targetSpeed = intent.run ? MOVEMENT.runSpeed : MOVEMENT.walkSpeed;
    const dvx = intent.x * scale * targetSpeed - velocity.x;
    const dvz = intent.z * scale * targetSpeed - velocity.z;
    const change = Math.hypot(dvx, dvz);
    const maxChange = (this.grounded ? GROUND_ACCELERATION : AIR_ACCELERATION) * dt;
    const ratio = change > maxChange ? maxChange / change : 1;
    velocity.x += dvx * ratio;
    velocity.z += dvz * ratio;

    if (this.grounded && intent.jump) {
      velocity.y = JUMP_SPEED;
      this.grounded = false;
    }

    position.x += velocity.x * dt;
    position.z += velocity.z * dt;

    if (this.grounded) {
      velocity.y = 0;
      const ground = this.probeGround(SNAP_DOWN);
      if (ground === null) this.grounded = false;
      else position.y = ground;
    } else {
      velocity.y = Math.max(-MAX_FALL_SPEED, velocity.y + MOVEMENT.gravity * dt);
      position.y += velocity.y * dt;
      if (velocity.y <= 0) {
        const ground = this.probeGround(0.02);
        if (ground !== null) {
          position.y = ground;
          velocity.y = 0;
          this.grounded = true;
        }
      }
    }

    this.pushOutOfWalls();

    if (this.grounded) {
      this.safePosition.copy(position);
    } else if (position.y < KILL_PLANE) {
      this.teleport(this.safePosition.x, this.safePosition.y + 0.1, this.safePosition.z);
    }
  }

  /**
   * Height of walkable ground under the feet, looking from one step-height above them down to
   * `below` metres under them. Null if there is none or it is too steep to stand on.
   */
  private probeGround(below: number): number | null {
    this.ray.origin.set(this.position.x, this.position.y + STEP_HEIGHT, this.position.z);
    this.ray.direction.copy(DOWN);
    const hit = this.bvh.raycastFirst(this.ray, DoubleSide, 0, STEP_HEIGHT + below);
    if (!hit?.face) return null;
    return Math.abs(hit.face.normal.y) >= MAX_SLOPE_COS ? hit.point.y : null;
  }

  /** Pushes the body out of walls, rails and ceilings it has moved into. */
  private pushOutOfWalls(): void {
    const { position, velocity, segment, box } = this;
    const radius = MOVEMENT.capsuleRadius;

    for (let pass = 0; pass < 3; pass++) {
      // The capsule starts one step-height up, so curbs and stair treads do not block it.
      segment.start.set(position.x, position.y + STEP_HEIGHT + radius, position.z);
      segment.end.set(position.x, position.y + MOVEMENT.capsuleHeight - radius, position.z);
      box.makeEmpty();
      box.expandByPoint(segment.start);
      box.expandByPoint(segment.end);
      box.min.addScalar(-radius);
      box.max.addScalar(radius);

      const startX = segment.start.x;
      const startY = segment.start.y;
      const startZ = segment.start.z;

      this.bvh.shapecast({
        intersectsBounds: (bounds) => bounds.intersectsBox(box),
        intersectsTriangle: (triangle) => {
          const distance = triangle.closestPointToSegment(
            segment,
            this.trianglePoint,
            this.capsulePoint,
          );
          if (distance < radius) {
            const direction = this.capsulePoint.sub(this.trianglePoint).normalize();
            segment.start.addScaledVector(direction, radius - distance);
            segment.end.addScaledVector(direction, radius - distance);
          }
          return false;
        },
      });

      this.push.set(segment.start.x - startX, segment.start.y - startY, segment.start.z - startZ);
      if (this.push.lengthSq() < 1e-10) return;

      position.x += this.push.x;
      position.z += this.push.z;
      if (!this.grounded) {
        position.y += this.push.y;
        // Bumped the head on a ceiling while rising.
        if (this.push.y < -1e-4 && velocity.y > 0) velocity.y = 0;
      }

      // Remove the part of the velocity that points into the obstacle, so the body slides along it.
      const horizontal = Math.hypot(this.push.x, this.push.z);
      if (horizontal > 1e-6) {
        const nx = this.push.x / horizontal;
        const nz = this.push.z / horizontal;
        const into = velocity.x * nx + velocity.z * nz;
        if (into < 0) {
          velocity.x -= into * nx;
          velocity.z -= into * nz;
        }
      }
    }
  }
}
