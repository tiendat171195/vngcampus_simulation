import { describe, expect, it } from 'vitest';
import {
  AVATAR_FIELDS,
  AVATAR_MAX_LENGTH,
  type AvatarConfig,
  avatarChoices,
  avatarFor,
  avatarFromSeed,
  DEFAULT_AVATAR,
  formatAvatar,
  parseAvatar,
} from './avatar';

const largest = Object.fromEntries(
  AVATAR_FIELDS.map((field) => [field, avatarChoices(field) - 1]),
) as unknown as AvatarConfig;

describe('avatar strings', () => {
  it('round-trip, and stay within 32 bytes even with every value at its largest', () => {
    for (const config of [DEFAULT_AVATAR, largest, avatarFromSeed('x')]) {
      const text = formatAvatar(config);
      // ASCII only, so characters are bytes.
      expect(text).toMatch(/^[\x20-\x7e]+$/);
      expect(text.length).toBeLessThanOrEqual(AVATAR_MAX_LENGTH);
      expect(parseAvatar(text)).toEqual(config);
    }
    expect(formatAvatar(DEFAULT_AVATAR)).toBe('v1.b1.s1.h1-1.t0-0.p0-8.f0-5.a0');
  });

  it('rejects anything else, including values outside the choices', () => {
    for (const bad of [
      '',
      'v2.b1.s1.h1-1.t0-0.p0-8.f0-5.a0',
      'v1.b1.s1.h1-1.t0-0.p0-8.f0-5',
      'v1.b1.s1.h1-1.t0-0.p0-8.f0-5.a0 ',
      'v1.b9.s1.h1-1.t0-0.p0-8.f0-5.a0',
      'v1.b1.s1.h1-1.t0-g.p0-8.f0-5.a0',
      '<script>',
    ])
      expect(parseAvatar(bad), bad).toBeNull();
  });

  it('derives the same avatar from the same seed, and varied ones from different seeds', () => {
    expect(avatarFromSeed('user-1')).toEqual(avatarFromSeed('user-1'));
    const looks = new Set(
      Array.from({ length: 50 }, (_, i) => formatAvatar(avatarFromSeed(`u${i}`))),
    );
    expect(looks.size).toBeGreaterThan(45);
    for (let i = 0; i < 200; i++)
      expect(parseAvatar(formatAvatar(avatarFromSeed(`s${i}`)))).not.toBeNull();
  });

  it('falls back to the seeded avatar when nothing valid is stored', () => {
    expect(avatarFor('', 'abc')).toEqual(avatarFromSeed('abc'));
    expect(avatarFor(formatAvatar(largest), 'abc')).toEqual(largest);
  });
});
