/**
 * Pure display-shaping for the Reports page (chart A). No computation of
 * source figures happens here — targets come from the budgets table, actuals
 * from categorySpendHelpers.householdCategoryActualsSplit, both upstream and
 * already tested. This file only sorts, buckets, and labels what those
 * helpers already produced.
 *
 * Goal progress (formerly chart C) was removed — redundant with the
 * dashboard's GoalsCard and the Goals page itself.
 */

import { UNCATEGORIZED_ROW_ID } from './envelopeHelpers';

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Chart A — budget vs actual per category
// ---------------------------------------------------------------------------

export type BudgetTarget = { categoryId: string; name: string; amount: number };

export type BudgetVsActualRow = {
  categoryId: string;
  categoryName: string;
  // null = no budget row exists for this category this plan — never
  // invented as 0, since 0 would render as "over target" for any real spend.
  target: number | null;
  actual: number;
  // max(0, actual - target) when a target exists, else 0 — never negative,
  // so summing it across rows is always a pure "how much over" total.
  overAmount: number;
  hasTarget: boolean;
};

/**
 * Merges budget targets with actuals into one row per category.
 *
 * TREATMENT — categories with a target but no spend: included, actual: 0,
 * overAmount: 0 (never "over" for money that wasn't spent) — this is the
 * common, unremarkable case (a category on-budget with room left).
 *
 * TREATMENT — categories with spend but no target: included (never a
 * totals-only ghost, same convention as buildGrid/card-envelope elsewhere in
 * this app), target: null, hasTarget: false, sorted after every row that has
 * a target (an over/under comparison is undefined without one) — sorted
 * among themselves by actual descending, so the biggest untracked spend is
 * still the most visible one. Includes the Uncategorized bucket, using the
 * caller-supplied label (locale already resolved by the caller — this file
 * has no i18n dependency).
 *
 * Sort within the "has a target" group: most-over-target first (overAmount
 * descending), ties broken by actual descending.
 */
export function buildBudgetVsActualRows(
  targets: BudgetTarget[],
  actualsByCategory: Map<string, number>,
  categoryNames: Map<string, string>,
  uncategorizedLabel: string
): BudgetVsActualRow[] {
  const rows = new Map<string, BudgetVsActualRow>();

  for (const b of targets) {
    rows.set(b.categoryId, {
      categoryId: b.categoryId,
      categoryName: b.name,
      target: b.amount,
      actual: 0,
      overAmount: 0,
      hasTarget: true,
    });
  }

  for (const [categoryId, actual] of actualsByCategory) {
    const existing = rows.get(categoryId);
    if (existing) {
      existing.actual = actual;
      existing.overAmount = r2(Math.max(0, actual - (existing.target as number)));
      continue;
    }
    rows.set(categoryId, {
      categoryId,
      categoryName:
        categoryId === UNCATEGORIZED_ROW_ID ? uncategorizedLabel : (categoryNames.get(categoryId) ?? '?'),
      target: null,
      actual,
      overAmount: 0,
      hasTarget: false,
    });
  }

  const all = Array.from(rows.values());
  const withTarget = all
    .filter((r) => r.hasTarget)
    .sort((a, b) => b.overAmount - a.overAmount || b.actual - a.actual);
  const withoutTarget = all
    .filter((r) => !r.hasTarget)
    .sort((a, b) => b.actual - a.actual);

  return [...withTarget, ...withoutTarget];
}

/**
 * The headline "how much over budget" figure — summed directly from the same
 * rows the chart renders (one source of truth, no separate computation
 * path). Always >= 0.
 *
 * Fed ONLY variable rows (see buildFixedCommitmentRows below) — a fixed bill
 * has no target to be over, so it must never contribute to this figure.
 */
export function sumOverTarget(rows: BudgetVsActualRow[]): number {
  return r2(rows.reduce((sum, r) => sum + r.overAmount, 0));
}

// ---------------------------------------------------------------------------
// Chart A, fixed side — "Fixed commitments this month"
// ---------------------------------------------------------------------------

export type FixedCommitmentRow = {
  categoryId: string;
  categoryName: string;
  actual: number;
};

/**
 * Shapes the FIXED half of categorySpendHelpers.householdCategoryActualsSplit
 * — a plain list, judgment-free by design: no target, no over/under, no
 * color coding. A mortgage is not something to be over on (see the reports
 * route's split rationale). Sorted by actual descending, same convention as
 * the untargeted rows in buildBudgetVsActualRows. Includes Uncategorized
 * under the caller-supplied label if a fixed row somehow lacks a category
 * (never expected in practice — every recurring_items row is created with
 * one at onboarding/setup — but never silently dropped if it happens).
 */
export function buildFixedCommitmentRows(
  fixedActualsByCategory: Map<string, number>,
  categoryNames: Map<string, string>,
  uncategorizedLabel: string
): FixedCommitmentRow[] {
  return Array.from(fixedActualsByCategory.entries())
    .map(([categoryId, actual]) => ({
      categoryId,
      categoryName:
        categoryId === UNCATEGORIZED_ROW_ID ? uncategorizedLabel : (categoryNames.get(categoryId) ?? '?'),
      actual,
    }))
    .sort((a, b) => b.actual - a.actual);
}

/** Sum of a fixed-commitment block — same "reshape, don't recompute" rule. */
export function sumFixedCommitments(rows: FixedCommitmentRow[]): number {
  return r2(rows.reduce((sum, r) => sum + r.actual, 0));
}
