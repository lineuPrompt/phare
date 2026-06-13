import { describe, it, expect } from 'vitest';
import { calculateFinancials, extractLabelAmountPairs } from '../calculator';

describe('calculateFinancials', () => {
  it('classifies salary as income', () => {
    const result = calculateFinancials([
      { label: 'Salaire Lineu', amount: 2968.85 },
    ]);
    expect(result.income.total).toBe(2968.85);
    expect(result.income.detected).toBe(true);
    expect(result.expenses.total).toBe(0);
  });

  it('classifies positive non-income as expense', () => {
    const result = calculateFinancials([
      { label: 'Mortgage', amount: 1283.97 },
    ]);
    expect(result.expenses.total).toBe(1283.97);
    expect(result.income.total).toBe(0);
  });

  it('excludes total/profit/percentage lines', () => {
    const result = calculateFinancials([
      { label: 'Total', amount: 5000 },
      { label: 'Lucro', amount: 1200 },
      { label: 'Housing 3', amount: 30 },
    ]);
    expect(result.expenses.total).toBe(0);
    expect(result.income.total).toBe(0);
    expect(result.excludedLines).toHaveLength(3);
  });

  it('computes net cash flow correctly', () => {
    const result = calculateFinancials([
      { label: 'Salary', amount: 5000 },
      { label: 'Rent', amount: 1500 },
      { label: 'Groceries', amount: 600 },
      { label: 'Hydro', amount: 200 },
    ]);
    expect(result.income.total).toBe(5000);
    expect(result.expenses.total).toBe(2300);
    expect(result.netCashFlow).toBe(2700);
  });

  it('flags high confidence only with income and 3+ expenses', () => {
    const lowConf = calculateFinancials([
      { label: 'Salary', amount: 5000 },
      { label: 'Rent', amount: 1500 },
    ]);
    expect(lowConf.confidence).toBe('low');

    const highConf = calculateFinancials([
      { label: 'Salary', amount: 5000 },
      { label: 'Rent', amount: 1500 },
      { label: 'Food', amount: 600 },
      { label: 'Gas', amount: 200 },
    ]);
    expect(highConf.confidence).toBe('high');
  });

  it('ignores zero and negative non-income amounts', () => {
    const result = calculateFinancials([
      { label: 'Budget target', amount: -500 },
      { label: 'Empty', amount: 0 },
    ]);
    expect(result.expenses.total).toBe(0);
    expect(result.income.total).toBe(0);
  });

  it('rounds to two decimals', () => {
    const result = calculateFinancials([
      { label: 'A', amount: 10.111 },
      { label: 'B', amount: 20.222 },
    ]);
    expect(result.expenses.total).toBe(30.33);
  });
});

describe('extractLabelAmountPairs', () => {
  it('pulls first text as label, first number as amount', () => {
    const rows = [
      ['Mortgage', 1283.97],
      ['Groceries', 'Maxi', 600],
    ];
    const pairs = extractLabelAmountPairs(rows);
    expect(pairs).toEqual([
      { label: 'Mortgage', amount: 1283.97 },
      { label: 'Groceries', amount: 600 },
    ]);
  });

  it('skips rows with no number', () => {
    const rows = [['Just text', 'more text']];
    expect(extractLabelAmountPairs(rows)).toHaveLength(0);
  });

  it('skips rows with no label', () => {
    const rows = [[123, 456]];
    expect(extractLabelAmountPairs(rows)).toHaveLength(0);
  });
});

describe('calculateFinancials — INCOME_KEYWORDS coverage', () => {
  it('recognizes child benefit as income', () => {
    const result = calculateFinancials([
      { label: 'Canada child benefit', amount: 203.50 },
    ]);
    expect(result.income.total).toBe(203.50);
  });

  it('recognizes allocation as income', () => {
    const result = calculateFinancials([
      { label: 'Allocation famille', amount: 180 },
    ]);
    expect(result.income.total).toBe(180);
  });
});