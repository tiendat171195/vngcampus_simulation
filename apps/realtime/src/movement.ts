import { MOVEMENT } from '@campus/shared';

/** Last position the server accepted for a player, in metres, and when (ms). */
export interface Accepted {
  x: number;
  y: number;
  z: number;
  at: number;
}

export interface WorldLimits {
  min: readonly [number, number];
  max: readonly [number, number];
  minY: number;
  maxY: number;
}

export type MoveVerdict = { ok: true } | { ok: false; reason: 'speed' | 'bounds' };

/** Fastest a body can fall (see CharacterMotor), with the same headroom as horizontal speed. */
const MAX_VERTICAL_SPEED = 18;
const SLACK = 1.5;
const GRACE_METRES = 0.5;
/** A long silence must not buy a long jump: time beyond this does not add allowance. */
const MAX_INTERVAL_MS = 1000;

/**
 * Whether a reported position is plausible after the last accepted one (docs/05-multiplayer.md
 * §5): within the world, and no faster than running allows, measured on the server's clock.
 */
export function checkMove(
  previous: Accepted,
  next: { x: number; y: number; z: number },
  now: number,
  limits: WorldLimits,
): MoveVerdict {
  if (
    !Number.isFinite(next.x) ||
    !Number.isFinite(next.y) ||
    !Number.isFinite(next.z) ||
    next.x < limits.min[0] ||
    next.x > limits.max[0] ||
    next.z < limits.min[1] ||
    next.z > limits.max[1] ||
    next.y < limits.minY ||
    next.y > limits.maxY
  ) {
    return { ok: false, reason: 'bounds' };
  }
  const seconds = Math.min(MAX_INTERVAL_MS, Math.max(0, now - previous.at)) / 1000;
  const horizontal = Math.hypot(next.x - previous.x, next.z - previous.z);
  const vertical = Math.abs(next.y - previous.y);
  if (horizontal > MOVEMENT.runSpeed * seconds * SLACK + GRACE_METRES)
    return { ok: false, reason: 'speed' };
  if (vertical > MAX_VERTICAL_SPEED * seconds * SLACK + GRACE_METRES)
    return { ok: false, reason: 'speed' };
  return { ok: true };
}

/** Token bucket: `rate` messages per second on average, bursts up to `rate`. */
export class RateLimiter {
  private tokens: number;
  private last: number;
  private readonly rate: number;

  constructor(rate: number, now: number) {
    this.rate = rate;
    this.tokens = rate;
    this.last = now;
  }

  take(now: number): boolean {
    this.tokens = Math.min(this.rate, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** Counts events in a sliding window, for flagging repeated violations. */
export class WindowCounter {
  private readonly times: number[] = [];
  private readonly windowMs: number;

  constructor(windowMs: number) {
    this.windowMs = windowMs;
  }

  add(now: number): number {
    this.times.push(now);
    while (this.times.length > 0 && (this.times[0] as number) < now - this.windowMs)
      this.times.shift();
    return this.times.length;
  }
}
