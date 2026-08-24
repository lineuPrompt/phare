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

/**
 * Drops items that got a real date from an "awaiting dates" list. Without
 * this, finishing the anchor step (setting every date) left the caller's
 * needsPayDate/awaiting-dates count exactly as it was before the step ran —
 * a stale count, not a live one — so the plan review kept showing "N
 * awaiting dates" even once N was actually 0. Anything left unresolved
 * (skipped/declined) stays counted, honestly.
 */
export function dropResolvedItems<T extends { id: string }>(items: T[], resolvedIds: string[]): T[] {
  const resolved = new Set(resolvedIds);
  return items.filter((item) => !resolved.has(item.id));
}

export type AnchorItemState = { status: string; nextPayDate: string; day1: string; day2: string };

/**
 * Which items are eligible for a single "Save all dates" submit: filled in
 * (enough input to attempt a save) and not already saved. An item left
 * blank is deliberately excluded here, never silently attempted with empty
 * data — it still flows into evaluateSkipConfirmation exactly as before.
 */
export function selectBatchSaveable<T extends { id: string; cadence: string }>(
  items: T[],
  state: Record<string, AnchorItemState>
): T[] {
  return items.filter((item) => {
    const s = state[item.id];
    if (!s || s.status === 'saved') return false;
    return item.cadence === 'semimonthly'
      ? s.day1.trim() !== '' && s.day2.trim() !== ''
      : s.nextPayDate.trim() !== '';
  });
}

/**
 * Honest per-item tally after a batch save — never just "done" when some
 * items failed. One item's validation/network error never blocks or hides
 * another's success; this is what lets the UI say so.
 */
export function summarizeBatchResult(outcomes: ('saved' | 'error')[]): { saved: number; failed: number } {
  return {
    saved: outcomes.filter((o) => o === 'saved').length,
    failed: outcomes.filter((o) => o === 'error').length,
  };
}
