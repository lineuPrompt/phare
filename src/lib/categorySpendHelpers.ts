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
 * TODAY CUTOFF (2026-07-28 fix) — actuals sum transactions dated ON OR BEFORE
 * `today` (household-timezone businessToday, passed in by the caller — this
 * file has no clock of its own), never a forward-dated row that merely
 * happens to fall within the selected calendar month. A manually-entered
 * expense two days from now is a plan, not history, even though it already
 * has a real row. For a past month this cutoff never actually excludes
 * anything (every row in a past month is already ≤ today by construction);
 * it only bites when the selected month is the current one.
 *
 * FIXED vs VARIABLE (2026-07-28) — householdCategoryActualsSplit buckets each
 * row by whether it carries `recurring_item_id` (set only by the real
 * recurring_items engine — save-plan's fixed-expense lines, and anything
 * created via the Recurring page). This is deliberately NOT `recurrence_id`,
 * a different, rarely-used column that only tags manual ExpenseForm
 * "repeat/installments" bursts — confirmed against a real household that
 * every fixed bill (mortgage, car payments, insurance) carries
 * recurring_item_id and NOT recurrence_id; splitting on the latter would have
 * left every fixed bill misclassified as variable. The split exists because
 * `budgets` rows only ever cover a category's VARIABLE portion (save-plan
 * never writes a budget row for an isFixed line) — comparing a variable-only
 * target against a fixed+variable actual is an apples-to-oranges scope
 * mismatch, not a data bug. See reportsDisplayHelpers.ts for how the two
 * buckets render (compared vs. budget / listed judgment-free).
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

// Adds recurring_item_id — the real recurring-engine linkage (see file
// header) — on top of the card-envelope EnvTx shape. Not added to EnvTx
// itself: card-envelope call sites never need it and shouldn't have to
// fabricate the field just to call categoryActualsForCard.
export type CategorySpendTx = EnvTx & { recurring_item_id?: string | null };

type SignedSpendRow = { categoryId: string; signed: number; isFixed: boolean };

// Single shared row-level filter — month scope, today cutoff, bridge
// exclusion, chequing-income exclusion, transfer exclusion — so the combined
// view (householdCategoryActuals) and the split view
// (householdCategoryActualsSplit) can never silently disagree on which rows
// qualify as spend at all; they only differ in how they bucket the same rows.
function computeSignedSpendRows(
  transactions: CategorySpendTx[],
  accounts: CategorySpendAccount[],
  month: string,
  today: string
): SignedSpendRow[] {
  const chequingIds = new Set(accounts.filter((a) => a.type === 'chequing').map((a) => a.id));

  const rows: SignedSpendRow[] = [];
  for (const t of transactions) {
    if (t.is_bridge) continue;
    if (!t.date.startsWith(month)) continue;
    if (t.date > today) continue; // plan, not history — see TODAY CUTOFF above
    if (t.type === 'income' && chequingIds.has(t.account_id)) continue; // real income, never a spend category
    const signed = signedAmount(t);
    if (signed === null) continue; // e.g. a transfer row — never a spend category, even if categorized
    rows.push({
      categoryId: t.category_id ?? UNCATEGORIZED_ROW_ID,
      signed,
      isFixed: t.recurring_item_id != null,
    });
  }
  return rows;
}

/**
 * Returns Map<category_id | UNCATEGORIZED_ROW_ID, netAmount> across ALL
 * accounts for the given month, cut off at `today` (see file header) —
 * fixed and variable spend combined. Kept for callers that want the whole
 * category total regardless of the fixed/variable split (e.g. chart B).
 * A category with real activity that nets to exactly 0 (e.g. a refund
 * cancelling a purchase) still appears, with value 0 — only categories with
 * zero activity are absent, never listed as a phantom zero.
 */
export function householdCategoryActuals(
  transactions: CategorySpendTx[],
  accounts: CategorySpendAccount[],
  month: string,
  today: string
): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of computeSignedSpendRows(transactions, accounts, month, today)) {
    map.set(r.categoryId, r2((map.get(r.categoryId) ?? 0) + r.signed));
  }
  return map;
}

export type SplitCategoryActuals = {
  variable: Map<string, number>;
  fixed: Map<string, number>;
};

/**
 * Same rows as householdCategoryActuals, partitioned by recurring_item_id
 * (see file header's FIXED vs VARIABLE) instead of combined into one map.
 * Every row lands in exactly one bucket — never both, never neither — so
 * `variable` and `fixed` always sum to exactly what householdCategoryActuals
 * would have returned for the same inputs.
 */
export function householdCategoryActualsSplit(
  transactions: CategorySpendTx[],
  accounts: CategorySpendAccount[],
  month: string,
  today: string
): SplitCategoryActuals {
  const variable = new Map<string, number>();
  const fixed = new Map<string, number>();
  for (const r of computeSignedSpendRows(transactions, accounts, month, today)) {
    const target = r.isFixed ? fixed : variable;
    target.set(r.categoryId, r2((target.get(r.categoryId) ?? 0) + r.signed));
  }
  return { variable, fixed };
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
  transactions: CategorySpendTx[],
  accounts: CategorySpendAccount[],
  month: string,
  today: string,
  categoryNames: Map<string, string>,
  uncategorizedLabel: string
): CategoryActualRow[] {
  const map = householdCategoryActuals(transactions, accounts, month, today);
  return Array.from(map.entries()).map(([categoryId, actual]) => ({
    categoryId,
    categoryName:
      categoryId === UNCATEGORIZED_ROW_ID ? uncategorizedLabel : (categoryNames.get(categoryId) ?? '?'),
    actual,
  }));
}
