import { describe, it, expect } from 'vitest';
import { monthNameToNumber } from '../dateHelpers';

describe('monthNameToNumber', () => {
  it('maps English month names', () => {
    expect(monthNameToNumber('January')).toBe(1);
    expect(monthNameToNumber('June')).toBe(6);
    expect(monthNameToNumber('December')).toBe(12);
  });

  it('maps French month names', () => {
    expect(monthNameToNumber('janvier')).toBe(1);
    expect(monthNameToNumber('juin')).toBe(6);
    expect(monthNameToNumber('décembre')).toBe(12);
  });

  it('handles accented French months', () => {
    expect(monthNameToNumber('février')).toBe(2);
    expect(monthNameToNumber('août')).toBe(8);
  });

  it('is case-insensitive', () => {
    expect(monthNameToNumber('MARCH')).toBe(3);
    expect(monthNameToNumber('AoÛt')).toBe(8);
  });

  it('matches a month inside a longer string', () => {
    expect(monthNameToNumber('Due in September')).toBe(9);
    expect(monthNameToNumber('April 30 (CRA deadline)')).toBe(4);
  });

  it('returns the FIRST month when several are present', () => {
    expect(monthNameToNumber('March & June')).toBe(3);
  });

  it('returns null for unrecognized input', () => {
    expect(monthNameToNumber('Ongoing')).toBeNull();
    expect(monthNameToNumber('Varies')).toBeNull();
    expect(monthNameToNumber('')).toBeNull();
  });

  it('handles null/undefined-ish input safely', () => {
    expect(monthNameToNumber(null as unknown as string)).toBeNull();
    expect(monthNameToNumber(undefined as unknown as string)).toBeNull();
  });
});

import { addMonths, recurrenceDates } from '../dateHelpers';

describe('addMonths', () => {
  it('advances by whole months', () => {
    expect(addMonths('2026-06-15', 1)).toBe('2026-07-15');
    expect(addMonths('2026-06-15', 3)).toBe('2026-09-15');
  });

  it('returns the same date for 0 months', () => {
    expect(addMonths('2026-06-15', 0)).toBe('2026-06-15');
  });

  it('rolls over the year boundary', () => {
    expect(addMonths('2026-11-10', 2)).toBe('2027-01-10');
    expect(addMonths('2026-12-01', 1)).toBe('2027-01-01');
  });

  it('clamps Jan 31 to end of February (the rollover bug fix)', () => {
    // 2026 is not a leap year → Feb 28
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('clamps to Feb 29 in a leap year', () => {
    // 2028 is a leap year
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  });

  it('clamps day-31 starts into 30-day months', () => {
    // March 31 + 1 month → April has 30 days
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30');
  });

  it('preserves day when target month is long enough', () => {
    expect(addMonths('2026-01-30', 2)).toBe('2026-03-30');
  });

  it('advances 12 months to the same date next year', () => {
    expect(addMonths('2026-06-15', 12)).toBe('2027-06-15');
  });
});

describe('recurrenceDates', () => {
  it('produces one date per month for the given count', () => {
    const dates = recurrenceDates('2026-06-01', 3);
    expect(dates).toEqual(['2026-06-01', '2026-07-01', '2026-08-01']);
  });

  it('produces a single date for count of 1', () => {
    expect(recurrenceDates('2026-06-15', 1)).toEqual(['2026-06-15']);
  });

  it('generates 12 months crossing the year boundary', () => {
    const dates = recurrenceDates('2026-08-01', 12);
    expect(dates).toHaveLength(12);
    expect(dates[0]).toBe('2026-08-01');
    expect(dates[11]).toBe('2027-07-01');
  });

  it('clamps month-end dates across the series', () => {
    // Starting Jan 31, the Feb occurrence clamps to Feb 28
    const dates = recurrenceDates('2026-01-31', 2);
    expect(dates).toEqual(['2026-01-31', '2026-02-28']);
  });
});