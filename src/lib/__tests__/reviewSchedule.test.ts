import { describe, it, expect } from 'vitest';
import { decideReview, previousMonthOf, type ReviewCandidate } from '@/lib/reviewSchedule';

// The asymmetry these tests protect: a false negative makes a household wait a
// month; a false positive spends money on a letter about an unfinished month,
// or duplicates one that already exists.

/** Months carrying real ledger data. '2026-08' is the month reviewed on 1 Sep. */
const withData = (...ms: string[]) => ms.map((month) => ({ month, hasRealData: true }));

const candidate = (over: Partial<ReviewCandidate> = {}): ReviewCandidate => ({
  householdId: 'hh1',
  localToday: '2026-09-01',
  history: withData('2026-06', '2026-07', '2026-08'),
  existingReviewMonths: [],
  ...over,
});

describe('previousMonthOf', () => {
  it('is the month that just ended', () => {
    expect(previousMonthOf('2026-09-01')).toBe('2026-08');
  });

  it('rolls the year backwards at January', () => {
    expect(previousMonthOf('2026-01-01')).toBe('2025-12');
  });

  it('returns null for malformed input rather than an invalid month', () => {
    for (const bad of ['2026-09', 'nonsense', '2026-13-01', '']) {
      expect(previousMonthOf(bad), bad).toBeNull();
    }
  });
});

describe('decideReview — the day', () => {
  it('is due on the 1st, for the month that just ended', () => {
    expect(decideReview(candidate())).toEqual({ due: true, month: '2026-08' });
  });

  it('is NOT due on any other day', () => {
    // The month either has not ended, or was already handled on the 1st.
    for (const day of ['2026-08-31', '2026-09-02', '2026-09-15']) {
      expect(decideReview(candidate({ localToday: day })), day)
        .toEqual({ due: false, reason: 'not_first_of_month' });
    }
  });

  it('uses the HOUSEHOLD’s local date, which is the whole point of running hourly', () => {
    // 31 July in Vancouver is already 1 August in UTC. A UTC-scheduled job would
    // review July before July had ended there; this decides on the local date it
    // is handed, so the caller can pass businessToday(householdTimezone).
    expect(decideReview(candidate({ localToday: '2026-07-31' })).due).toBe(false);
    expect(decideReview(candidate({ localToday: '2026-08-01' }))).toEqual({ due: true, month: '2026-07' });
  });

  it('a malformed local date never triggers generation', () => {
    expect(decideReview(candidate({ localToday: 'today' })))
      .toEqual({ due: false, reason: 'malformed_date' });
  });
});

describe('decideReview — idempotency pre-check', () => {
  it('is not due when the month is already generated', () => {
    expect(decideReview(candidate({ existingReviewMonths: ['2026-08'] })))
      .toEqual({ due: false, reason: 'already_generated' });
  });

  it('other months present do not block the one that is due', () => {
    expect(decideReview(candidate({ existingReviewMonths: ['2026-06', '2026-07'] })))
      .toEqual({ due: true, month: '2026-08' });
  });

  it('is only a pre-check — the unique index is the real guarantee', () => {
    // Two hourly runs can both read "not generated". Only one INSERT can win.
    // This branch exists to avoid paying for a generation whose write will be
    // rejected, not to make the race impossible.
    const c = candidate();
    expect(decideReview(c).due).toBe(true);
    expect(decideReview(c).due).toBe(true);
  });
});

describe('decideReview — eligibility is ONE completed month with data', () => {
  // Reversed 2026-08-08. computeInsufficientHistory (fewer than three months)
  // was used as the gate; it was built as a DISCLOSURE, and at three months it
  // meant a household invited in November got no review until February — the
  // retention mechanism starting after the period it exists to measure.

  it('ONE month of data is enough', () => {
    // The letter cannot compare months, but it can say what came in, what went
    // out, what is over target and what is coming. That is a useful letter.
    expect(decideReview(candidate({ history: withData('2026-08') })))
      .toEqual({ due: true, month: '2026-08' });
  });

  it('is due even with only the reviewed month and nothing before it', () => {
    expect(decideReview(candidate({ history: withData('2026-08') })).due).toBe(true);
  });

  it('is NOT due when the reviewed month itself has no data', () => {
    // Prior months existing does not make August reviewable — a letter about a
    // month with no ledger data would have nothing true to say.
    expect(decideReview(candidate({ history: withData('2026-06', '2026-07') })))
      .toEqual({ due: false, reason: 'no_data_for_month' });
  });

  it('is NOT due with no data at all', () => {
    expect(decideReview(candidate({ history: [] })))
      .toEqual({ due: false, reason: 'no_data_for_month' });
  });

  it('a month flagged hasRealData=false does not count', () => {
    expect(decideReview(candidate({
      history: [{ month: '2026-08', hasRealData: false }],
    }))).toEqual({ due: false, reason: 'no_data_for_month' });
  });

  it('data in the CURRENT month does not make the completed one reviewable', () => {
    // September rows say nothing about August.
    expect(decideReview(candidate({ history: withData('2026-09') })))
      .toEqual({ due: false, reason: 'no_data_for_month' });
  });
});

describe('decideReview — ordering of the checks', () => {
  it('the day is checked before data, so a new household is not reported as dataless every hour', () => {
    // Diagnostic clarity: 'not_first_of_month' is the honest reason on the 15th,
    // whatever the ledger looks like.
    expect(decideReview(candidate({ localToday: '2026-09-15', history: [] })))
      .toEqual({ due: false, reason: 'not_first_of_month' });
  });

  it('an already-generated month wins over missing data', () => {
    // If it exists, it exists — eligibility is moot.
    expect(decideReview(candidate({ history: [], existingReviewMonths: ['2026-08'] })))
      .toEqual({ due: false, reason: 'already_generated' });
  });
});
