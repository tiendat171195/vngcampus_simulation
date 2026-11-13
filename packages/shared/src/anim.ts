/**
 * Animation states of an avatar. The numeric ids travel over the network (one byte), so they
 * must never be renumbered; add new states at the end.
 */
export const ANIM = {
  idle: 0,
  walk: 1,
  run: 2,
  jump: 3,
  fall: 4,
  sit: 5,
  emote: 6,
} as const;

export type AnimName = keyof typeof ANIM;
export type AnimId = (typeof ANIM)[AnimName];
