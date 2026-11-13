import { missionDefinitionSchema } from '@campus/shared';
import { exampleMission } from '@campus/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { bonusMultiplier, isWorkday, levelForXp, nextStreak, sumRewards } from './rewards';

const none = new Set<string>();

describe('rewards', () => {
  it('levels at 100, 300, 600 xp…', () => {
    expect([0, 99, 100, 299, 300, 600, 1000].map(levelForXp)).toEqual([1, 1, 2, 2, 3, 4, 5]);
  });

  it('adds points and xp, multiplied and rounded', () => {
    const rewards = missionDefinitionSchema.parse(exampleMission).rewards;
    expect(sumRewards(rewards)).toEqual({ points: 100, xp: 50 });
    expect(sumRewards(rewards, 1.5)).toEqual({ points: 150, xp: 75 });
  });

  it('applies golden hours on the Vietnam clock', () => {
    const mission = missionDefinitionSchema.parse(exampleMission);
    // 12:15 in Vietnam is 05:15 UTC.
    expect(bonusMultiplier(mission, new Date('2026-11-16T05:15:00Z'))).toBe(1.5);
    expect(bonusMultiplier(mission, new Date('2026-11-16T06:30:00Z'))).toBe(1);
  });
});

describe('streaks', () => {
  it('know workdays from weekends and holidays', () => {
    // 2026-11-16 is a Monday.
    expect(isWorkday('2026-11-16', none)).toBe(true);
    expect(isWorkday('2026-11-14', none)).toBe(false);
    expect(isWorkday('2026-11-16', new Set(['2026-11-16']))).toBe(false);
  });

  it('carry on over weekends, holidays and days without a mission', () => {
    const friday = { current: 4, lastDate: '2026-11-13' };
    // Saturday and Sunday had missions, but weekends never break a streak.
    expect(nextStreak(friday, '2026-11-16', ['2026-11-14', '2026-11-15'], none)).toBe(5);
    // Monday had no mission: Tuesday still continues.
    expect(nextStreak({ current: 5, lastDate: '2026-11-13' }, '2026-11-17', [], none)).toBe(6);
    // A holiday with a mission is not held against anyone.
    expect(nextStreak(friday, '2026-11-17', ['2026-11-16'], new Set(['2026-11-16']))).toBe(5);
  });

  it('break on a missed workday that had a mission, and start at one', () => {
    expect(
      nextStreak({ current: 4, lastDate: '2026-11-13' }, '2026-11-17', ['2026-11-16'], none),
    ).toBe(1);
    expect(nextStreak({ current: 0, lastDate: null }, '2026-11-17', [], none)).toBe(1);
    expect(nextStreak({ current: 3, lastDate: '2026-11-17' }, '2026-11-17', [], none)).toBe(3);
  });
});
