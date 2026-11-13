import { MOVEMENT } from '@campus/shared';
import { describe, expect, it } from 'vitest';
import { checkMove, RateLimiter, WindowCounter, type WorldLimits } from './movement';

const LIMITS: WorldLimits = { min: [-200, -90], max: [150, 110], minY: -2, maxY: 16 };
const start = { x: 0, y: 0, z: -50, at: 1000 };

describe('checkMove', () => {
  it('accepts a full-speed run, with headroom for jitter', () => {
    const distance = MOVEMENT.runSpeed * 0.1;
    expect(checkMove(start, { x: distance, y: 0, z: -50 }, 1100, LIMITS)).toEqual({ ok: true });
    // A packet that arrives late carries more distance than its interval suggests.
    expect(checkMove(start, { x: distance * 2, y: 0, z: -50 }, 1100, LIMITS)).toEqual({ ok: true });
  });

  it('rejects moving faster than running allows', () => {
    expect(checkMove(start, { x: 5, y: 0, z: -50 }, 1100, LIMITS)).toEqual({
      ok: false,
      reason: 'speed',
    });
  });

  it('does not let a long pause pay for a teleport', () => {
    expect(checkMove(start, { x: 30, y: 0, z: -50 }, 60_000, LIMITS)).toEqual({
      ok: false,
      reason: 'speed',
    });
    expect(checkMove(start, { x: 8, y: 0, z: -50 }, 60_000, LIMITS)).toEqual({ ok: true });
  });

  it('allows falling and climbing stairs but not flying up', () => {
    expect(checkMove(start, { x: 0, y: -1.5, z: -50 }, 1100, LIMITS)).toEqual({ ok: true });
    expect(checkMove(start, { x: 0, y: 6, z: -50 }, 1100, LIMITS)).toEqual({
      ok: false,
      reason: 'speed',
    });
  });

  it('rejects anything outside the world', () => {
    expect(checkMove(start, { x: 0, y: 0, z: -91 }, 1100, LIMITS)).toEqual({
      ok: false,
      reason: 'bounds',
    });
    expect(checkMove(start, { x: 0, y: 20, z: -50 }, 5000, LIMITS)).toEqual({
      ok: false,
      reason: 'bounds',
    });
    expect(checkMove(start, { x: Number.NaN, y: 0, z: -50 }, 1100, LIMITS)).toEqual({
      ok: false,
      reason: 'bounds',
    });
  });
});

describe('RateLimiter', () => {
  it('allows a burst, then the sustained rate', () => {
    const limiter = new RateLimiter(15, 0);
    let accepted = 0;
    for (let i = 0; i < 40; i++) if (limiter.take(0)) accepted++;
    expect(accepted).toBe(15);
    let later = 0;
    for (let t = 0; t < 2000; t += 10) if (limiter.take(t)) later++;
    expect(later).toBeGreaterThanOrEqual(29);
    expect(later).toBeLessThanOrEqual(31);
  });
});

describe('RateLimiter with a slow rate', () => {
  it('still lets the first message through and then one per period', () => {
    const limiter = new RateLimiter(0.5, 0);
    expect(limiter.take(0)).toBe(true);
    expect(limiter.take(100)).toBe(false);
    expect(limiter.take(2100)).toBe(true);
  });
});

describe('WindowCounter', () => {
  it('forgets events older than the window', () => {
    const counter = new WindowCounter(10_000);
    for (let t = 0; t < 5; t++) counter.add(t * 1000);
    expect(counter.add(5000)).toBe(6);
    expect(counter.add(30_000)).toBe(1);
  });
});
