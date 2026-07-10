import { describe, it, expect } from 'vitest';
import { dedupeSinkingFunds, assembleCalculatedBudget } from '../planHelpers';

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
