import { describe, it, expect } from 'vitest';
import { dedupeSinkingFunds, assembleCalculatedBudget, hasNonMonthlyLines, buildCalculatedFromFormLines } from '../planHelpers';
import { runPlausibilityGuard } from '../plausibilityGuard';

describe('dedupeSinkingFunds', () => {
  it('removes an expense category that matches a sinking fund', () => {
    const categories = [
      { name: 'Groceries', type: 'expense' },
      { name: 'Property tax', type: 'expense' },
    ];
    const sinkingFunds = [{ name: 'Property tax' }];
    const result = dedupeSinkingFunds(categories, sinkingFunds);
    expect(result).toEqual([{ name: 'Groceries', type: 'expense' }]);
  });

  it('always keeps income categories even if names collide', () => {
    const categories = [
      { name: 'Property tax', type: 'income' }, // contrived, but income is protected
    ];
    const sinkingFunds = [{ name: 'Property tax' }];
    const result = dedupeSinkingFunds(categories, sinkingFunds);
    expect(result).toHaveLength(1);
  });

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    const categories = [
      { name: '  PROPERTY TAX  ', type: 'expense' },
      { name: 'Restaurants', type: 'expense' },
    ];
    const sinkingFunds = [{ name: 'property tax' }];
    const result = dedupeSinkingFunds(categories, sinkingFunds);
    expect(result.map((c) => c.name)).toEqual(['Restaurants']);
  });

  it('keeps everything when there are no sinking funds', () => {
    const categories = [
      { name: 'Groceries', type: 'expense' },
      { name: 'Salary', type: 'income' },
    ];
    const result = dedupeSinkingFunds(categories, []);
    expect(result).toHaveLength(2);
  });

  it('removes multiple matching categories', () => {
    const categories = [
      { name: 'Property tax', type: 'expense' },
      { name: 'Christmas', type: 'expense' },
      { name: 'Groceries', type: 'expense' },
    ];
    const sinkingFunds = [{ name: 'Property tax' }, { name: 'Christmas' }];
    const result = dedupeSinkingFunds(categories, sinkingFunds);
    expect(result.map((c) => c.name)).toEqual(['Groceries']);
  });

  it('preserves the budgeted field on kept categories', () => {
    const categories = [
      { name: 'Groceries', type: 'expense', budgeted: 600 },
      { name: 'Property tax', type: 'expense', budgeted: 350 },
    ];
    const sinkingFunds = [{ name: 'Property tax' }];
    const result = dedupeSinkingFunds(categories, sinkingFunds);
    expect(result).toEqual([{ name: 'Groceries', type: 'expense', budgeted: 600 }]);
  });
});

// ---------------------------------------------------------------------------
// assembleCalculatedBudget — three-bucket invariant
// ---------------------------------------------------------------------------

describe('assembleCalculatedBudget', () => {
  const calculated = {
    income:   { total: 5000, lines: [{ label: 'Salary', amount: 5000 }] },
    expenses: {
      total: 3000,
      lines: [
        { label: 'Rent',      amount: 2000 },
        { label: 'Groceries', amount: 1000 },
      ],
    },
  };

  it('totalSavings is 0 — savings come from real transfers, not from the residual', () => {
    const budget = assembleCalculatedBudget(calculated);
    expect(budget.totalSavings).toBe(0);
  });

  it('totalSavings is NOT income − expenses (guard against the old wrong formula)', () => {
    const budget = assembleCalculatedBudget(calculated);
    const wrongValue = budget.totalIncome - budget.totalExpenses; // 2000
    expect(budget.totalSavings).not.toBe(wrongValue);
  });

  it('totalIncome and totalExpenses come directly from the source', () => {
    const budget = assembleCalculatedBudget(calculated);
    expect(budget.totalIncome).toBe(5000);
    expect(budget.totalExpenses).toBe(3000);
  });

  it('categories contain all income and expense lines with correct types', () => {
    const budget = assembleCalculatedBudget(calculated);
    const income  = budget.categories.filter((c) => c.type === 'income');
    const expense = budget.categories.filter((c) => c.type === 'expense');
    expect(income).toHaveLength(1);
    expect(income[0]).toEqual({ name: 'Salary', budgeted: 5000, type: 'income' });
    expect(expense).toHaveLength(2);
  });

  it('three-bucket invariant: income − expenses − savings equals the implied net', () => {
    const budget = assembleCalculatedBudget(calculated);
    // With savings=0, implied net = income − expenses
    const impliedNet = budget.totalIncome - budget.totalExpenses - budget.totalSavings;
    expect(impliedNet).toBe(2000); // 5000 − 3000 − 0
  });

  it('handles zero income correctly (savings stays 0, not negative)', () => {
    const zeroIncome = {
      income:   { total: 0, lines: [] },
      expenses: { total: 500, lines: [{ label: 'Rent', amount: 500 }] },
    };
    const budget = assembleCalculatedBudget(zeroIncome);
    expect(budget.totalSavings).toBe(0);
    expect(budget.totalIncome).toBe(0);
    expect(budget.totalExpenses).toBe(500);
  });

  // ---------------------------------------------------------------------------
  // Manual and template must produce indistinguishable ledgers: rawAmount and
  // frequency have to survive assembleCalculatedBudget for BOTH income and
  // expense lines, same as a template row already carries them.
  // ---------------------------------------------------------------------------

  it('carries rawAmount + frequency through for a non-monthly expense line (manual bi-weekly mortgage)', () => {
    const calc = {
      income:   { total: 5000, lines: [{ label: 'Salary', amount: 5000 }] },
      expenses: {
        total: 3250,
        lines: [{ label: 'Mortgage', amount: 3250, rawAmount: 1500, frequency: 'biweekly' as const }],
      },
    };
    const budget = assembleCalculatedBudget(calc);
    const mortgage = budget.categories.find((c) => c.name === 'Mortgage');
    expect(mortgage).toEqual({
      name: 'Mortgage', budgeted: 3250, type: 'expense', rawAmount: 1500, frequency: 'biweekly',
    });
  });

  it('carries rawAmount + frequency through for a non-monthly income line', () => {
    const calc = {
      income: {
        total: 5195.34,
        lines: [{ label: 'Salary', amount: 5195.34, rawAmount: 2397.85, frequency: 'biweekly' as const }],
      },
      expenses: { total: 0, lines: [] },
    };
    const budget = assembleCalculatedBudget(calc);
    const salary = budget.categories.find((c) => c.name === 'Salary');
    expect(salary).toEqual({
      name: 'Salary', budgeted: 5195.34, type: 'income', rawAmount: 2397.85, frequency: 'biweekly',
    });
  });

  it('a plain monthly line (no rawAmount/frequency given) stays exactly as before', () => {
    const calc = {
      income:   { total: 5000, lines: [{ label: 'Salary', amount: 5000 }] },
      expenses: { total: 2000, lines: [{ label: 'Rent', amount: 2000 }] },
    };
    const budget = assembleCalculatedBudget(calc);
    expect(budget.categories).toEqual([
      { name: 'Salary', budgeted: 5000, type: 'income' },
      { name: 'Rent', budgeted: 2000, type: 'expense' },
    ]);
  });
});

describe('hasNonMonthlyLines', () => {
  it('is true when an income category has a non-monthly frequency', () => {
    const categories = [
      { type: 'income', frequency: 'biweekly' as const },
      { type: 'expense', frequency: 'monthly' as const },
    ];
    expect(hasNonMonthlyLines(categories, 'income')).toBe(true);
    expect(hasNonMonthlyLines(categories, 'expense')).toBe(false);
  });

  it('is false when every line of that type is monthly or has no frequency at all', () => {
    const categories = [
      { type: 'income', frequency: 'monthly' as const },
      { type: 'income' }, // no frequency field — a plain, exact monthly line
      { type: 'expense', frequency: 'monthly' as const },
    ];
    expect(hasNonMonthlyLines(categories, 'income')).toBe(false);
    expect(hasNonMonthlyLines(categories, 'expense')).toBe(false);
  });

  it('is false for an empty category list', () => {
    expect(hasNonMonthlyLines([], 'income')).toBe(false);
  });

  it('only counts non-monthly lines of the requested type — an expense-only deficit does not flag the income tile', () => {
    const categories = [
      { type: 'income', frequency: 'monthly' as const },
      { type: 'expense', frequency: 'biweekly' as const },
    ];
    expect(hasNonMonthlyLines(categories, 'income')).toBe(false);
    expect(hasNonMonthlyLines(categories, 'expense')).toBe(true);
  });
});

describe('buildCalculatedFromFormLines', () => {
  it('converts a bi-weekly mortgage to its monthly equivalent, carrying rawAmount + frequency', () => {
    const result = buildCalculatedFromFormLines(
      [{ label: 'Salary', amount: '5000', frequency: 'monthly' }],
      [{ label: 'Mortgage', amount: '3000', frequency: 'biweekly' }],
    );
    expect(result.income).toEqual({
      detected: true,
      lines: [{ label: 'Salary', amount: 5000, rawAmount: 5000, frequency: 'monthly' }],
      total: 5000,
    });
    expect(result.expenses.lines).toEqual([
      { label: 'Mortgage', amount: 6500, rawAmount: 3000, frequency: 'biweekly' },
    ]);
    expect(result.expenses.total).toBe(6500);
    expect(result.netCashFlow).toBe(-1500);
  });

  it('ignores blank lines (no label, no amount)', () => {
    const result = buildCalculatedFromFormLines(
      [{ label: '', amount: '', frequency: 'monthly' }],
      [{ label: '', amount: '', frequency: 'monthly' }],
    );
    expect(result.income).toEqual({ detected: false, lines: [], total: 0 });
    expect(result.expenses).toEqual({ detected: false, lines: [], total: 0 });
  });
});

// ---------------------------------------------------------------------------
// Manual-path plausibility guard — the founder's live-tested deficit scenario
// ($5,000 income, a $6,500/mo-equivalent bi-weekly mortgage) must trigger the
// exact same deficit-must-be-financed check the template path already has,
// wired through the identical buildCalculatedFromFormLines() → runPlausibilityGuard()
// path submitForm() calls in upload/page.tsx.
// ---------------------------------------------------------------------------

describe('manual-path plausibility guard (buildCalculatedFromFormLines + runPlausibilityGuard)', () => {
  it('a structural deficit with no debt-servicing line fires the guard', () => {
    const calculated = buildCalculatedFromFormLines(
      [{ label: 'Salary', amount: '5000', frequency: 'monthly' }],
      [{ label: 'Mortgage', amount: '3000', frequency: 'biweekly' }], // $6,500/mo-equivalent
    );
    const guard = runPlausibilityGuard({
      computedMonthlyIncome: calculated.income.total,
      netCashFlow: calculated.netCashFlow,
      expenseLines: calculated.expenses.lines,
      statedCombinedAnnual: null,
    });
    expect(guard.ok).toBe(false);
    if (!guard.ok) {
      expect(guard.issues).toContainEqual({ prong: 'deficit_not_financed', monthlyDeficit: 1500 });
    }
  });

  it('a balanced manual entry produces no friction', () => {
    const calculated = buildCalculatedFromFormLines(
      [{ label: 'Salary', amount: '5000', frequency: 'monthly' }],
      [{ label: 'Rent', amount: '2000', frequency: 'monthly' }],
    );
    const guard = runPlausibilityGuard({
      computedMonthlyIncome: calculated.income.total,
      netCashFlow: calculated.netCashFlow,
      expenseLines: calculated.expenses.lines,
      statedCombinedAnnual: null,
    });
    expect(guard).toEqual({ ok: true });
  });

  it('a deficit serviced by a visible credit line is not flagged — the shortfall is explained', () => {
    const calculated = buildCalculatedFromFormLines(
      [{ label: 'Salary', amount: '5000', frequency: 'monthly' }],
      [
        { label: 'Mortgage', amount: '3000', frequency: 'biweekly' },
        { label: 'Line of credit minimum payment', amount: '200', frequency: 'monthly' },
      ],
    );
    const guard = runPlausibilityGuard({
      computedMonthlyIncome: calculated.income.total,
      netCashFlow: calculated.netCashFlow,
      expenseLines: calculated.expenses.lines,
      statedCombinedAnnual: null,
    });
    expect(guard).toEqual({ ok: true });
  });
});
