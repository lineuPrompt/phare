// ---------------------------------------------------------------------------
// Tapping the month name on Home opens that month in the Timeline, and the
// other way round (Lineu, 2026-10-17).
//
// The month travels as a route param, with `at` (when it was tapped) beside
// it. Without `at`, tapping the same month twice — after paging away on the
// other tab — would send the same params, the screen would see no change,
// and nothing would happen.
//
// Each screen accepts a requested month only if it is in that screen's OWN
// range (Home and the Timeline have different ones: the Timeline starts at
// the first known balance, Home stops at the horizon). A month outside it is
// ignored, so the screen stays where it is rather than showing a month it
// has no figures for.
// ---------------------------------------------------------------------------

export type MonthLinkParams = { month: string; at: string };

export function monthLinkParams(month: string, now: () => number = Date.now): MonthLinkParams {
  return { month, at: String(now()) };
}

const MONTH = /^\d{4}-\d{2}$/;

/**
 * The month a screen should jump to for these params, or null. `lastAt` is
 * the `at` this screen last acted on: the same request is never applied twice
 * (a refresh or re-render must not pull the screen back).
 */
export function requestedMonth(
  params: { month?: string | string[]; at?: string | string[] },
  months: readonly string[],
  lastAt: string | null
): string | null {
  const month = Array.isArray(params.month) ? params.month[0] : params.month;
  const at = Array.isArray(params.at) ? params.at[0] : params.at;
  if (!month || !at || at === lastAt) return null;
  if (!MONTH.test(month) || !months.includes(month)) return null;
  return month;
}
