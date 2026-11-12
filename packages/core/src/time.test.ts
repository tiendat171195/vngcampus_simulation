import { describe, expect, it } from 'vitest';
import { vnDateOf, vnDayBounds } from './time';

describe('vnDateOf', () => {
  it('rolls over at 17:00 UTC, which is midnight in Vietnam', () => {
    expect(vnDateOf(new Date('2026-11-15T16:59:59Z'))).toBe('2026-11-15');
    expect(vnDateOf(new Date('2026-11-15T17:00:00Z'))).toBe('2026-11-16');
  });

  it('handles year boundaries', () => {
    expect(vnDateOf(new Date('2026-12-31T17:30:00Z'))).toBe('2027-01-01');
  });
});

describe('vnDayBounds', () => {
  it('returns the UTC instants of a Vietnamese calendar day', () => {
    const { start, end } = vnDayBounds('2026-11-16');
    expect(start.toISOString()).toBe('2026-11-15T17:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-16T17:00:00.000Z');
  });

  it('agrees with vnDateOf at both edges', () => {
    const { start, end } = vnDayBounds('2026-02-28');
    expect(vnDateOf(start)).toBe('2026-02-28');
    expect(vnDateOf(new Date(end.getTime() - 1))).toBe('2026-02-28');
    expect(vnDateOf(end)).toBe('2026-03-01');
  });

  it('rejects malformed and impossible dates', () => {
    expect(() => vnDayBounds('16/11/2026')).toThrow(RangeError);
    expect(() => vnDayBounds('2026-02-30')).toThrow(RangeError);
  });
});
