import { describe, it, expect } from 'vitest';
import {
  formatLocalDate,
  formatLocalMonth,
  materializeFutureRule,
  materializeRule,
  monthNameToNumber,
  occurrencesInMonth,
  bridgePaymentDate,
} from '../dateHelpers';

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

describe('occurrencesInMonth', () => {
  // --- monthly ---
  it('monthly: one occurrence on the anchor day', () => {
    const rule = { cadence: 'monthly' as const, anchorDate: '2026-06-01' };
    expect(occurrencesInMonth(rule, '2026-08')).toEqual(['2026-08-01']);
  });

  it('monthly: clamps a day-31 anchor into a short month', () => {
    const rule = { cadence: 'monthly' as const, anchorDate: '2026-01-31' };
    expect(occurrencesInMonth(rule, '2026-02')).toEqual(['2026-02-28']);
  });

  // --- semimonthly ---
  it('semimonthly: two occurrences, sorted', () => {
    const rule = { cadence: 'semimonthly' as const, anchorDate: '2026-06-15', secondDay: 30 };
    expect(occurrencesInMonth(rule, '2026-07')).toEqual(['2026-07-15', '2026-07-30']);
  });

  it('semimonthly: clamps the second day in February', () => {
    const rule = { cadence: 'semimonthly' as const, anchorDate: '2026-02-15', secondDay: 30 };
    expect(occurrencesInMonth(rule, '2026-02')).toEqual(['2026-02-15', '2026-02-28']);
  });

  it('semimonthly: dedupes when both days are equal', () => {
    const rule = { cadence: 'semimonthly' as const, anchorDate: '2026-06-15', secondDay: 15 };
    expect(occurrencesInMonth(rule, '2026-06')).toEqual(['2026-06-15']);
  });

  // --- biweekly ---
  it('biweekly: two paycheques in a normal month', () => {
    // anchor July 1 2026 (Wed). July: 1, 15, 29 → actually three. Use a 2-pay month.
    const rule = { cadence: 'biweekly' as const, anchorDate: '2026-08-05' };
    // Aug 5, 19 → two in August
    expect(occurrencesInMonth(rule, '2026-08')).toEqual(['2026-08-05', '2026-08-19']);
  });

  it('biweekly: THREE paycheques in a windfall month', () => {
    // anchor July 1 2026 → July 1, 15, 29 all land in July
    const rule = { cadence: 'biweekly' as const, anchorDate: '2026-07-01' };
    expect(occurrencesInMonth(rule, '2026-07')).toEqual(['2026-07-01', '2026-07-15', '2026-07-29']);
  });

  it('biweekly: works months before the anchor', () => {
    // anchor in July, ask about September — should still compute correctly
    const rule = { cadence: 'biweekly' as const, anchorDate: '2026-07-01' };
    const result = occurrencesInMonth(rule, '2026-09');
    // Sep 9, 23 (continuing the 14-day cycle from Jul 1)
    expect(result).toEqual(['2026-09-09', '2026-09-23']);
  });

  it('biweekly: works months before the anchor date itself', () => {
    const rule = { cadence: 'biweekly' as const, anchorDate: '2026-07-01' };
    // June, before anchor — cycle steps back: Jun 3, 17 (Jul 1 - 14 = Jun 17, -14 = Jun 3)
    const result = occurrencesInMonth(rule, '2026-06');
    expect(result).toEqual(['2026-06-03', '2026-06-17']);
  });

  // --- weekly ---
  it('weekly: four paycheques in a normal month', () => {
    // anchor Aug 5 2026 (Wed) → Aug 5, 12, 19, 26 (4 Wednesdays before the 5th one on Sep 2)
    const rule = { cadence: 'weekly' as const, anchorDate: '2026-08-05' };
    expect(occurrencesInMonth(rule, '2026-08')).toEqual(['2026-08-05', '2026-08-12', '2026-08-19', '2026-08-26']);
  });

  it('weekly: FIVE paycheques in a windfall month', () => {
    // anchor Jul 1 2026 (Wed) → Jul 1, 8, 15, 22, 29 — five Wednesdays in July
    const rule = { cadence: 'weekly' as const, anchorDate: '2026-07-01' };
    expect(occurrencesInMonth(rule, '2026-07')).toEqual(['2026-07-01', '2026-07-08', '2026-07-15', '2026-07-22', '2026-07-29']);
  });

  it('weekly: works months after the anchor', () => {
    const rule = { cadence: 'weekly' as const, anchorDate: '2026-07-01' };
    const result = occurrencesInMonth(rule, '2026-09');
    expect(result).toEqual(['2026-09-02', '2026-09-09', '2026-09-16', '2026-09-23', '2026-09-30']);
  });

  it('weekly: works months before the anchor date itself', () => {
    const rule = { cadence: 'weekly' as const, anchorDate: '2026-07-01' };
    const result = occurrencesInMonth(rule, '2026-06');
    expect(result).toEqual(['2026-06-03', '2026-06-10', '2026-06-17', '2026-06-24']);
  });
});

describe('materializeRule', () => {
  it('monthly: one row per month across the window', () => {
    const rule = { cadence: 'monthly' as const, anchorDate: '2026-06-01' };
    const dates = materializeRule(rule, '2026-06', 3);
    expect(dates).toEqual(['2026-06-01', '2026-07-01', '2026-08-01']);
  });

  it('monthly: 12 rows over a year, crossing the year boundary', () => {
    const rule = { cadence: 'monthly' as const, anchorDate: '2026-08-01' };
    const dates = materializeRule(rule, '2026-08', 12);
    expect(dates).toHaveLength(12);
    expect(dates[0]).toBe('2026-08-01');
    expect(dates[11]).toBe('2027-07-01');
  });

  it('monthly: clamps day-31 across short months', () => {
    const rule = { cadence: 'monthly' as const, anchorDate: '2026-01-31' };
    const dates = materializeRule(rule, '2026-01', 3);
    // Jan 31, Feb 28, Mar 31
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('semimonthly: two rows per month', () => {
    const rule = { cadence: 'semimonthly' as const, anchorDate: '2026-06-15', secondDay: 30 };
    const dates = materializeRule(rule, '2026-06', 2);
    expect(dates).toEqual(['2026-06-15', '2026-06-30', '2026-07-15', '2026-07-30']);
  });

  it('biweekly: produces 26 occurrences across 12 months', () => {
    const rule = { cadence: 'biweekly' as const, anchorDate: '2026-01-02' };
    const dates = materializeRule(rule, '2026-01', 12);
    // 365 days / 14 ≈ 26 pay periods in a year
    expect(dates.length).toBeGreaterThanOrEqual(26);
    expect(dates.length).toBeLessThanOrEqual(27);
  });

  it('biweekly: every date is 14 days after the previous', () => {
    const rule = { cadence: 'biweekly' as const, anchorDate: '2026-07-01' };
    const dates = materializeRule(rule, '2026-07', 3);
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1] + 'T00:00:00');
      const curr = new Date(dates[i] + 'T00:00:00');
      const diff = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
      expect(diff).toBe(14);
    }
  });

  it('weekly: produces 52 occurrences across 12 months', () => {
    const rule = { cadence: 'weekly' as const, anchorDate: '2026-01-02' };
    const dates = materializeRule(rule, '2026-01', 12);
    // 365 days / 7 ≈ 52 pay periods in a year
    expect(dates.length).toBeGreaterThanOrEqual(52);
    expect(dates.length).toBeLessThanOrEqual(53);
  });

  it('weekly: every date is 7 days after the previous', () => {
    const rule = { cadence: 'weekly' as const, anchorDate: '2026-07-01' };
    const dates = materializeRule(rule, '2026-07', 3);
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1] + 'T00:00:00');
      const curr = new Date(dates[i] + 'T00:00:00');
      const diff = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
      expect(diff).toBe(7);
    }
  });

  it('returns sorted, deduplicated dates', () => {
    const rule = { cadence: 'monthly' as const, anchorDate: '2026-06-10' };
    const dates = materializeRule(rule, '2026-06', 2);
    const sorted = [...dates].sort();
    expect(dates).toEqual(sorted);
  });
});

describe('formatLocalDate and formatLocalMonth', () => {
  it('formats dates using local calendar fields', () => {
    const date = new Date(2026, 5, 18, 23, 30, 0);
    expect(formatLocalDate(date)).toBe('2026-06-18');
    expect(formatLocalMonth(date)).toBe('2026-06');
  });
});

describe('materializeFutureRule', () => {
  it('filters out occurrences before today in the current month', () => {
    const rule = { cadence: 'monthly' as const, anchorDate: '2026-06-01' };
    expect(materializeFutureRule(rule, '2026-06-18', 3)).toEqual([
      '2026-07-01',
      '2026-08-01',
    ]);
  });

  it('keeps an occurrence that lands today', () => {
    const rule = { cadence: 'monthly' as const, anchorDate: '2026-06-18' };
    expect(materializeFutureRule(rule, '2026-06-18', 2)).toEqual([
      '2026-06-18',
      '2026-07-18',
    ]);
  });

  it('keeps only future semimonthly occurrences in the current month', () => {
    const rule = { cadence: 'semimonthly' as const, anchorDate: '2026-06-01', secondDay: 20 };
    expect(materializeFutureRule(rule, '2026-06-18', 2)).toEqual([
      '2026-06-20',
      '2026-07-01',
      '2026-07-20',
    ]);
  });
});

describe('bridgePaymentDate', () => {
  it('payment lands in the month after spending', () => {
    expect(bridgePaymentDate('2026-06', 1)).toBe('2026-07-01');
    expect(bridgePaymentDate('2026-06', 15)).toBe('2026-07-15');
  });

  it('rolls over the year boundary', () => {
    expect(bridgePaymentDate('2026-12', 1)).toBe('2027-01-01');
    expect(bridgePaymentDate('2026-12', 15)).toBe('2027-01-15');
  });

  it('clamps a day-31 payment into a short month', () => {
    // spending Jan → payment Feb, 2026 not leap → Feb 28
    expect(bridgePaymentDate('2026-01', 31)).toBe('2026-02-28');
  });

  it('clamps to Feb 29 in a leap year', () => {
    // spending Jan 2028 → payment Feb 2028 (leap)
    expect(bridgePaymentDate('2028-01', 31)).toBe('2028-02-29');
  });

  it('clamps day-31 into a 30-day payment month', () => {
    // spending March → payment April (30 days)
    expect(bridgePaymentDate('2026-03', 31)).toBe('2026-04-30');
  });

  it('guards against payDay below 1', () => {
    expect(bridgePaymentDate('2026-06', 0)).toBe('2026-07-01');
  });

  it('preserves a normal mid-month day', () => {
    expect(bridgePaymentDate('2026-09', 10)).toBe('2026-10-10');
  });
});
