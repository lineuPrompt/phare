import { describe, it, expect } from 'vitest';
import {
  formatLocalDate,
  formatLocalMonth,
  materializeFromMonthStart,
  materializeRule,
  monthNameToNumber,
  occurrencesInMonth,
  bridgePaymentDate,
  nextOccurrence,
  statementCycleWindow,
  businessToday,
  businessMonth,
  excludeSkippedDates,
  firstOfNextMonth,
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

describe('materializeFromMonthStart', () => {
  // Months are real, not averaged: a payment that already happened earlier
  // this month — before an anchor was set or an edit was made today — is
  // still a real occurrence for this month. The old materializeFutureRule
  // filtered anything before "today", which silently dropped these.

  it('keeps an occurrence earlier this month, before the reference date (monthly)', () => {
    const rule = { cadence: 'monthly' as const, anchorDate: '2026-06-01' };
    expect(materializeFromMonthStart(rule, '2026-06-18', 3)).toEqual([
      '2026-06-01',
      '2026-07-01',
      '2026-08-01',
    ]);
  });

  it('mid-month bi-weekly anchor → both July occurrences appear, with correct dates', () => {
    // Anchored on the 20th (e.g. the anchor step was completed on the 20th).
    // The true cadence's earlier July occurrence (the 6th) is 14 days before
    // the anchor and must still appear — the old code would have dropped it
    // since 2026-07-06 < the reference date 2026-07-20.
    const rule = { cadence: 'biweekly' as const, anchorDate: '2026-07-20' };
    expect(materializeFromMonthStart(rule, '2026-07-20', 1)).toEqual([
      '2026-07-06',
      '2026-07-20',
    ]);
  });

  it('a genuine three-payment bi-weekly month materializes all three, including the ones before the reference date', () => {
    const rule = { cadence: 'biweekly' as const, anchorDate: '2026-07-01' };
    // Reference date after the 1st and 15th — both must still appear, not just the 29th.
    expect(materializeFromMonthStart(rule, '2026-07-20', 1)).toEqual([
      '2026-07-01',
      '2026-07-15',
      '2026-07-29',
    ]);
  });

  it('semi-monthly anchored after the 15th still includes the 15th', () => {
    // buildSemimonthlyAnchor always puts the earlier day-of-month in
    // anchorDate — here day 15 — even when the anchoring action itself
    // happens on, say, the 20th.
    const rule = { cadence: 'semimonthly' as const, anchorDate: '2026-07-15', secondDay: 30 };
    expect(materializeFromMonthStart(rule, '2026-07-20', 1)).toEqual([
      '2026-07-15',
      '2026-07-30',
    ]);
  });

  it('anchor on the 1st produces no duplicate for that date', () => {
    const rule = { cadence: 'biweekly' as const, anchorDate: '2026-07-01' };
    const dates = materializeFromMonthStart(rule, '2026-07-01', 1);
    expect(dates).toEqual(['2026-07-01', '2026-07-15', '2026-07-29']);
    expect(new Set(dates).size).toBe(dates.length);
  });

  it('still returns future months in full', () => {
    const rule = { cadence: 'monthly' as const, anchorDate: '2026-06-18' };
    expect(materializeFromMonthStart(rule, '2026-06-18', 2)).toEqual([
      '2026-06-18',
      '2026-07-18',
    ]);
  });
});

describe('excludeSkippedDates', () => {
  // The exact mechanism preventing "editing the rule silently reverts my
  // detached $70 phone bill back to $60" / "resurrects a deleted occurrence."

  it('drops a single detached/deleted date from a freshly-materialized list', () => {
    const dates = ['2026-10-01', '2026-11-01', '2026-12-01'];
    expect(excludeSkippedDates(dates, ['2026-11-01'])).toEqual(['2026-10-01', '2026-12-01']);
  });

  it('is a no-op when nothing has ever been detached (e.g. a brand-new rule)', () => {
    const dates = ['2026-10-01', '2026-11-01'];
    expect(excludeSkippedDates(dates, [])).toEqual(dates);
  });

  it('drops every matching date, not just the first', () => {
    const dates = ['2026-01-01', '2026-02-01', '2026-03-01'];
    expect(excludeSkippedDates(dates, ['2026-01-01', '2026-03-01'])).toEqual(['2026-02-01']);
  });

  it('accepts a Set directly, not just an array', () => {
    const dates = ['2026-01-01', '2026-02-01'];
    expect(excludeSkippedDates(dates, new Set(['2026-01-01']))).toEqual(['2026-02-01']);
  });

  it('a tombstone for a date outside the current batch has no effect', () => {
    const dates = ['2026-01-01', '2026-02-01'];
    expect(excludeSkippedDates(dates, ['2025-12-01'])).toEqual(dates);
  });
});

describe('firstOfNextMonth', () => {
  it('rolls to the 1st of next month within a year', () => {
    expect(firstOfNextMonth('2026-07-21')).toBe('2026-08-01');
  });

  it('rolls December over into January of the next year', () => {
    expect(firstOfNextMonth('2026-12-15')).toBe('2027-01-01');
  });

  it('is stable on the 1st of the month already', () => {
    expect(firstOfNextMonth('2026-08-01')).toBe('2026-09-01');
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

describe('statementCycleWindow', () => {
  it('Costco fixture: close 15th → cycle month Jul, window Jun16-Jul15, payment Aug 5', () => {
    const window = statementCycleWindow('2026-07', 15);
    expect(window).toEqual({ start: '2026-06-16', end: '2026-07-15' });
    expect(bridgePaymentDate('2026-07', 5)).toBe('2026-08-05');
  });

  it('Visa Avion fixture: close 27th → cycle month Jul, window Jun28-Jul27, payment Aug 17', () => {
    const window = statementCycleWindow('2026-07', 27);
    expect(window).toEqual({ start: '2026-06-28', end: '2026-07-27' });
    expect(bridgePaymentDate('2026-07', 17)).toBe('2026-08-17');
  });

  it('falls back to the plain calendar month when closeDay is null', () => {
    expect(statementCycleWindow('2026-07', null)).toEqual({ start: '2026-07-01', end: '2026-07-31' });
    expect(statementCycleWindow('2026-02', null)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });

  it('an entry exactly on the close day is in-cycle (inclusive end)', () => {
    const window = statementCycleWindow('2026-07', 15);
    expect('2026-07-15' >= window.start && '2026-07-15' <= window.end).toBe(true);
  });

  it('an entry the day after close belongs to the NEXT cycle, not this one', () => {
    const window = statementCycleWindow('2026-07', 15);
    expect('2026-07-16' <= window.end).toBe(false);
    const nextWindow = statementCycleWindow('2026-08', 15);
    expect('2026-07-16' >= nextWindow.start && '2026-07-16' <= nextWindow.end).toBe(true);
  });

  it('handles a cycle spanning a year boundary', () => {
    const window = statementCycleWindow('2026-01', 15);
    expect(window).toEqual({ start: '2025-12-16', end: '2026-01-15' });
  });

  it('clamps close day to short months (e.g. close day 31 in February)', () => {
    const window = statementCycleWindow('2026-02', 31);
    // Feb 2026 has 28 days, Jan 2026 has 31 days.
    expect(window).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });

  it('clamps the previous month close day too (close day 31, cycle month March → prev Feb clamps to 28)', () => {
    const window = statementCycleWindow('2026-03', 31);
    expect(window).toEqual({ start: '2026-03-01', end: '2026-03-31' });
  });
});

describe('nextOccurrence', () => {
  it('returns null when anchorDate is not yet known', () => {
    expect(nextOccurrence({ cadence: 'monthly', anchorDate: null }, '2026-07-15')).toBeNull();
  });

  it('monthly: returns this month\'s date when it has not passed yet', () => {
    expect(nextOccurrence({ cadence: 'monthly', anchorDate: '2026-01-20' }, '2026-07-15')).toBe('2026-07-20');
  });

  it('monthly: rolls to next month when this month\'s date already passed', () => {
    expect(nextOccurrence({ cadence: 'monthly', anchorDate: '2026-01-05' }, '2026-07-15')).toBe('2026-08-05');
  });

  it('monthly: today itself counts as the next occurrence', () => {
    expect(nextOccurrence({ cadence: 'monthly', anchorDate: '2026-01-15' }, '2026-07-15')).toBe('2026-07-15');
  });

  it('semimonthly: picks the earlier upcoming day; rolls to the 1st once the 15th has passed', () => {
    // Today is before the 1st this month → the 1st itself is next.
    expect(nextOccurrence({ cadence: 'semimonthly', anchorDate: '2026-06-01', secondDay: 15 }, '2026-06-25')).toBe('2026-07-01');
    // Today is between the 1st and 15th → the 15th is next.
    expect(nextOccurrence({ cadence: 'semimonthly', anchorDate: '2026-01-01', secondDay: 15 }, '2026-07-10')).toBe('2026-07-15');
  });

  it('biweekly: returns the nearest occurrence on or after today', () => {
    // Anchor on a Monday; step 14 days at a time.
    const result = nextOccurrence({ cadence: 'biweekly', anchorDate: '2026-07-06' }, '2026-07-15');
    expect(result! >= '2026-07-15').toBe(true);
    // And it must actually be a real biweekly occurrence, not an arbitrary date.
    const diffDays = (new Date(result! + 'T00:00:00').getTime() - new Date('2026-07-06T00:00:00').getTime()) / 86400000;
    expect(diffDays % 14).toBe(0);
  });

  it('clamps a monthly anchor day past the end of a shorter month', () => {
    // Anchor on the 31st; June only has 30 days.
    expect(nextOccurrence({ cadence: 'monthly', anchorDate: '2026-01-31' }, '2026-06-15')).toBe('2026-06-30');
  });
});

describe('businessToday / businessMonth — the household-timezone date spine', () => {
  const TZ = 'America/Toronto';

  // The exact bug that started this: a household in Eastern time is still
  // "today" for several hours after UTC has already rolled over to
  // tomorrow. Anything that derives "today" from the server's UTC clock
  // (new Date().toISOString().slice(0,10), or new Date() on a UTC-tz
  // server process) gets this wrong; businessToday must not.
  it('8pm EST (past UTC midnight) is still treated as that Eastern day, not the next UTC day', () => {
    // 2026-01-20 20:00 EST == 2026-01-21 01:00 UTC.
    const at = new Date('2026-01-21T01:00:00Z');
    expect(businessToday(TZ, at)).toBe('2026-01-20');
    // What the old UTC-based code would have wrongly produced.
    expect(at.toISOString().slice(0, 10)).toBe('2026-01-21');
  });

  it('month rollover: 8pm EDT on the last day of the month does not roll to next month', () => {
    // 2026-07-31 20:30 EDT == 2026-08-01 00:30 UTC.
    const at = new Date('2026-08-01T00:30:00Z');
    expect(businessMonth(TZ, at)).toBe('2026-07');
    expect(businessToday(TZ, at)).toBe('2026-07-31');
    // What the old UTC-based code would have wrongly produced.
    expect(at.toISOString().slice(0, 7)).toBe('2026-08');
  });

  // Montreal/Toronto DST edges — real IANA tz data (via Intl), not a fixed
  // UTC offset, so the shortened (spring-forward) and lengthened
  // (fall-back) local days still land on the correct calendar date at the
  // local-midnight boundary.
  it('spring-forward (2026-03-08, EST→EDT at 2am local): local midnight boundary still resolves correctly', () => {
    expect(businessToday(TZ, new Date('2026-03-08T04:59:00Z'))).toBe('2026-03-07');
    expect(businessToday(TZ, new Date('2026-03-08T05:01:00Z'))).toBe('2026-03-08');
    // The next midnight is an hour earlier in UTC terms (day is EDT now).
    expect(businessToday(TZ, new Date('2026-03-09T03:59:00Z'))).toBe('2026-03-08');
    expect(businessToday(TZ, new Date('2026-03-09T04:01:00Z'))).toBe('2026-03-09');
  });

  it('fall-back (2026-11-01, EDT→EST at 2am EDT): local midnight boundary still resolves correctly', () => {
    expect(businessToday(TZ, new Date('2026-11-01T03:59:00Z'))).toBe('2026-10-31');
    expect(businessToday(TZ, new Date('2026-11-01T04:01:00Z'))).toBe('2026-11-01');
    // The next midnight is an hour later in UTC terms (day is EST now).
    expect(businessToday(TZ, new Date('2026-11-02T04:59:00Z'))).toBe('2026-11-01');
    expect(businessToday(TZ, new Date('2026-11-02T05:01:00Z'))).toBe('2026-11-02');
  });

  it('defaults to the real current instant when no reference date is given', () => {
    const expected = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
    // en-CA formats as YYYY-MM-DD, matching businessToday's own output shape.
    expect(businessToday(TZ)).toBe(expected);
  });
});

// A semi-monthly rule anchored on day 30/31 must still clamp correctly in
// February even when "today" is resolved via the household timezone rather
// than the server's UTC clock — the clamping logic itself is unchanged
// (occurrencesInMonth), but this proves the two paths compose correctly.
describe('semi-monthly day-30 clamp composes correctly with businessMonth', () => {
  it('a semimonthly rule anchored on day 30 lands on Feb 28 in a non-leap year, computed from a businessMonth start', () => {
    const at = new Date('2026-02-15T20:00:00-05:00'); // 8pm EST, Feb 15 2026 (not near any boundary)
    const month = businessMonth('America/Toronto', at);
    expect(month).toBe('2026-02');
    const dates = occurrencesInMonth(
      { cadence: 'semimonthly', anchorDate: '2026-01-30', secondDay: 30 },
      month
    );
    expect(dates).toEqual(['2026-02-28']);
  });
});
