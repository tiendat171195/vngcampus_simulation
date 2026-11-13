/** Vietnam time helpers: missions are planned on the Vietnam calendar (docs/02 §6). */
const OFFSET = '+07:00';
const DAY = 86_400_000;

/** `YYYY-MM-DD` of an instant in Vietnam. */
export const vnDate = (instant: Date | string) =>
  new Date(new Date(instant).getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

/** `HH:mm` of an instant in Vietnam. */
export const vnClock = (instant: Date | string) =>
  new Date(new Date(instant).getTime() + 7 * 3_600_000).toISOString().slice(11, 16);

/** An instant from a Vietnam date and clock. */
export const fromVn = (date: string, clock: string, seconds = '00') =>
  new Date(`${date}T${clock}:${seconds}${OFFSET}`).toISOString();

export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

export const today = () => vnDate(new Date());

/** Monday-first weeks covering a month, as `YYYY-MM-DD` (other months' days included). */
export function monthGrid(month: string): string[] {
  const first = `${month}-01`;
  const weekday = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(first, -weekday);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export const isWeekend = (date: string) => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
};
