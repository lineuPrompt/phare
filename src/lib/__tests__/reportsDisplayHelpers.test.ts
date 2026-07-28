import { describe, it, expect } from 'vitest';
import {
  buildBudgetVsActualRows,
  sumOverTarget,
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
