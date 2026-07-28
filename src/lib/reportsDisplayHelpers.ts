/**
 * Pure display-shaping for the Reports page (charts A and C). No computation
 * of source figures happens here — targets come from the budgets table,
 * actuals from categorySpendHelpers.householdCategoryActuals, and goal
 * figures from goalHelpers.evaluateGoals/computeDebtPayoff, all upstream and
 * already tested. This file only sorts, buckets, and labels what those
 * helpers already produced.
 */

import { UNCATEGORIZED_ROW_ID } from './envelopeHelpers';
import type { GoalAccount } from '@/components/dashboard/types';

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

// ---------------------------------------------------------------------------
// Chart C — goal progress
// ---------------------------------------------------------------------------

export type GoalProgressKind = 'debt' | 'noTarget' | 'notStarted' | 'inProgress' | 'funded';

export type GoalProgressRow = Pick<
  GoalAccount,
  'id' | 'name' | 'balance' | 'goalTarget' | 'onTrack' | 'monthlyContribution' | 'estimatedDate' | 'debtPayoff'
> & {
  kind: GoalProgressKind;
  // 0-100, null when a percentage isn't meaningful (debt has no fixed
  // baseline to bar against; noTarget has no denominator).
  pct: number | null;
};

/**
 * TREATMENT — debt goals: no progress bar. A debt's target is 0 by design
 * (dashboardHelpers.GOAL_ACCOUNT_TYPES comment) — there is no original-amount
 * baseline in GoalAccount to measure "percentage paid off" against, only the
 * current balance owed. Inventing one here would be exactly the kind of
 * figure this build must never compute. Debt goals get kind: 'debt', pct:
 * null; the component renders balance owed + debtPayoff's own
 * monthlyPayment/targetDate instead, same as the existing dashboard GoalsCard.
 *
 * TREATMENT — $0-or-negative balance (not started yet), see constraints:
 * this must never read as failure regardless of the code's onTrack verdict.
 * A goal that's behind because nothing has been saved YET is not the same
 * situation as one that's behind despite active contributions — kind:
 * 'notStarted' overrides onTrack styling entirely; the component shows the
 * plan (monthlyContribution + estimatedDate) neutrally when one exists, or a
 * plain "set a target date" prompt when it doesn't (no target date →
 * monthlyContribution/estimatedDate are null, per evaluateGoals' no_date
 * status) — never a warning color either way.
 */
export type GoalProgressInput = Pick<
  GoalAccount,
  'id' | 'name' | 'isDebt' | 'balance' | 'goalTarget' | 'onTrack' | 'monthlyContribution' | 'estimatedDate' | 'debtPayoff'
>;

export function classifyGoalProgress(goal: GoalProgressInput): GoalProgressRow {
  const base = {
    id: goal.id, name: goal.name, balance: goal.balance, goalTarget: goal.goalTarget,
    onTrack: goal.onTrack, monthlyContribution: goal.monthlyContribution,
    estimatedDate: goal.estimatedDate, debtPayoff: goal.debtPayoff,
  };

  if (goal.isDebt) {
    return { ...base, kind: 'debt', pct: null };
  }
  if (goal.goalTarget == null || goal.goalTarget <= 0) {
    return { ...base, kind: 'noTarget', pct: null };
  }
  if (goal.balance <= 0) {
    return { ...base, kind: 'notStarted', pct: 0 };
  }
  if (goal.balance >= goal.goalTarget) {
    return { ...base, kind: 'funded', pct: 100 };
  }
  return { ...base, kind: 'inProgress', pct: Math.min(100, Math.round((goal.balance / goal.goalTarget) * 100)) };
}
