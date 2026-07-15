/**
 * timelineDisplayHelpers.ts — Build 3 Phase 3: Cash Timeline page
 *
 * Pure functions only. Shapes buildCashTimeline's output for the UI:
 * slicing a fetched multi-month result into a single navigable month,
 * and grouping the pre-balance transactions of a mid-window first anchor.
 * No DB access, no formatting/locale text — components render the values
 * these return.
 */

import type { TimelineDay, TimelineTx } from './timelineHelpers';

// ── Unbalanced days (mid-window first anchor) ──────────────────────────────

export type UnbalancedDay = {
  date: string;        // YYYY-MM-DD
  entries: TimelineTx[]; // income first, then expense/transfer — same convention as TimelineDay
};

/**
 * Groups transactions strictly before a known-balance start date, for the
 * one case buildCashTimeline deliberately omits: real entries that happened
 * before the account's first anchor within the anchor's own month. These
 * have no balance to show — never fabricate one — but must not disappear.
 *
 * rangeStart: inclusive YYYY-MM-DD (the month's first day, or windowStart)
 * rangeEndExclusive: exclusive YYYY-MM-DD (balancesStartDate)
 */
export function groupUnbalancedTransactions(
  transactions: TimelineTx[],
  rangeStart: string,
  rangeEndExclusive: string
): UnbalancedDay[] {
  const byDate = new Map<string, TimelineTx[]>();
  for (const tx of transactions) {
    if (tx.date < rangeStart || tx.date >= rangeEndExclusive) continue;
    const list = byDate.get(tx.date);
    if (list) {
      list.push(tx);
    } else {
      byDate.set(tx.date, [tx]);
    }
  }
  const rank = (type: string) => (type === 'income' ? 0 : 1);
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, entries]) => ({
      date,
      entries: [...entries].sort((a, b) => rank(a.type) - rank(b.type)),
    }));
}

// ── Month navigation range ──────────────────────────────────────────────────

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

// ── Single-month slice ───────────────────────────────────────────────────────

export type MonthView = {
  month: string;                    // YYYY-MM
  visibleDays: TimelineDay[];       // this month's days with >=1 entry, chronological
  unbalancedDays: UnbalancedDay[];  // this month's pre-balance days with entries, if any
  opensAt: number;                  // balance at the start of the month (or balancesStartDate if mid-month)
  closesAt: number;                 // balance at the end of the last known day in the month
  balancesBeginNote: boolean;       // true when balancesStartDate falls inside this month, after day 1
};

/**
 * Slices a full fetched TimelineResult (days + unbalancedDays) down to one
 * calendar month for display. Returns null when the month has no data at
 * all in this result (outside [balancesStartDate, windowEnd]) — the caller
 * uses that to disable prev/next navigation rather than render an empty
 * month that looks like zero cash.
 */
export function buildMonthView(
  days: TimelineDay[],
  unbalancedDays: UnbalancedDay[],
  openingBalance: number,
  balancesStartDate: string,
  month: string
): MonthView | null {
  const monthDays = days.filter((d) => d.date.startsWith(month));
  if (monthDays.length === 0) return null;

  const firstIdx = days.indexOf(monthDays[0]);
  const opensAt = firstIdx > 0 ? days[firstIdx - 1].endOfDayBalance : openingBalance;
  const closesAt = monthDays[monthDays.length - 1].endOfDayBalance;
  const visibleDays = monthDays.filter((d) => d.entries.length > 0);
  const monthUnbalanced = unbalancedDays.filter((d) => d.date.startsWith(month));

  const balancesBeginNote =
    balancesStartDate.slice(0, 7) === month && balancesStartDate.slice(8, 10) !== '01';

  return {
    month,
    visibleDays,
    unbalancedDays: monthUnbalanced,
    opensAt,
    closesAt,
    balancesBeginNote,
  };
}
