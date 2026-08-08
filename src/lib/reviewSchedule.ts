import type { MonthHistoryAvailability } from '@/lib/coachingHelpers';

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
  /**
   * Months that contain real ledger data. Only the REVIEWED month is consulted
   * — see the eligibility note in decideReview.
   */
  history: MonthHistoryAvailability[];
  /** review_month values this household already has. */
  existingReviewMonths: string[];
};

export type ReviewDecision =
  | { due: true; month: string }
  | { due: false; reason: 'not_first_of_month' | 'already_generated' | 'no_data_for_month' | 'malformed_date' };

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

  // ELIGIBILITY IS ONE COMPLETED MONTH WITH DATA — nothing more.
  //
  // This deliberately does NOT use computeInsufficientHistory. That helper was
  // built as a DISCLOSURE ("this figure is conservative because trailing
  // history is still building"), and its own doc comment says so: "a separate
  // narration signal, not a different formula". Using it as an eligibility gate
  // was a misreading, and an expensive one — at three months it means a family
  // invited in November receives no review until February, so the retention
  // mechanism does not start until after the period it exists to measure.
  //
  // A one-month review is writeable. It cannot say "restaurants are up from
  // last month", but it can say what came in, what went out, what is over
  // target and what is coming. computeInsufficientHistory keeps doing its real
  // job inside the generation: telling the model to present its surplus figure
  // as conservative.
  //
  // WHY DATA AND NOT TENURE: onboarding imports history. A household that signs
  // up on the 28th with the Phare template has a COMPLETE month of ledger data
  // from their spreadsheet, so a "has existed since the 1st" rule would refuse
  // a household that has everything a review needs. The converse case — three
  // days of hand-entered data — is thin but true, and is precisely what the
  // conservative-figure disclosure exists to narrate.
  const reviewedMonthHasData = history.some((h) => h.month === month && h.hasRealData);
  if (!reviewedMonthHasData) {
    return { due: false, reason: 'no_data_for_month' };
  }

  return { due: true, month };
}
