import { VN_TIME_ZONE } from '@campus/shared';

/**
 * "Mission days" follow the Vietnamese calendar regardless of where the server runs
 * (docs/02-architecture.md §6). Vietnam has no daylight saving, so the offset is a constant.
 */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const vnDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: VN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar date in Vietnam for an instant, as `YYYY-MM-DD`. */
export function vnDateOf(instant: Date): string {
  return vnDateFormat.format(instant);
}

/** The UTC instants at which a Vietnamese calendar day starts and ends (end is exclusive). */
export function vnDayBounds(vnDate: string): { start: Date; end: Date } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(vnDate);
  if (!match) throw new RangeError(`Expected YYYY-MM-DD, got "${vnDate}"`);
  const [, year, month, day] = match;
  const utcMidnight = Date.UTC(Number(year), Number(month) - 1, Number(day));
  if (new Date(utcMidnight).toISOString().slice(0, 10) !== vnDate) {
    throw new RangeError(`"${vnDate}" is not a real calendar date`);
  }
  const start = utcMidnight - VN_OFFSET_MS;
  return { start: new Date(start), end: new Date(start + DAY_MS) };
}
