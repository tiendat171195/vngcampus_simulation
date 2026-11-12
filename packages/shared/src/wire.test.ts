import { describe, expect, it } from 'vitest';
import { decodePosition, decodeYaw, encodePosition, encodeYaw, POSITION_SCALE } from './wire';

describe('position encoding', () => {
  it('round-trips within half a step', () => {
    for (const metres of [0, 0.01, -0.02, 1.7, -117.3, 149.99, 512.123]) {
      const decoded = decodePosition(encodePosition(metres));
      expect(Math.abs(decoded - metres)).toBeLessThanOrEqual(0.5 / POSITION_SCALE);
    }
  });

  it('produces integers that fit in int16', () => {
    for (const metres of [-5000, -1024, 0, 1023.99, 5000]) {
      const encoded = encodePosition(metres);
      expect(Number.isInteger(encoded)).toBe(true);
      expect(encoded).toBeGreaterThanOrEqual(-32768);
      expect(encoded).toBeLessThanOrEqual(32767);
    }
  });

  it('clamps instead of wrapping when out of range', () => {
    expect(decodePosition(encodePosition(5000))).toBeCloseTo(32767 / POSITION_SCALE);
    expect(decodePosition(encodePosition(-5000))).toBe(-1024);
  });
});

describe('yaw encoding', () => {
  it('round-trips within half a step', () => {
    const step = (Math.PI * 2) / 256;
    for (const radians of [0, 0.1, Math.PI / 2, Math.PI, 5.5]) {
      expect(Math.abs(decodeYaw(encodeYaw(radians)) - radians)).toBeLessThanOrEqual(step / 2);
    }
  });

  it('normalises negative and multi-turn angles into one byte', () => {
    expect(encodeYaw(-Math.PI / 2)).toBe(192);
    expect(encodeYaw(Math.PI * 2)).toBe(0);
    expect(encodeYaw(Math.PI * 2 - 0.001)).toBe(0);
    expect(encodeYaw(Math.PI * 5)).toBe(128);
  });
});
