/**
 * timelineDisplayHelpers.ts — Build 3 Phase 3: Cash Timeline page
 *
 * Pure functions only. Shapes buildCashTimeline's output for the UI:
 * slicing a fetched multi-month result into a single navigable month,
 * and grouping the pre-balance transactions of a mid-window first anchor.
 * No DB access, no formatting/locale text — components render the values
 * these return.
 */

import type { TimelineTx, UnbalancedDay } from '@phare/core';

// ── Moved to @phare/core (2026-09-15) ─────────────────────────────────────────
// buildMonthView, MonthView and UnbalancedDay now live in
// packages/core/src/timeline.ts, shared with the Expo app's Timeline.
// Re-exported here so no web import site had to change.
export { buildMonthView, type MonthView, type UnbalancedDay } from '@phare/core';

// ── Unbalanced days (mid-window first anchor) ──────────────────────────────

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
