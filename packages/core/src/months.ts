/**
 * months.ts — YYYY-MM month arithmetic and the navigable month range.
 *
 * Moved here from the web app (2026-10-15) so the Expo app's month
 * navigation (Home, Timeline, Cards) steps through exactly the months the
 * web pages do:
 *   - addMonthsToMonth ← src/lib/goalHelpers.ts
 *   - availableMonths  ← src/lib/timelineDisplayHelpers.ts
 * Both web files re-export from here, so no web import site changed.
 *
 * Pure string arithmetic on 'YYYY-MM'. No Date, no timezone: the month a
 * household is IN comes from businessMonth(); these only step from it.
 */

/** Adds `months` calendar months to a YYYY-MM (or YYYY-MM-DD) month, returning YYYY-MM. */
export function addMonthsToMonth(month: string, months: number): string {
  const [y, m] = month.slice(0, 7).split('-').map(Number);
  const idx = (m - 1) + months;
  const targetYear = y + Math.floor(idx / 12);
  const targetMonth = ((idx % 12) + 12) % 12;
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}`;
}

/**
 * The full list of navigable YYYY-MM months for a fetched timeline result:
 * balancesStartDate's month through windowEnd's month, inclusive.
 */
export function availableMonths(balancesStartDate: string, windowEnd: string): string[] {
  const months: string[] = [];
  let cursor = balancesStartDate.slice(0, 7);
  const end = windowEnd.slice(0, 7);
  while (cursor <= end) {
    months.push(cursor);
    const [y, m] = cursor.split('-').map(Number);
    cursor = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }
  return months;
}

/**
 * The months a Timeline may page through: availableMonths over the fetched
 * window, with ONLY the forward end capped at the entitled horizon. A
 * household keeps every past month of its own ledger; the horizon limits
 * projection, not history.
 *
 * `horizonEndMonth` null means no cap is known (an older deployment that
 * does not send it): the window itself is the limit.
 */
export function timelineNavMonths(
  balancesStartDate: string,
  windowEnd: string,
  horizonEndMonth: string | null
): string[] {
  const all = availableMonths(balancesStartDate, windowEnd);
  return horizonEndMonth ? all.filter((month) => month <= horizonEndMonth) : all;
}

/**
 * Where Previous and Next go from `month` in an ascending month list: the
 * nearest listed month before it and after it, or null at either end.
 *
 * `month` need not be in the list. A Timeline whose first known balance is
 * after today still opens on the current month (to say when balances
 * begin), and from there Next must reach the first listed month.
 */
export function monthNeighbours(
  months: readonly string[],
  month: string
): { previous: string | null; next: string | null } {
  let previous: string | null = null;
  let next: string | null = null;
  for (const candidate of months) {
    if (candidate < month) previous = candidate;
    else if (candidate > month && next === null) next = candidate;
  }
  return { previous, next };
}
