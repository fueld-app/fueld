import {
  followUpDateFromDays,
  followUpDaysFromDate,
  normalizeFollowUpDays,
  todayDateString,
} from './comments-card.follow-up';

describe('comments card follow-up helpers', () => {
  const now = new Date(2026, 3, 16, 11, 30, 0, 0);

  it('defaults to today for zero days', () => {
    expect(todayDateString(now)).toBe('2026-04-16');
    expect(followUpDateFromDays(0, now)).toBe('2026-04-16');
  });

  it('maps day offsets to local calendar dates', () => {
    expect(followUpDateFromDays(10, now)).toBe('2026-04-26');
    expect(followUpDateFromDays(-2, now)).toBe('2026-04-14');
  });

  it('maps selected dates back to day offsets from today', () => {
    expect(followUpDaysFromDate('2026-04-16', now)).toBe(0);
    expect(followUpDaysFromDate('2026-04-26', now)).toBe(10);
    expect(followUpDaysFromDate('2026-04-12', now)).toBe(-4);
  });

  it('normalizes numeric input values', () => {
    expect(normalizeFollowUpDays(10)).toBe(10);
    expect(normalizeFollowUpDays(' +15 ')).toBe(15);
    expect(normalizeFollowUpDays('')).toBe(0);
    expect(normalizeFollowUpDays(null)).toBe(0);
  });
});