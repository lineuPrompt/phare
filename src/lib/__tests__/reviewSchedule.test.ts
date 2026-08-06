import { describe, it, expect } from 'vitest';
import { decideReview, previousMonthOf, type ReviewCandidate } from '@/lib/reviewSchedule';

// The asymmetry these tests protect: a false negative makes a household wait a
// month; a false positive spends money on a letter about an unfinished month,
// or duplicates one that already exists.

const months = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ month: `2026-0${i + 1}`, hasRealData: true }));

const candidate = (over: Partial<ReviewCandidate> = {}): ReviewCandidate => ({
  householdId: 'hh1',
  localToday: '2026-09-01',
  history: months(4),
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

describe('decideReview — insufficient history', () => {
  it('is not due below three months of real data', () => {
    // A family two months in has not accumulated anything a monthly review
    // could honestly say. Generate nothing — not a hollow letter.
    expect(decideReview(candidate({ history: months(2) })))
      .toEqual({ due: false, reason: 'insufficient_history' });
  });

  it('is due at exactly three months', () => {
    expect(decideReview(candidate({ history: months(3) })).due).toBe(true);
  });

  it('months without real data do not count toward the threshold', () => {
    const sparse = [
      { month: '2026-05', hasRealData: true },
      { month: '2026-06', hasRealData: false },
      { month: '2026-07', hasRealData: false },
      { month: '2026-08', hasRealData: true },
    ];
    expect(decideReview(candidate({ history: sparse })))
      .toEqual({ due: false, reason: 'insufficient_history' });
  });

  it('no history at all is not due', () => {
    expect(decideReview(candidate({ history: [] })).due).toBe(false);
  });
});

describe('decideReview — ordering of the checks', () => {
  it('the day is checked before history, so a new household is not reported as insufficient every hour', () => {
    // Diagnostic clarity: 'not_first_of_month' is the honest reason on the 15th,
    // whatever the history looks like.
    expect(decideReview(candidate({ localToday: '2026-09-15', history: [] })))
      .toEqual({ due: false, reason: 'not_first_of_month' });
  });

  it('an already-generated month wins over insufficient history', () => {
    // If it exists, it exists — the threshold is moot.
    expect(decideReview(candidate({ history: months(1), existingReviewMonths: ['2026-08'] })))
      .toEqual({ due: false, reason: 'already_generated' });
  });
});
