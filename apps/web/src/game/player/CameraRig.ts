import { DoubleSide, type PerspectiveCamera, Ray, Vector3 } from 'three';
import type { MeshBVH } from 'three-mesh-bvh';

const MIN_DISTANCE = 2;
const MAX_DISTANCE = 8;
const MIN_PITCH = -0.17;
const MAX_PITCH = 1.22;
/** Height above the feet that the camera looks at. */
const FOCUS_HEIGHT = 1.45;
/** Gap kept between the camera and whatever is behind it. */
const WALL_MARGIN = 0.3;
const LOOK_SENSITIVITY = 0.0055;

/**
 * Third-person camera on a spring arm: it orbits a point above the character's feet and is pulled
 * in when a wall, floor or rail gets between the two.
 */
export class CameraRig {
  /** Direction the camera looks, as a yaw in radians: 0 looks towards +Z. */
  heading = 0;
  /** Angle above the horizon; positive puts the camera above the character. */
  pitch = 0.32;
  /** Distance the player asked for. */
  distance = 5;
  /** Distance currently used, after any wall has pulled the camera in. */
  armLength = 5;

  private readonly focus = new Vector3();
  private readonly direction = new Vector3();
  private readonly ray = new Ray();
  private settled = false;

  /** Applies a drag (in pixels) and a zoom request. */
  look(dx: number, dy: number, zoom: number): void {
    this.heading -= dx * LOOK_SENSITIVITY;
    this.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, this.pitch + dy * LOOK_SENSITIVITY));
    this.distance = Math.min(
      MAX_DISTANCE,
      Math.max(MIN_DISTANCE, this.distance * (1 + zoom * 0.001)),
    );
  }

  /** Forgets smoothing, so the next update jumps straight to its target (after a teleport). */
  snap(): void {
    this.settled = false;
  }

  update(dt: number, camera: PerspectiveCamera, feet: Vector3, bvh: MeshBVH): void {
    const targetX = feet.x;
    const targetY = feet.y + FOCUS_HEIGHT;
    const targetZ = feet.z;
    if (!this.settled || this.focus.distanceToSquared(feet) > 36) {
      this.focus.set(targetX, targetY, targetZ);
      this.armLength = this.distance;
      this.settled = true;
    } else {
      // Horizontal motion is followed exactly; height is eased so stairs do not shake the view.
      this.focus.x = targetX;
      this.focus.z = targetZ;
      this.focus.y += (targetY - this.focus.y) * (1 - Math.exp(-dt * 12));
    }

    const cosPitch = Math.cos(this.pitch);
    this.direction.set(
      -Math.sin(this.heading) * cosPitch,
      Math.sin(this.pitch),
      -Math.cos(this.heading) * cosPitch,
    );

    this.ray.origin.copy(this.focus);
    this.ray.direction.copy(this.direction);
    const hit = bvh.raycastFirst(this.ray, DoubleSide, 0, this.distance + WALL_MARGIN);
    const allowed = hit ? Math.max(0.5, hit.distance - WALL_MARGIN) : this.distance;
    // Pull in at once so the camera never shows the inside of a wall; ease back out.
    if (allowed < this.armLength) this.armLength = allowed;
    else this.armLength += (allowed - this.armLength) * (1 - Math.exp(-dt * 5));

    camera.position.copy(this.focus).addScaledVector(this.direction, this.armLength);
    camera.lookAt(this.focus);

    const fov = camera.aspect < 1 ? 70 : 60;
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }
}
