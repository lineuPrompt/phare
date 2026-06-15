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