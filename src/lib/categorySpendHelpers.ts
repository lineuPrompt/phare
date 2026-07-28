/**
 * Household-wide actual spend by category, for visual reports (charts A/B).
 *
 * Distinct from envelopeHelpers.categoryActualsForCard, which is deliberately
 * scoped to ONE card — this sums across every account in the household. It
 * still reuses that file's signedAmount() convention (expense adds, income
 * nets, anything else excluded) rather than reimplementing it, so a card
 * refund nets against its category here exactly the way it already does on
 * the Card Envelopes page.
 *
 * SCOPE IS CALENDAR-MONTH, NOT CASH-FLOW MONTH — this deliberately diverges
 * from dashboardHelpers.computeMonthTotals, and the two will legitimately
 * disagree on total dollars for a month with any credit-card activity. This
 * is not a bug; it's two different questions:
 *   - computeMonthTotals.totalExpenses: cash that left the HOUSEHOLD this
 *     month (chequing + sinking-fund expense rows only). A card purchase
 *     counts the month its bridge payment lands in chequing, one card-cycle
 *     later — see dashboardHelpers.ts's DOUBLE-COUNT RULE.
 *   - householdCategoryActuals: what was actually SPENT in category X this
 *     month, regardless of which account or when the cash later settles —
 *     the natural question for "where did the money go" and "budget vs
 *     actual per category," which compare against a monthly per-category
 *     target, not a cash-flow figure.
 * Bridge rows (is_bridge=true) are excluded here for exactly this reason:
 * counting both the card's real spend this month AND next month's bridge
 * line for the same spend would double the category's total. This mirrors
 * categoryActualsForCard's own bridge exclusion, just applied household-wide
 * instead of per-card.
 *
 * The two totals DO agree whenever there is no credit-card activity in the
 * comparison window (no bridge timing shift possible) — pinned by a test
 * below alongside a second test that quantifies the expected divergence when
 * a card is involved, so a future chart disagreeing with the dashboard by
 * exactly that amount is recognized as expected, not re-investigated as a bug.
 *
 * KNOWN GAP — surfaced, not fixed, in this step
 * ----------------------------------------------
 * signedAmount() nets every income-type row negative, with no way to tell
 * "a refund against category_id" apart from "real household income." That
 * never mattered for categoryActualsForCard: it's scoped to one card, and a
 * paycheque never lands on a card (save-plan always routes income rows to
 * the chequing account, category_id: null — see save-plan/route.ts). Summing
 * household-wide means a real paycheque (type='income', category_id: null)
 * now nets NEGATIVE into the Uncategorized bucket, indistinguishable from an
 * actual refund. This is pinned by a test (categorySpendHelpers.test.ts,
 * "KNOWN GAP") rather than silently patched — deciding how to tell real
 * income apart from a refund (e.g. by account type, or by requiring income
 * rows to carry a dedicated income-type category) is a scope decision for
 * whoever wires this helper into chart B, not something to guess at here.
 */

import { signedAmount, EnvTx, UNCATEGORIZED_ROW_ID } from './envelopeHelpers';

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Returns Map<category_id | UNCATEGORIZED_ROW_ID, netAmount> across ALL
 * accounts for the given month: expenses minus refunds (income), net, same
 * sign rule as every other envelope figure. Bridge lines excluded (see file
 * header). A category with real activity that nets to exactly 0 (e.g. a
 * refund cancelling a purchase) still appears, with value 0 — only
 * categories with zero activity are absent, never listed as a phantom zero.
 */
export function householdCategoryActuals(
  transactions: EnvTx[],
  month: string
): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of transactions) {
    if (t.is_bridge) continue;
    if (!t.date.startsWith(month)) continue;
    const signed = signedAmount(t);
    if (signed === null) continue; // e.g. a transfer row — never a spend category, even if categorized
    const key = t.category_id ?? UNCATEGORIZED_ROW_ID;
    map.set(key, r2((map.get(key) ?? 0) + signed));
  }
  return map;
}

export type CategoryActualRow = {
  categoryId: string;
  categoryName: string;
  actual: number;
};

/**
 * Chart-ready shaping of householdCategoryActuals — a reshape, not a new
 * computation. categoryNames/uncategorizedLabel are supplied by the caller
 * (already locale-resolved, e.g. via categoryTranslations.categoryDisplayName)
 * so this file stays free of i18n/locale concerns.
 */
export function householdCategoryActualRows(
  transactions: EnvTx[],
  month: string,
  categoryNames: Map<string, string>,
  uncategorizedLabel: string
): CategoryActualRow[] {
  const map = householdCategoryActuals(transactions, month);
  return Array.from(map.entries()).map(([categoryId, actual]) => ({
    categoryId,
    categoryName:
      categoryId === UNCATEGORIZED_ROW_ID ? uncategorizedLabel : (categoryNames.get(categoryId) ?? '?'),
    actual,
  }));
}
