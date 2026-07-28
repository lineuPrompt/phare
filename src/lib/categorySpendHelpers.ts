/**
 * Household-wide actual spend by category, for visual reports (charts A/B).
 *
 * Distinct from envelopeHelpers.categoryActualsForCard, which is deliberately
 * scoped to ONE card — this sums across every account in the household.
 *
 * THE RULE: category spend is expense-side money only. Income arriving on
 * chequing is real household income, not spending in any category — it isn't
 * "money going somewhere," so it must never appear in either chart, including
 * under Uncategorized. Income arriving on a CARD is a different thing: a
 * refund/credit against that card's own spend, which correctly reduces its
 * category's actual — the same convention Card Envelopes already uses.
 *
 * signedAmount() alone can't tell these apart — it sees "income," nets it
 * negative, full stop, which is exactly correct on a card and wrong on
 * chequing. The distinguishing signal isn't the row, it's the ACCOUNT, and
 * dashboardHelpers.computeMonthTotals already makes exactly this distinction
 * (income on chequing → totalIncome; income elsewhere → not household income).
 * This file applies the same distinction one level down, at category
 * granularity: chequing income rows are excluded before signedAmount ever
 * runs on them; every other row (chequing expense, card expense, card
 * refund) is unchanged.
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
 */

import { signedAmount, EnvTx, UNCATEGORIZED_ROW_ID } from './envelopeHelpers';

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type CategorySpendAccount = { id: string; type: string };

/**
 * Returns Map<category_id | UNCATEGORIZED_ROW_ID, netAmount> across ALL
 * accounts for the given month: expenses minus refunds (income), net, same
 * sign rule as every other envelope figure — EXCEPT a chequing-side income
 * row, which is real household income, not a refund, and is excluded before
 * netting (see file header's THE RULE). This holds regardless of whether
 * that income row happens to carry a category_id — a categorized paycheque
 * is still not spend. Bridge lines excluded (see file header). A category
 * with real activity that nets to exactly 0 (e.g. a refund cancelling a
 * purchase) still appears, with value 0 — only categories with zero activity
 * are absent, never listed as a phantom zero.
 */
export function householdCategoryActuals(
  transactions: EnvTx[],
  accounts: CategorySpendAccount[],
  month: string
): Map<string, number> {
  const chequingIds = new Set(accounts.filter((a) => a.type === 'chequing').map((a) => a.id));

  const map = new Map<string, number>();
  for (const t of transactions) {
    if (t.is_bridge) continue;
    if (!t.date.startsWith(month)) continue;
    if (t.type === 'income' && chequingIds.has(t.account_id)) continue; // real income, never a spend category
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
  accounts: CategorySpendAccount[],
  month: string,
  categoryNames: Map<string, string>,
  uncategorizedLabel: string
): CategoryActualRow[] {
  const map = householdCategoryActuals(transactions, accounts, month);
  return Array.from(map.entries()).map(([categoryId, actual]) => ({
    categoryId,
    categoryName:
      categoryId === UNCATEGORIZED_ROW_ID ? uncategorizedLabel : (categoryNames.get(categoryId) ?? '?'),
    actual,
  }));
}
