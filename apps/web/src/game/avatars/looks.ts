import type { AvatarLook } from './Avatar';

const SKINS = ['#f6d5b8', '#f1c7a0', '#d9a57c', '#b97f57', '#8d5a3b'];
const HAIR = ['#1f1a17', '#3a2a22', '#5b3a24', '#a0602c', '#c9c2b8', '#20325a'];
const TOPS = [
  '#3d7fd9',
  '#f28c28',
  '#3fa66b',
  '#e5484d',
  '#7a5cd6',
  '#f2f2f2',
  '#2f3338',
  '#ffd23f',
];
const BOTTOMS = ['#2f3a4a', '#1f2228', '#5c6b7a', '#c8b48f', '#3b4f3a'];
const SHOES = ['#f4f4f4', '#1f2228', '#c94f3d', '#3d6fd9'];

const pickWith = <T>(items: readonly T[], value: number) => items[value % items.length] as T;

/** A look derived from a string, so a person looks the same to everyone until avatars exist (P3.3). */
export function lookFromSeed(seed: string): AvatarLook {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const next = () => {
    hash = Math.imul(hash ^ (hash >>> 15), 2246822507) >>> 0;
    return hash;
  };
  return {
    skin: pickWith(SKINS, next()),
    hair: pickWith(HAIR, next()),
    top: pickWith(TOPS, next()),
    bottom: pickWith(BOTTOMS, next()),
    shoes: pickWith(SHOES, next()),
  };
}

export function randomLook(): AvatarLook {
  return lookFromSeed(String(Math.random()));
}
