// No zod here: the avatar code is read by the browser, the API and the realtime server alike,
// and the splash screen must not pull a schema library in.

/**
 * An avatar is a handful of small numbers: a build, a skin tone, and a style and a colour for
 * each part (docs/03-world-and-assets.md §7). It travels as a short string such as
 * `v1.b1.s2.h3-5.t1-c.p0-4.f0-1.a2`: one base-36 digit per number, at most 32 bytes.
 */
export interface AvatarConfig {
  body: number;
  skin: number;
  hair: number;
  hairColour: number;
  top: number;
  topColour: number;
  bottom: number;
  bottomColour: number;
  shoes: number;
  shoesColour: number;
  accessory: number;
}

export const SKIN_TONES = [
  '#f6d5b8',
  '#f1c7a0',
  '#e3b48c',
  '#d9a57c',
  '#c18a63',
  '#a86f4a',
  '#8d5a3b',
  '#6b4129',
] as const;

export const HAIR_COLOURS = [
  '#1f1a17',
  '#3a2a22',
  '#5b3a24',
  '#7a4a2a',
  '#a0602c',
  '#c99a5b',
  '#c9c2b8',
  '#20325a',
  '#8a2f3a',
  '#e7c9a0',
] as const;

export const CLOTH_COLOURS = [
  '#3d7fd9',
  '#f28c28',
  '#3fa66b',
  '#e5484d',
  '#7a5cd6',
  '#f2f2f2',
  '#2f3338',
  '#ffd23f',
  '#2f3a4a',
  '#1f2228',
  '#5c6b7a',
  '#c8b48f',
  '#3b4f3a',
  '#e98bb0',
  '#5bc0be',
  '#8b5e3c',
] as const;

/** Choices for each part, in the order of their numbers; the labels are shown in the editor. */
export const AVATAR_STYLES = {
  body: ['Thon', 'Vừa', 'Đậm'],
  hair: ['Không tóc', 'Ngắn', 'Húi cua', 'Rẽ ngôi', 'Dài', 'Búi', 'Đuôi ngựa', 'Bob', 'Xoăn'],
  top: ['Áo thun', 'Sơ mi', 'Hoodie', 'Áo khoác'],
  bottom: ['Quần dài', 'Quần short', 'Váy'],
  shoes: ['Giày thể thao', 'Giày da', 'Bốt'],
  accessory: ['Không', 'Kính', 'Kính râm', 'Mũ lưỡi trai', 'Mũ len', 'Tai nghe'],
} as const;

/** How many values each field can take. */
const LIMITS: Record<keyof AvatarConfig, number> = {
  body: AVATAR_STYLES.body.length,
  skin: SKIN_TONES.length,
  hair: AVATAR_STYLES.hair.length,
  hairColour: HAIR_COLOURS.length,
  top: AVATAR_STYLES.top.length,
  topColour: CLOTH_COLOURS.length,
  bottom: AVATAR_STYLES.bottom.length,
  bottomColour: CLOTH_COLOURS.length,
  shoes: AVATAR_STYLES.shoes.length,
  shoesColour: CLOTH_COLOURS.length,
  accessory: AVATAR_STYLES.accessory.length,
};

export const AVATAR_FIELDS = Object.keys(LIMITS) as (keyof AvatarConfig)[];

/** How many values `field` can take. */
export const avatarChoices = (field: keyof AvatarConfig) => LIMITS[field];

export const DEFAULT_AVATAR: AvatarConfig = {
  body: 1,
  skin: 1,
  hair: 1,
  hairColour: 1,
  top: 0,
  topColour: 0,
  bottom: 0,
  bottomColour: 8,
  shoes: 0,
  shoesColour: 5,
  accessory: 0,
};

/** Longest a stored avatar string may be. */
export const AVATAR_MAX_LENGTH = 32;

const digit = (value: number) => value.toString(36);
const PATTERN =
  /^v1\.b([0-9a-z])\.s([0-9a-z])\.h([0-9a-z])-([0-9a-z])\.t([0-9a-z])-([0-9a-z])\.p([0-9a-z])-([0-9a-z])\.f([0-9a-z])-([0-9a-z])\.a([0-9a-z])$/;

export function formatAvatar(config: AvatarConfig): string {
  const c = config;
  return `v1.b${digit(c.body)}.s${digit(c.skin)}.h${digit(c.hair)}-${digit(c.hairColour)}.t${digit(c.top)}-${digit(c.topColour)}.p${digit(c.bottom)}-${digit(c.bottomColour)}.f${digit(c.shoes)}-${digit(c.shoesColour)}.a${digit(c.accessory)}`;
}

/** The avatar a string describes, or null when it is not a valid avatar string. */
export function parseAvatar(value: string): AvatarConfig | null {
  const match = PATTERN.exec(value);
  if (!match) return null;
  const config = {} as AvatarConfig;
  for (const [i, field] of AVATAR_FIELDS.entries()) {
    const n = Number.parseInt(match[i + 1] as string, 36);
    if (n >= LIMITS[field]) return null;
    config[field] = n;
  }
  return config;
}

export const isAvatar = (value: string) => parseAvatar(value) !== null;

/**
 * A stable avatar picked from a string (a user id), for people who have not made one yet: they
 * look the same to everyone and on every visit.
 */
export function avatarFromSeed(seed: string): AvatarConfig {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const next = (limit: number) => {
    hash = Math.imul(hash ^ (hash >>> 15), 2246822507) >>> 0;
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909) >>> 0;
    return (hash >>> 0) % limit;
  };
  const config = {} as AvatarConfig;
  for (const field of AVATAR_FIELDS) config[field] = next(LIMITS[field]);
  // Accessories and bare heads are the exception, not the rule.
  if (next(3) > 0) config.accessory = 0;
  if (config.hair === 0 && next(2) > 0) config.hair = 1;
  return config;
}

/** The avatar to show for a stored string: the string's own, or one derived from the user id. */
export function avatarFor(stored: string, userId: string): AvatarConfig {
  return parseAvatar(stored) ?? avatarFromSeed(userId);
}
