import { monthlyEquivalent, type IncomeFrequency } from './incomeHelpers';

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

// rawAmount/frequency are optional — present when the line has a real
// per-payment cadence (both income and expense lines can, on the manual
// form, exactly like the template); absent means "monthly, take amount as-is."
type CalculatedLine = { label: string; amount: number; rawAmount?: number; frequency?: IncomeFrequency };

export type CalculatedSource = {
  income:   { total: number; lines: CalculatedLine[] };
  expenses: { total: number; lines: CalculatedLine[] };
};

export type MonthlyBudget = {
  totalIncome:   number;
  totalExpenses: number;
  totalSavings:  number;
  categories:    Array<{ name: string; budgeted: number; type: string; rawAmount?: number; frequency?: IncomeFrequency }>;
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
/**
 * True when any category of the given type carries a non-monthly frequency —
 * meaning that bucket's total includes at least one monthlyEquivalent()
 * conversion rather than a plain sum of real monthly amounts. Drives the
 * "≈ $X/mo equivalent" labeling on the plan review's summary tiles: an
 * approximation must say so, an exact monthly sum should not.
 */
export function hasNonMonthlyLines(
  categories: { type: string; frequency?: IncomeFrequency }[],
  type: 'income' | 'expense'
): boolean {
  return categories.some((c) => c.type === type && !!c.frequency && c.frequency !== 'monthly');
}

export function assembleCalculatedBudget(c: CalculatedSource): MonthlyBudget {
  return {
    totalIncome:   c.income.total,
    totalExpenses: c.expenses.total,
    totalSavings:  0,
    categories: [
      ...c.income.lines.map((l) => ({ name: l.label, budgeted: l.amount, type: 'income' as const, rawAmount: l.rawAmount, frequency: l.frequency })),
      ...c.expenses.lines.map((l) => ({ name: l.label, budgeted: l.amount, type: 'expense' as const, rawAmount: l.rawAmount, frequency: l.frequency })),
    ],
  };
}

// ---------------------------------------------------------------------------
// Manual-form → "calculated" source assembly
// ---------------------------------------------------------------------------

export type FormLineInput = { label: string; amount: string; frequency: IncomeFrequency };

export type CalculatedBudgetResult = {
  income: { detected: boolean; lines: CalculatedLine[]; total: number };
  expenses: { detected: boolean; lines: CalculatedLine[]; total: number };
  netCashFlow: number;
  excludedLines: never[];
  confidence: 'high';
};

/**
 * Turns the manual onboarding form's raw line inputs into the same
 * {income, expenses, netCashFlow} shape /api/plan expects for the
 * "calculated" source — the pure computation behind the form's submit
 * handler, pulled out of the component specifically so the plausibility-guard
 * wiring (deficit-must-be-financed) can be tested end to end without a
 * .tsx test: feed lines in here, run the result through
 * runPlausibilityGuard(), and the whole manual-path contract is provable.
 */
export function buildCalculatedFromFormLines(
  formIncome: FormLineInput[],
  formExpenses: FormLineInput[]
): CalculatedBudgetResult {
  const incomeLines = formIncome
    .filter((l) => l.label.trim() && l.amount)
    .map((l) => {
      const rawAmount = parseFloat(l.amount);
      return { label: l.label.trim(), amount: monthlyEquivalent(rawAmount, l.frequency), rawAmount, frequency: l.frequency };
    });

  const expenseLines = formExpenses
    .filter((l) => l.label.trim() && l.amount)
    .map((l) => {
      const rawAmount = parseFloat(l.amount);
      return { label: l.label.trim(), amount: monthlyEquivalent(rawAmount, l.frequency), rawAmount, frequency: l.frequency };
    });

  const incomeTotal = incomeLines.reduce((s, l) => s + l.amount, 0);
  const expenseTotal = expenseLines.reduce((s, l) => s + l.amount, 0);

  return {
    income: { detected: incomeLines.length > 0, lines: incomeLines, total: Math.round(incomeTotal * 100) / 100 },
    expenses: { detected: expenseLines.length > 0, lines: expenseLines, total: Math.round(expenseTotal * 100) / 100 },
    netCashFlow: Math.round((incomeTotal - expenseTotal) * 100) / 100,
    excludedLines: [],
    confidence: 'high',
  };
}
