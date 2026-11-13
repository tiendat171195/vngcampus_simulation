import { NET } from '@campus/shared';

export interface Snapshot {
  /** Room clock, in milliseconds. */
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface Sample {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

const CAPACITY = 32;

const lerpAngle = (a: number, b: number, t: number) =>
  a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

/**
 * Buffer of a remote player's past positions, sampled a little in the past so there are always
 * two snapshots to blend between (docs/05-multiplayer.md §5).
 */
export class Interpolator {
  private readonly buffer: Snapshot[] = [];

  get size(): number {
    return this.buffer.length;
  }

  get latest(): Snapshot | undefined {
    return this.buffer[this.buffer.length - 1];
  }

  push(snapshot: Snapshot): void {
    const last = this.latest;
    if (last && snapshot.t < last.t) return;
    if (last && snapshot.t === last.t) {
      this.buffer[this.buffer.length - 1] = snapshot;
      return;
    }
    this.buffer.push(snapshot);
    if (this.buffer.length > CAPACITY) this.buffer.shift();
  }

  /** Where the player was at room time `t`. Returns false while nothing has been received. */
  sample(t: number, out: Sample): boolean {
    const buffer = this.buffer;
    const first = buffer[0];
    const last = buffer[buffer.length - 1];
    if (!first || !last) return false;

    if (t <= first.t || buffer.length === 1) {
      const only = t <= first.t ? first : last;
      out.x = only.x;
      out.y = only.y;
      out.z = only.z;
      out.yaw = only.yaw;
      return true;
    }

    if (t >= last.t) {
      // Ran out of data: carry on in the same direction for a moment, then hold still.
      const previous = buffer[buffer.length - 2] as Snapshot;
      const span = last.t - previous.t;
      const ahead = Math.min(t - last.t, NET.maxExtrapolationMs);
      const k =
        span > 0 && Math.hypot(last.x - previous.x, last.z - previous.z) < NET.teleportDistance
          ? ahead / span
          : 0;
      out.x = last.x + (last.x - previous.x) * k;
      out.y = last.y + (last.y - previous.y) * k;
      out.z = last.z + (last.z - previous.z) * k;
      out.yaw = last.yaw;
      return true;
    }

    let i = buffer.length - 2;
    while (i > 0 && (buffer[i] as Snapshot).t > t) i--;
    const a = buffer[i] as Snapshot;
    const b = buffer[i + 1] as Snapshot;
    // A jump too long to be walking (a correction, a respawn) snaps instead of sliding.
    if (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) > NET.teleportDistance) {
      out.x = b.x;
      out.y = b.y;
      out.z = b.z;
      out.yaw = b.yaw;
      return true;
    }
    const k = (t - a.t) / (b.t - a.t);
    out.x = a.x + (b.x - a.x) * k;
    out.y = a.y + (b.y - a.y) * k;
    out.z = a.z + (b.z - a.z) * k;
    out.yaw = lerpAngle(a.yaw, b.yaw, k);
    return true;
  }

  /** Drops everything older than `t`, keeping one snapshot before it for blending. */
  prune(t: number): void {
    while (this.buffer.length > 2 && (this.buffer[1] as Snapshot).t < t) this.buffer.shift();
  }
}

/**
 * Estimates the offset between this browser's clock and the room clock from ping round trips.
 * The sample with the shortest round trip is the most trustworthy, so it wins.
 */
export class ClockSync {
  private offset: number | null = null;
  private bestRtt = Number.POSITIVE_INFINITY;
  private age = 0;
  /** Last measured round trip, in milliseconds. */
  rtt = 0;

  get ready(): boolean {
    return this.offset !== null;
  }

  /** Feeds one pong: `sentAt` and `receivedAt` on the local clock, `serverTime` on the room clock. */
  observe(sentAt: number, receivedAt: number, serverTime: number): void {
    this.rtt = receivedAt - sentAt;
    this.age++;
    // Old best samples lose their weight so a drifting clock is followed.
    if (this.rtt <= this.bestRtt * 1.2 || this.age > 12 || this.offset === null) {
      this.bestRtt = Math.min(this.rtt, this.bestRtt * 1.2);
      this.age = 0;
      this.offset = serverTime + this.rtt / 2 - receivedAt;
    }
  }

  /** Seeds the clock from a state patch before any pong has arrived. */
  seed(localNow: number, serverTime: number): void {
    if (this.offset === null) this.offset = serverTime - localNow;
  }

  serverNow(localNow: number): number {
    return localNow + (this.offset ?? 0);
  }
}
