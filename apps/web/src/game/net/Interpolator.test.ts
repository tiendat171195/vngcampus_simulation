import { NET } from '@campus/shared';
import { describe, expect, it } from 'vitest';
import { ClockSync, Interpolator, type Sample } from './Interpolator';

const out = (): Sample => ({ x: 0, y: 0, z: 0, yaw: 0 });
const snap = (t: number, x: number, yaw = 0) => ({ t, x, y: 0, z: 0, yaw });

describe('Interpolator', () => {
  it('has nothing to show before the first snapshot', () => {
    expect(new Interpolator().sample(0, out())).toBe(false);
  });

  it('blends between the two snapshots around the requested time', () => {
    const buffer = new Interpolator();
    buffer.push(snap(100, 0));
    buffer.push(snap(200, 1));
    buffer.push(snap(300, 3));
    const result = out();
    buffer.sample(150, result);
    expect(result.x).toBeCloseTo(0.5);
    buffer.sample(250, result);
    expect(result.x).toBeCloseTo(2);
  });

  it('turns the short way round', () => {
    const buffer = new Interpolator();
    buffer.push(snap(0, 0, 3.0));
    buffer.push(snap(100, 0, -3.0));
    const result = out();
    buffer.sample(50, result);
    expect(Math.abs(Math.abs(result.yaw) - Math.PI)).toBeLessThan(0.01);
  });

  it('extrapolates briefly past the newest snapshot, then holds still', () => {
    const buffer = new Interpolator();
    buffer.push(snap(0, 0));
    buffer.push(snap(100, 1));
    const result = out();
    buffer.sample(150, result);
    expect(result.x).toBeCloseTo(1.5);
    buffer.sample(100 + NET.maxExtrapolationMs + 500, result);
    expect(result.x).toBeCloseTo(1 + NET.maxExtrapolationMs / 100);
  });

  it('snaps across a teleport instead of sliding', () => {
    const buffer = new Interpolator();
    buffer.push(snap(0, 0));
    buffer.push(snap(100, 50));
    const result = out();
    buffer.sample(10, result);
    expect(result.x).toBe(50);
  });

  it('ignores snapshots that arrive out of order and replaces same-time ones', () => {
    const buffer = new Interpolator();
    buffer.push(snap(100, 1));
    buffer.push(snap(50, 9));
    buffer.push(snap(100, 2));
    expect(buffer.size).toBe(1);
    expect(buffer.latest?.x).toBe(2);
  });

  it('keeps one snapshot before the pruning point', () => {
    const buffer = new Interpolator();
    for (let t = 0; t <= 1000; t += 100) buffer.push(snap(t, t / 100));
    buffer.prune(450);
    const result = out();
    buffer.sample(450, result);
    expect(result.x).toBeCloseTo(4.5);
  });
});

describe('ClockSync', () => {
  it('maps local time to room time, trusting the fastest round trip', () => {
    const clock = new ClockSync();
    // Room clock is 10 000 ms ahead of the local clock.
    clock.observe(0, 200, 10_100); // slow sample: estimate 10 000
    clock.observe(1000, 1040, 11_020); // fast sample: estimate 10 000
    expect(clock.serverNow(5000)).toBeCloseTo(15_000, -1);
    clock.observe(2000, 2600, 12_900); // very slow and skewed: ignored
    expect(clock.serverNow(5000)).toBeCloseTo(15_000, -1);
  });
});
