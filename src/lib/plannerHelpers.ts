import { computeMonthTotals, AccountRow, MonthTotals } from './dashboardHelpers';
export type { MonthTotals } from './dashboardHelpers';

/**
 * PLANNER GROUPING
 * ----------------
 * Splits chequing-centric transactions into three display sections:
 *   income   = type='income'  (any account — income lands in chequing)
 *   expenses = type='expense' AND account_id ∈ chequing  (includes bridge lines)
 *   savings  = type='transfer' AND account_id ∈ chequing  (chequing-side outflow only)
 *
 * Goal-side transfer rows (account_id ∈ goal accounts) fall through all
 * predicates intentionally — they must not appear in any section.
 *
 * Bucket totals come from computeMonthTotals (the shared tested function),
 * so section sums and totals are always consistent:
 *   Σ income.amount  = totals.totalIncome
 *   Σ expenses.amount = totals.totalExpenses
 *   Σ savings.amount  = totals.totalSavings
 *   remaining cash   = totals.netCashFlow  (never recomputed here)
 */

export type PlannerLine = {
  id: string;
  description: string;
  amount: number;
  date: string;
};

export type PlannerSections = {
  income: PlannerLine[];
  expenses: PlannerLine[];
  savings: PlannerLine[];
};

export type PlannerData = PlannerSections & {
  totals: MonthTotals;
};

/** Extended transaction row carrying display fields needed by the planner. */
export type PlannerTxRow = {
  id: string;
  amount: number | string;
  type: string;
  account_id: string | null;
  description: string | null;
  date: string;
  /** Pre-resolved goal account name for chequing-side transfer rows. */
  goalAccountName?: string;
};

export function groupPlannerSections(
  transactions: PlannerTxRow[],
  accounts: AccountRow[]
): PlannerData {
  const chequingIds = new Set(
    accounts.filter((a) => a.type === 'chequing').map((a) => a.id)
  );

  const income: PlannerLine[] = [];
  const expenses: PlannerLine[] = [];
  const savings: PlannerLine[] = [];

  for (const tx of transactions) {
    const amt = Number(tx.amount);
    const onChequing = tx.account_id !== null && chequingIds.has(tx.account_id);
    const line: PlannerLine = {
      id: tx.id,
      description: tx.goalAccountName ?? tx.description ?? '',
      amount: amt,
      date: tx.date,
    };

    if (tx.type === 'income') {
      income.push(line);
    } else if (tx.type === 'expense' && onChequing) {
      expenses.push(line);
    } else if (tx.type === 'transfer' && onChequing) {
      savings.push(line);
    }
    // Goal-side transfer rows fall through — counted in zero buckets.
  }

  const totals = computeMonthTotals(transactions, accounts);

  return { income, expenses, savings, totals };
}
