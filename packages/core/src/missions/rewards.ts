import type { MissionDefinition, Reward } from '@campus/shared';

/** Extra points for streak milestones (docs/06 §7). */
export const STREAK_BONUS: Readonly<Record<number, number>> = { 3: 20, 7: 50, 14: 100, 30: 200 };

/** Levels are for show: level n needs 50·n·(n−1) xp (100, 300, 600, 1000…). */
export function levelForXp(xp: number): number {
  let level = 1;
  while (50 * (level + 1) * level <= xp) level++;
  return level;
}

/** Points and xp of a reward list, times a multiplier (golden hours), rounded. */
export function sumRewards(rewards: readonly Reward[], multiplier = 1) {
  let points = 0;
  let xp = 0;
  for (const reward of rewards) {
    if (reward.type === 'points') points += reward.amount;
    if (reward.type === 'xp') xp += reward.amount;
  }
  return { points: Math.round(points * multiplier), xp: Math.round(xp * multiplier) };
}

const vnClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** The golden-hour multiplier at an instant: the largest window it falls in, else 1. */
export function bonusMultiplier(mission: MissionDefinition, at: Date): number {
  const clock = vnClock.format(at);
  let multiplier = 1;
  for (const window of mission.bonusWindows ?? [])
    if (clock >= window.from && clock < window.to)
      multiplier = Math.max(multiplier, window.multiplier);
  return multiplier;
}

/** Monday to Friday, and not a listed holiday. Dates are Vietnam calendar days, `YYYY-MM-DD`. */
export function isWorkday(date: string, holidays: ReadonlySet<string>): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6 && !holidays.has(date);
}

/**
 * The streak after completing today's daily mission (docs/06 §7). It only breaks on a workday
 * that had a daily mission and was missed: weekends, holidays and days without a mission do not
 * count against anyone.
 *
 * @param missionDays days strictly between the last completion and today that had a published
 *   daily mission.
 */
export function nextStreak(
  previous: { current: number; lastDate: string | null },
  today: string,
  missionDays: readonly string[],
  holidays: ReadonlySet<string>,
): number {
  if (previous.lastDate === today) return previous.current;
  if (previous.lastDate === null || previous.lastDate > today) return 1;
  const missed = missionDays.some(
    (day) => day > (previous.lastDate as string) && day < today && isWorkday(day, holidays),
  );
  return missed ? 1 : previous.current + 1;
}
