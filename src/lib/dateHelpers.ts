/**
 * Converts a month name (English or French, possibly within a longer string)
 * to its number 1-12. Returns null if no month is recognized.
 * Matches the FIRST month mentioned, e.g. "March & June" → 3.
 */
export function monthNameToNumber(name: string): number | null {
  const months: Record<string, number> = {
    january: 1, janvier: 1, february: 2, février: 2, march: 3, mars: 3,
    april: 4, avril: 4, may: 5, mai: 5, june: 6, juin: 6,
    july: 7, juillet: 7, august: 8, août: 8, september: 9, septembre: 9,
    october: 10, octobre: 10, november: 11, novembre: 11, december: 12, décembre: 12,
  };
  const low = (name || '').toLowerCase();
  for (const [key, num] of Object.entries(months)) {
    if (low.includes(key)) return num;
  }
  return null;
}

/**
 * Given a base date (YYYY-MM-DD) and a number of months to advance,
 * returns the resulting date as YYYY-MM-DD.
 *
 * Clamps to the last day of the target month to avoid JS Date's overflow
 * (e.g. Jan 31 + 1 month → Feb 28/29, not March 3).
 */
export function addMonths(baseDate: string, monthsAhead: number): string {
  const [y, m, d] = baseDate.split('-').map(Number);
  // Target year/month (0-indexed month for arithmetic)
  const targetMonthIndex = (m - 1) + monthsAhead;
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12; // 0-11, safe for negatives

  // Last day of the target month
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  const day = Math.min(d, lastDay);

  const mm = String(targetMonth + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
}

/**
 * Builds the list of dates for a recurring expense.
 * count = how many occurrences, starting from baseDate, one per month.
 */
export function recurrenceDates(baseDate: string, count: number): string[] {
  const dates: string[] = [];
  for (let i = 0; i < count; i++) {
    dates.push(addMonths(baseDate, i));
  }
  return dates;
}

/**
 * Given a recurring rule and a target month (YYYY-MM), returns the dates
 * within that month on which the rule occurs (YYYY-MM-DD strings).
 *
 * - monthly: once a month, on the anchor's day (clamped to month end)
 * - semimonthly: twice a month, on anchorDay and secondDay (clamped)
 * - biweekly: every 14 days from the anchor date; returns any that land in the month
 * - weekly: every 7 days from the anchor date; returns any that land in the month
 */
export function occurrencesInMonth(
  rule: {
    cadence: 'monthly' | 'biweekly' | 'semimonthly' | 'weekly';
    anchorDate: string;      // YYYY-MM-DD
    secondDay?: number | null;
  },
  targetMonth: string        // YYYY-MM
): string[] {
  const [ty, tm] = targetMonth.split('-').map(Number);
  const lastDay = new Date(ty, tm, 0).getDate(); // last day of target month

  const clampDay = (day: number) =>
    `${targetMonth}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;

  if (rule.cadence === 'monthly') {
    const anchorDay = Number(rule.anchorDate.split('-')[2]);
    return [clampDay(anchorDay)];
  }

  if (rule.cadence === 'semimonthly') {
    const anchorDay = Number(rule.anchorDate.split('-')[2]);
    const second = rule.secondDay ?? anchorDay;
    const days = [...new Set([anchorDay, second])].sort((a, b) => a - b);
    return days.map(clampDay);
  }

  // weekly/biweekly: step 7 or 14 days from anchor, collect those landing in target month
  const step = rule.cadence === 'weekly' ? 7 : 14;
  const anchor = new Date(rule.anchorDate + 'T00:00:00');
  const monthStart = new Date(ty, tm - 1, 1);
  const monthEnd = new Date(ty, tm - 1, lastDay);

  const dates: string[] = [];
  const cursor = new Date(anchor);

  // Wind forward/backward to near the month in step-sized increments
  while (cursor > monthStart) cursor.setDate(cursor.getDate() - step);
  while (cursor < monthStart) cursor.setDate(cursor.getDate() + step);

  while (cursor <= monthEnd) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + step);
  }

  return dates;
}

/**
 * Expands a recurring rule into all occurrence dates across a window of
 * months, starting from startMonth (YYYY-MM) for `monthCount` months.
 * Returns a flat, sorted list of YYYY-MM-DD dates.
 */
export function materializeRule(
  rule: {
    cadence: 'monthly' | 'biweekly' | 'semimonthly' | 'weekly';
    anchorDate: string;
    secondDay?: number | null;
  },
  startMonth: string,   // YYYY-MM
  monthCount: number
): string[] {
  const [sy, sm] = startMonth.split('-').map(Number);
  const all: string[] = [];

  for (let i = 0; i < monthCount; i++) {
    const monthIndex = (sm - 1) + i;
    const year = sy + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const targetMonth = `${year}-${String(month).padStart(2, '0')}`;
    all.push(...occurrencesInMonth(rule, targetMonth));
  }

  // Dedupe (biweekly edges can't double here, but safe) and sort
  return [...new Set(all)].sort();
}

export function formatLocalDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function formatLocalMonth(date: Date): string {
  return formatLocalDate(date).slice(0, 7);
}

/**
 * Expands a recurring rule into all occurrence dates from the START of the
 * reference date's month through `monthCount` months forward.
 *
 * Months are real, not averaged: a payment that already happened earlier
 * this month — before an anchor was set, or before an edit was made today —
 * is still a real occurrence for this month and must not be dropped. This
 * replaces the old "future-only" filter (date >= today), which silently
 * discarded any legitimate occurrence between the 1st of the month and
 * today whenever an anchor was set or edited after the month had begun
 * (e.g. a bi-weekly mortgage anchored on the 9th was missing its 1st-of-
 * month payment; a semi-monthly item anchored after the 15th was missing
 * its 15th). occurrencesInMonth() already steps backward from the anchor
 * by the cadence interval to find every occurrence in a target month —
 * the bug was purely in the extra filter this function used to apply on
 * top of that.
 */
export function materializeFromMonthStart(
  rule: {
    cadence: 'monthly' | 'biweekly' | 'semimonthly' | 'weekly';
    anchorDate: string;
    secondDay?: number | null;
  },
  referenceDate: string,   // YYYY-MM-DD — only its month is used
  monthCount: number
): string[] {
  return materializeRule(rule, referenceDate.slice(0, 7), monthCount);
}

/**
 * The chequing payment for a card statement falls in the month AFTER the
 * spending month. Given a spending month (YYYY-MM) and a payment day-of-month,
 * returns the payment date (YYYY-MM-DD) in the following month, clamped to
 * month end.
 *
 * e.g. spending in 2026-06, payDay 1 → "2026-07-01"
 *      spending in 2026-12, payDay 15 → "2027-01-15"
 *      spending in 2026-01, payDay 31 → "2026-02-28" (clamped)
 */
export function bridgePaymentDate(spendMonth: string, payDay: number): string {
  const [y, m] = spendMonth.split('-').map(Number);
  // Payment month is the month after spending
  const payMonthIndex = m; // m is 1-based; the next month's 0-based index is m
  const payYear = y + Math.floor(payMonthIndex / 12);
  const payMonth0 = payMonthIndex % 12; // 0-based month of payment
  const lastDay = new Date(payYear, payMonth0 + 1, 0).getDate();
  const day = Math.min(Math.max(payDay, 1), lastDay);
  const mm = String(payMonth0 + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${payYear}-${mm}-${dd}`;
}
