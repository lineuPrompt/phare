/**
 * Validation for the post-import anchor-date step. Code owns these rules —
 * the UI only renders what these functions decide.
 */

export type NextPayDateError = 'past' | 'tooFar';

/**
 * A bi-weekly or weekly income's *next* payday must fall within one pay
 * cycle from today (14 or 7 days) — that's the only way "next payday" can
 * be true by definition. Catches an accidental far-future date without
 * requiring the user to know or reason about the underlying cadence math.
 */
export function validateNextPayDate(
  anchorDate: string,       // YYYY-MM-DD
  cadence: 'weekly' | 'biweekly',
  today: string             // YYYY-MM-DD
): { ok: true } | { ok: false; error: NextPayDateError } {
  const windowDays = cadence === 'weekly' ? 7 : 14;
  const anchor = new Date(anchorDate + 'T00:00:00');
  const t = new Date(today + 'T00:00:00');
  const diffDays = Math.round((anchor.getTime() - t.getTime()) / 86400000);

  if (diffDays < 0) return { ok: false, error: 'past' };
  if (diffDays > windowDays) return { ok: false, error: 'tooFar' };
  return { ok: true };
}

export type SemimonthlyDaysError = 'range' | 'same';

/** Both semi-monthly paydays must be valid days-of-month, and distinct. */
export function validateSemimonthlyDays(
  day1: number,
  day2: number
): { ok: true } | { ok: false; error: SemimonthlyDaysError } {
  if (!Number.isInteger(day1) || !Number.isInteger(day2) || day1 < 1 || day1 > 31 || day2 < 1 || day2 > 31) {
    return { ok: false, error: 'range' };
  }
  if (day1 === day2) return { ok: false, error: 'same' };
  return { ok: true };
}

/**
 * Turns two semi-monthly day-of-month picks into a recurring_items
 * anchor_date + second_day. anchor_date carries the earlier day (clamped to
 * the reference month's length — e.g. day 31 in a 30-day month lands on the
 * 30th); occurrencesInMonth() re-clamps per month, so a day picked as 31
 * correctly lands on the last day of every shorter month automatically.
 */
export function buildSemimonthlyAnchor(
  referenceMonth: string,   // YYYY-MM
  day1: number,
  day2: number
): { anchorDate: string; secondDay: number } {
  const [first, second] = [day1, day2].sort((a, b) => a - b);
  const [y, m] = referenceMonth.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const clamped = Math.min(first, lastDay);
  return {
    anchorDate: `${referenceMonth}-${String(clamped).padStart(2, '0')}`,
    secondDay: second,
  };
}

export type SkipConfirmation =
  | { needed: false }
  | { needed: true; unsetIncomeCount: number; unsetExpenseCount: number };

/**
 * Decides whether clicking "Continue" on the anchor step should be gated by
 * a confirmation, and — if so — what to tell the user is at stake. Never
 * fires for an empty list (nothing to skip) or once every item has a real
 * date (nothing left to lose). The anchor step must not be silently
 * skippable: leaving items undated is a real, consequential choice (they
 * won't appear in any month view until dated), not a default to fall
 * through unnoticed.
 */
export function evaluateSkipConfirmation(
  items: { type: 'income' | 'expense'; isSet: boolean }[]
): SkipConfirmation {
  const unset = items.filter((i) => !i.isSet);
  if (unset.length === 0) return { needed: false };
  return {
    needed: true,
    unsetIncomeCount: unset.filter((i) => i.type === 'income').length,
    unsetExpenseCount: unset.filter((i) => i.type === 'expense').length,
  };
}
