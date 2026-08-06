import { computeInsufficientHistory, type MonthHistoryAvailability } from '@/lib/coachingHelpers';

// ---------------------------------------------------------------------------
// WHICH HOUSEHOLDS ARE DUE A MONTHLY REVIEW RIGHT NOW.
//
// Pure, so every boundary — the wrong day, the wrong hour, a month already
// generated, a household too new to review — is testable without a clock, a
// database, or a cron.
//
// WHY HOURLY RATHER THAN ONCE A DAY. Every household has its own timezone. A
// single UTC-midnight job would generate a Vancouver household's July review at
// 4pm on 31 July, before their month had ended, and narrate a month still in
// progress as though it were finished. Running hourly and asking "is it
// currently the 1st where THIS household lives?" turns the timezone problem
// into a filter instead of arithmetic.
// ---------------------------------------------------------------------------

export type ReviewCandidate = {
  householdId: string;
  /** The household's own current date, 'YYYY-MM-DD' — from businessToday(tz). */
  localToday: string;
  /** Months of ledger data, for the same threshold the coaching layer uses. */
  history: MonthHistoryAvailability[];
  /** review_month values this household already has. */
  existingReviewMonths: string[];
};

export type ReviewDecision =
  | { due: true; month: string }
  | { due: false; reason: 'not_first_of_month' | 'already_generated' | 'insufficient_history' | 'malformed_date' };

/** The completed month, given a local date. '2026-09-01' → '2026-08'. */
export function previousMonthOf(localDate: string): string | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(localDate);
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) return null;
  return mon === 1
    ? `${year - 1}-12`
    : `${year}-${String(mon - 1).padStart(2, '0')}`;
}

/**
 * Is this household due a review for the month that just ended?
 *
 * Deliberately conservative at every branch. The cost of a false NEGATIVE is a
 * household waiting a month; the cost of a false POSITIVE is a paid AI call
 * producing a letter about a month that has not finished, or a duplicate of one
 * that already exists. Those are not symmetric.
 */
export function decideReview(candidate: ReviewCandidate): ReviewDecision {
  const { localToday, history, existingReviewMonths } = candidate;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(localToday)) {
    return { due: false, reason: 'malformed_date' };
  }

  // Only on the 1st, in the household's OWN calendar. On any other local day
  // the month being reviewed either has not ended or has already been handled.
  if (!localToday.endsWith('-01')) {
    return { due: false, reason: 'not_first_of_month' };
  }

  const month = previousMonthOf(localToday);
  if (!month) return { due: false, reason: 'malformed_date' };

  // Cheap pre-check. The unique index is the real guarantee — two cron runs can
  // both read "not generated" and only one insert can win — but filtering here
  // avoids paying for a generation whose write is going to be rejected.
  if (existingReviewMonths.includes(month)) {
    return { due: false, reason: 'already_generated' };
  }

  // The SAME threshold the coaching layer already uses (fewer than three months
  // of real data). A second definition of "enough history" would drift from it,
  // and the review's own prose is built on that helper's assumptions.
  //
  // Below it: generate NOTHING. Not a hollow letter, and not an apology email
  // either — a family two months into using Phare has not accumulated anything
  // a monthly review could honestly say.
  if (computeInsufficientHistory(history)) {
    return { due: false, reason: 'insufficient_history' };
  }

  return { due: true, month };
}
