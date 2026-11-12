/**
 * Fixed-point encoding for transforms sent over the network.
 * Positions travel as int16 in 1/32 m steps (±1023 m, ~3 cm resolution); yaw as one byte.
 */

export const POSITION_SCALE = 32;
export const YAW_STEPS = 256;

const INT16_MIN = -32768;
const INT16_MAX = 32767;
const TAU = Math.PI * 2;

/** Metres → int16. Values outside the representable range are clamped. */
export function encodePosition(metres: number): number {
  const scaled = Math.round(metres * POSITION_SCALE);
  return Math.min(INT16_MAX, Math.max(INT16_MIN, scaled));
}

export function decodePosition(encoded: number): number {
  return encoded / POSITION_SCALE;
}

/** Radians (any range) → 0..255. */
export function encodeYaw(radians: number): number {
  const turns = (((radians % TAU) + TAU) % TAU) / TAU;
  return Math.round(turns * YAW_STEPS) % YAW_STEPS;
}

/** 0..255 → radians in [0, 2π). */
export function decodeYaw(encoded: number): number {
  return (encoded / YAW_STEPS) * TAU;
}
