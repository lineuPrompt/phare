type BudgetCategory = { name: string; type: string; budgeted?: number };
type NamedFund = { name: string };

/**
 * A line cannot be both a monthly budget category AND a sinking fund.
 * Removes expense categories whose name matches a sinking fund.
 * Income categories are always kept.
 */
export function dedupeSinkingFunds<C extends BudgetCategory>(
  categories: C[],
  sinkingFunds: NamedFund[]
): C[] {
  const sinkingNames = new Set(
    sinkingFunds.map((f) => f.name.trim().toLowerCase())
  );
  return categories.filter(
    (cat) => cat.type === 'income' || !sinkingNames.has(cat.name.trim().toLowerCase())
  );
}

// ---------------------------------------------------------------------------
// Three-bucket budget assembly for the calculated onboarding path
// ---------------------------------------------------------------------------

export type CalculatedSource = {
  income:   { total: number; lines: Array<{ label: string; amount: number }> };
  expenses: { total: number; lines: Array<{ label: string; amount: number }> };
};

export type MonthlyBudget = {
  totalIncome:   number;
  totalExpenses: number;
  totalSavings:  number;
  categories:    Array<{ name: string; budgeted: number; type: string }>;
};

/**
 * Assemble the monthly budget snapshot for a plan built from the "calculated"
 * onboarding source (manual form or non-template file upload).
 *
 * THREE-BUCKET MODEL
 * ------------------
 *   income   = sum of income lines
 *   expenses = sum of expense lines
 *   savings  = actual transfers to goal accounts — ALWAYS 0 at plan creation
 *              (no transfers exist yet; savings appear later via /api/transfers)
 *   net      = income − expenses − savings
 *
 * totalSavings is explicitly 0, never income − expenses. Setting it to
 * income − expenses (the old residual approach) conflated "money left over"
 * with savings, which produced a wrong net once real transfers were recorded.
 */
export function assembleCalculatedBudget(c: CalculatedSource): MonthlyBudget {
  return {
    totalIncome:   c.income.total,
    totalExpenses: c.expenses.total,
    totalSavings:  0,
    categories: [
      ...c.income.lines.map((l) => ({ name: l.label, budgeted: l.amount, type: 'income'  })),
      ...c.expenses.lines.map((l) => ({ name: l.label, budgeted: l.amount, type: 'expense' })),
    ],
  };
}
