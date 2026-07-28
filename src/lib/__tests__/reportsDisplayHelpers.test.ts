import { describe, it, expect } from 'vitest';
import {
  buildBudgetVsActualRows,
  sumOverTarget,
  buildFixedCommitmentRows,
  sumFixedCommitments,
  classifyGoalProgress,
  BudgetTarget,
} from '../reportsDisplayHelpers';
import { UNCATEGORIZED_ROW_ID } from '../envelopeHelpers';

const CAT_HOUSING = 'cat-housing';
const CAT_GROCERY = 'cat-grocery';
const CAT_RESTAURANTS = 'cat-restaurants';

describe('buildBudgetVsActualRows', () => {
  const targets: BudgetTarget[] = [
    { categoryId: CAT_HOUSING, name: 'Housing', amount: 1000 },
    { categoryId: CAT_GROCERY, name: 'Groceries', amount: 400 },
  ];

  it('sorts most-over-target first', () => {
    const actuals = new Map([
      [CAT_HOUSING, 1000],  // exactly on target, overAmount 0
      [CAT_GROCERY, 600],   // 200 over
    ]);
    const rows = buildBudgetVsActualRows(targets, actuals, new Map(), 'Uncategorized');
    expect(rows[0].categoryId).toBe(CAT_GROCERY);
    expect(rows[0].overAmount).toBe(200);
    expect(rows[1].categoryId).toBe(CAT_HOUSING);
    expect(rows[1].overAmount).toBe(0);
  });

  it('a category with a target but no spend shows actual 0, overAmount 0 (never treated as over)', () => {
    const rows = buildBudgetVsActualRows(targets, new Map(), new Map(), 'Uncategorized');
    const housing = rows.find((r) => r.categoryId === CAT_HOUSING)!;
    expect(housing.actual).toBe(0);
    expect(housing.overAmount).toBe(0);
    expect(housing.hasTarget).toBe(true);
  });

  it('a category with spend but no target is included, not dropped, sorted after targeted rows', () => {
    const actuals = new Map([
      [CAT_HOUSING, 1200],       // 200 over, has target
      [CAT_RESTAURANTS, 5000],   // huge spend, NO target — must not outrank Housing despite being bigger
    ]);
    const categoryNames = new Map([[CAT_RESTAURANTS, 'Restaurants']]);
    const rows = buildBudgetVsActualRows(targets, actuals, categoryNames, 'Uncategorized');
    expect(rows[0].categoryId).toBe(CAT_HOUSING); // has a target, ranks first regardless of no-target size
    const restaurants = rows.find((r) => r.categoryId === CAT_RESTAURANTS)!;
    expect(restaurants.hasTarget).toBe(false);
    expect(restaurants.target).toBeNull();
    expect(restaurants.categoryName).toBe('Restaurants');
    expect(rows.indexOf(restaurants)).toBeGreaterThan(rows.findIndex((r) => r.hasTarget === true));
  });

  it('groups uncategorized spend under the caller-supplied label, never dropped', () => {
    const actuals = new Map([[UNCATEGORIZED_ROW_ID, 75]]);
    const rows = buildBudgetVsActualRows([], actuals, new Map(), 'Uncategorized');
    expect(rows).toHaveLength(1);
    expect(rows[0].categoryName).toBe('Uncategorized');
    expect(rows[0].hasTarget).toBe(false);
  });

  it('sumOverTarget agrees exactly with a direct reduce over the same rendered rows', () => {
    const actuals = new Map([
      [CAT_HOUSING, 1300],  // 300 over
      [CAT_GROCERY, 350],   // under, 0
    ]);
    const rows = buildBudgetVsActualRows(targets, actuals, new Map(), 'Uncategorized');
    const headline = sumOverTarget(rows);
    const manualSum = rows.reduce((s, r) => s + r.overAmount, 0);
    expect(headline).toBe(manualSum);
    expect(headline).toBe(300);
  });
});

describe('buildFixedCommitmentRows', () => {
  it('renders a plain list, no target/overAmount concept at all', () => {
    const fixed = new Map([[CAT_HOUSING, 3113.20], [CAT_GROCERY, 220.50]]);
    const rows = buildFixedCommitmentRows(fixed, new Map([[CAT_HOUSING, 'Housing'], [CAT_GROCERY, 'Transportation']]), 'Uncategorized');
    expect(rows).toEqual([
      { categoryId: CAT_HOUSING, categoryName: 'Housing', actual: 3113.20 },
      { categoryId: CAT_GROCERY, categoryName: 'Transportation', actual: 220.50 },
    ]);
  });

  it('sorts by actual descending', () => {
    const fixed = new Map([[CAT_GROCERY, 100], [CAT_HOUSING, 3000]]);
    const rows = buildFixedCommitmentRows(fixed, new Map(), 'Uncategorized');
    expect(rows[0].categoryId).toBe(CAT_HOUSING);
    expect(rows[1].categoryId).toBe(CAT_GROCERY);
  });

  it('sumFixedCommitments agrees with a direct reduce over the same rendered rows', () => {
    const fixed = new Map([[CAT_HOUSING, 3113.20], [CAT_GROCERY, 220.50]]);
    const rows = buildFixedCommitmentRows(fixed, new Map(), 'Uncategorized');
    expect(sumFixedCommitments(rows)).toBe(rows.reduce((s, r) => s + r.actual, 0));
    expect(sumFixedCommitments(rows)).toBe(3333.70);
  });

  it('a category appearing in both the variable chart and the fixed block is not double-counted in either total', () => {
    // Transportation: $75 variable spend compared against a $75 budget (on
    // target), plus $2,532.03 of fixed car payments/insurance listed
    // separately with no target — the real household shape this fix targets.
    const targets: BudgetTarget[] = [{ categoryId: CAT_HOUSING, name: 'Transportation', amount: 75 }];
    const variableActuals = new Map([[CAT_HOUSING, 75]]);
    const fixedActuals = new Map([[CAT_HOUSING, 2532.03]]);

    const variableRows = buildBudgetVsActualRows(targets, variableActuals, new Map(), 'Uncategorized');
    const fixedRows = buildFixedCommitmentRows(fixedActuals, new Map([[CAT_HOUSING, 'Transportation']]), 'Uncategorized');

    expect(sumOverTarget(variableRows)).toBe(0); // exactly on budget, not "over" by the fixed amount
    expect(sumFixedCommitments(fixedRows)).toBe(2532.03);
    // Neither total absorbed the other's figure.
    expect(variableRows.find((r) => r.categoryId === CAT_HOUSING)?.actual).toBe(75);
    expect(fixedRows.find((r) => r.categoryId === CAT_HOUSING)?.actual).toBe(2532.03);
  });
});

describe('classifyGoalProgress', () => {
  const baseGoal = {
    id: 'g1', name: 'Emergency fund', isDebt: false, balance: 0,
    goalTarget: 5000 as number | null, onTrack: null as boolean | null,
    monthlyContribution: null as number | null, estimatedDate: null as string | null,
    debtPayoff: null,
  };

  it('a debt goal gets kind "debt" and no percentage, regardless of balance', () => {
    const result = classifyGoalProgress({ ...baseGoal, isDebt: true, balance: -2000, goalTarget: 0 });
    expect(result.kind).toBe('debt');
    expect(result.pct).toBeNull();
  });

  it('no target set at all → kind "noTarget", no percentage', () => {
    const result = classifyGoalProgress({ ...baseGoal, goalTarget: null });
    expect(result.kind).toBe('noTarget');
    expect(result.pct).toBeNull();
  });

  it('$0 balance with a real code-computed ETA → "notStarted", never treated as behind/failure', () => {
    const result = classifyGoalProgress({
      ...baseGoal, balance: 0, onTrack: false, // even if the raw verdict were "behind"
      monthlyContribution: 200, estimatedDate: '2027-01',
    });
    expect(result.kind).toBe('notStarted');
    expect(result.pct).toBe(0);
  });

  it('$0 balance with no target date yet is still "notStarted", not a warning state', () => {
    const result = classifyGoalProgress({
      ...baseGoal, balance: 0, onTrack: false, monthlyContribution: null, estimatedDate: null,
    });
    expect(result.kind).toBe('notStarted');
  });

  it('partial progress computes a plain percentage of target', () => {
    const result = classifyGoalProgress({ ...baseGoal, balance: 2500, goalTarget: 5000, onTrack: true });
    expect(result.kind).toBe('inProgress');
    expect(result.pct).toBe(50);
  });

  it('balance at or above target is "funded", capped at 100%', () => {
    const result = classifyGoalProgress({ ...baseGoal, balance: 6000, goalTarget: 5000 });
    expect(result.kind).toBe('funded');
    expect(result.pct).toBe(100);
  });
});
