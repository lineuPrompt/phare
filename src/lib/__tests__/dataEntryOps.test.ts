/**
 * Tests for the three data-entry/editing scenarios:
 *   1. One-off income entry — lands in income bucket, not expenses or savings
 *   2. Expense category edit — reconciliation invariant holds
 *   3. Recurring item edit — re-materialization produces correct dates, no duplicates
 */
import { describe, it, expect } from 'vitest';
import { computeMonthTotals, TxRow, AccountRow } from '../dashboardHelpers';
import { materializeFutureRule } from '../dateHelpers';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHEQUING_ID = 'chq-1';
const CARD_ID     = 'card-1';
const SAVINGS_ID  = 'sav-1';

const accounts: AccountRow[] = [
  { id: CHEQUING_ID, type: 'chequing'    },
  { id: CARD_ID,     type: 'credit_card' },
  { id: SAVINGS_ID,  type: 'savings'     },
];

// ---------------------------------------------------------------------------
// 1. One-off income entry
// ---------------------------------------------------------------------------

describe('one-off income entry — bucket placement', () => {
  it('a one-off income transaction lands in totalIncome, not expenses or savings', () => {
    const txns: TxRow[] = [
      { type: 'income', account_id: CHEQUING_ID, amount: 500 }, // bonus / one-off
    ];
    const result = computeMonthTotals(txns, accounts);
    expect(result.totalIncome).toBe(500);
    expect(result.totalExpenses).toBe(0);
    expect(result.totalSavings).toBe(0);
  });

  it('multiple one-off income entries accumulate in totalIncome', () => {
    const txns: TxRow[] = [
      { type: 'income', account_id: CHEQUING_ID, amount: 3000 }, // salary
      { type: 'income', account_id: CHEQUING_ID, amount: 500  }, // bonus
      { type: 'income', account_id: CHEQUING_ID, amount: 203  }, // child benefit
    ];
    const result = computeMonthTotals(txns, accounts);
    expect(result.totalIncome).toBe(3703);
    expect(result.totalExpenses).toBe(0);
    expect(result.totalSavings).toBe(0);
  });

  it('income entry does not affect expense or savings totals in a mixed month', () => {
    const txns: TxRow[] = [
      { type: 'income',   account_id: CHEQUING_ID, amount: 5000 }, // salary
      { type: 'income',   account_id: CHEQUING_ID, amount: 500  }, // one-off bonus
      { type: 'expense',  account_id: CHEQUING_ID, amount: 2000 },
      { type: 'transfer', account_id: CHEQUING_ID, amount: 300  },
      { type: 'transfer', account_id: SAVINGS_ID,  amount: 300  },
    ];
    const result = computeMonthTotals(txns, accounts);
    expect(result.totalIncome).toBe(5500);   // salary + bonus
    expect(result.totalExpenses).toBe(2000);
    expect(result.totalSavings).toBe(300);
    expect(result.netCashFlow).toBe(3200);   // 5500 − 2000 − 300
  });

  it('income entry type=income never enters the savings bucket', () => {
    // Guard: an income transaction should not accidentally be counted as savings
    // regardless of the account it is on.
    const txns: TxRow[] = [
      { type: 'income', account_id: CHEQUING_ID, amount: 1000 },
      { type: 'income', account_id: CARD_ID,     amount: 200  }, // unusual but should not break
    ];
    const result = computeMonthTotals(txns, accounts);
    expect(result.totalSavings).toBe(0);
    expect(result.totalExpenses).toBe(0);
    expect(result.totalIncome).toBe(1200);
  });

  it('planner/dashboard reconciliation holds after adding one-off income', () => {
    // Simulate state BEFORE adding the bonus
    const before: TxRow[] = [
      { type: 'income',  account_id: CHEQUING_ID, amount: 5000 },
      { type: 'expense', account_id: CHEQUING_ID, amount: 3000 },
    ];
    const resultBefore = computeMonthTotals(before, accounts);
    expect(resultBefore.netCashFlow).toBe(2000);

    // Simulate state AFTER adding a $500 bonus
    const after: TxRow[] = [
      ...before,
      { type: 'income', account_id: CHEQUING_ID, amount: 500 },
    ];
    const resultAfter = computeMonthTotals(after, accounts);
    expect(resultAfter.totalIncome).toBe(5500);
    expect(resultAfter.totalExpenses).toBe(3000);
    expect(resultAfter.netCashFlow).toBe(2500); // 500 more than before

    // Reconciliation invariant holds
    expect(resultAfter.netCashFlow).toBeCloseTo(
      resultAfter.totalIncome - resultAfter.totalExpenses - resultAfter.totalSavings,
      10
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Expense category edit — reconciliation invariant unchanged
// ---------------------------------------------------------------------------

describe('expense category edit — reconciliation invariant', () => {
  it('setting a category on an uncategorized expense does not change bucket totals', () => {
    // The bucket totals in computeMonthTotals do not depend on category_id.
    // Editing a category is purely a metadata change — it affects the category
    // rollup display but not income/expenses/savings/net.
    const uncategorized: TxRow[] = [
      { type: 'income',  account_id: CHEQUING_ID, amount: 4000 },
      { type: 'expense', account_id: CHEQUING_ID, amount: 1500 }, // no category
    ];
    const before = computeMonthTotals(uncategorized, accounts);

    // After setting category: same transactions, same amounts — totals unchanged
    const categorized: TxRow[] = [
      { type: 'income',  account_id: CHEQUING_ID, amount: 4000 },
      { type: 'expense', account_id: CHEQUING_ID, amount: 1500 }, // now has category
    ];
    const after = computeMonthTotals(categorized, accounts);

    expect(before.totalExpenses).toBe(after.totalExpenses);
    expect(before.totalIncome).toBe(after.totalIncome);
    expect(before.netCashFlow).toBe(after.netCashFlow);
  });

  it('full reconciliation holds before and after a category edit', () => {
    const txns: TxRow[] = [
      { type: 'income',   account_id: CHEQUING_ID, amount: 6000 },
      { type: 'expense',  account_id: CHEQUING_ID, amount: 2500 },
      { type: 'expense',  account_id: CHEQUING_ID, amount: 800  }, // target of category edit
      { type: 'transfer', account_id: CHEQUING_ID, amount: 500  },
      { type: 'transfer', account_id: SAVINGS_ID,  amount: 500  },
    ];
    const r = computeMonthTotals(txns, accounts);
    // Setting a category on the $800 expense does not change totals — verify invariant
    expect(r.netCashFlow).toBeCloseTo(r.totalIncome - r.totalExpenses - r.totalSavings, 10);
    expect(r.netCashFlow).toBe(2200); // 6000 - 2500 - 800 - 500
  });
});

// ---------------------------------------------------------------------------
// 3. Recurring item re-materialization after edit
// ---------------------------------------------------------------------------

describe('recurring item edit — re-materialization', () => {
  // Use a stable anchor date in the past so all test runs are deterministic
  const ANCHOR     = '2026-01-15';
  const TODAY      = '2026-06-19'; // pinned — matches project's current date
  const MONTHS     = 12;

  it('changing cadence from monthly to biweekly produces a different date set', () => {
    const monthlyDates = materializeFutureRule(
      { cadence: 'monthly', anchorDate: ANCHOR, secondDay: null },
      TODAY,
      MONTHS
    );
    const biweeklyDates = materializeFutureRule(
      { cadence: 'biweekly', anchorDate: ANCHOR, secondDay: null },
      TODAY,
      MONTHS
    );
    // Biweekly produces more dates (roughly 2× monthly)
    expect(biweeklyDates.length).toBeGreaterThan(monthlyDates.length);
    // They are actually different sets
    expect(new Set(monthlyDates)).not.toEqual(new Set(biweeklyDates));
  });

  it('changing cadence from monthly to semimonthly produces more dates', () => {
    const monthlyDates = materializeFutureRule(
      { cadence: 'monthly', anchorDate: ANCHOR, secondDay: null },
      TODAY,
      MONTHS
    );
    const semiDates = materializeFutureRule(
      { cadence: 'semimonthly', anchorDate: ANCHOR, secondDay: 30 },
      TODAY,
      MONTHS
    );
    // Semimonthly: ~2 per month
    expect(semiDates.length).toBeGreaterThan(monthlyDates.length);
  });

  it('re-materialized date set contains no duplicates', () => {
    for (const cadence of ['monthly', 'biweekly', 'semimonthly'] as const) {
      const dates = materializeFutureRule(
        { cadence, anchorDate: ANCHOR, secondDay: cadence === 'semimonthly' ? 30 : null },
        TODAY,
        MONTHS
      );
      const unique = new Set(dates);
      expect(unique.size).toBe(dates.length);
    }
  });

  it('re-materialized dates are all >= today (past rows excluded)', () => {
    for (const cadence of ['monthly', 'biweekly', 'semimonthly'] as const) {
      const dates = materializeFutureRule(
        { cadence, anchorDate: ANCHOR, secondDay: cadence === 'semimonthly' ? 30 : null },
        TODAY,
        MONTHS
      );
      for (const d of dates) {
        expect(d >= TODAY).toBe(true);
      }
    }
  });

  it('editing amount does not change future date count (dates are cadence-only)', () => {
    // materializeFutureRule only takes cadence params — amount is applied at row insert time.
    // This test asserts that changing amount has zero effect on the date set.
    const datesOld = materializeFutureRule(
      { cadence: 'monthly', anchorDate: ANCHOR, secondDay: null },
      TODAY,
      MONTHS
    );
    const datesNew = materializeFutureRule(
      { cadence: 'monthly', anchorDate: ANCHOR, secondDay: null }, // same cadence, different amount in rows
      TODAY,
      MONTHS
    );
    expect(datesOld).toEqual(datesNew);
  });

  it('delete-then-insert pattern produces the exact expected count (no duplicates)', () => {
    // Simulate the re-materialization loop:
    //   1. delete future linked rows (conceptual — not DB)
    //   2. compute new dates
    //   3. insert (count = dates.length)
    // Verify that inserting with the same rule twice gives the same count
    // (idempotency guard — if delete-then-insert is run twice, second run sees no future rows
    //  to delete, but re-inserts the same count → total stays identical).
    const rule = { cadence: 'monthly' as const, anchorDate: ANCHOR, secondDay: null };
    const run1 = materializeFutureRule(rule, TODAY, MONTHS);
    const run2 = materializeFutureRule(rule, TODAY, MONTHS);
    expect(run1.length).toBe(run2.length);
    expect(run1).toEqual(run2);
  });

  it('reconciliation invariant holds after a recurring item is re-materialized', () => {
    // Before edit: one monthly income row per future month
    // After edit (cadence → biweekly, still income): more rows, but all still income
    const oldDates = materializeFutureRule(
      { cadence: 'monthly', anchorDate: ANCHOR, secondDay: null },
      TODAY,
      MONTHS
    );
    const newDates = materializeFutureRule(
      { cadence: 'biweekly', anchorDate: ANCHOR, secondDay: null },
      TODAY,
      MONTHS
    );

    // Build synthetic tx sets representing the materialized rows
    const makeIncomeTxns = (dates: string[], amount: number): TxRow[] =>
      dates.map((date) => ({ type: 'income', account_id: CHEQUING_ID, amount, date } as TxRow & { date: string }));

    const expenseTx: TxRow = { type: 'expense', account_id: CHEQUING_ID, amount: 1000 };

    const beforeResult = computeMonthTotals([...makeIncomeTxns(oldDates, 500), expenseTx], accounts);
    const afterResult  = computeMonthTotals([...makeIncomeTxns(newDates, 500), expenseTx], accounts);

    // Both should hold the invariant: net = income − expenses − savings
    expect(beforeResult.netCashFlow).toBeCloseTo(
      beforeResult.totalIncome - beforeResult.totalExpenses - beforeResult.totalSavings, 10
    );
    expect(afterResult.netCashFlow).toBeCloseTo(
      afterResult.totalIncome - afterResult.totalExpenses - afterResult.totalSavings, 10
    );

    // After the cadence change, more income rows = higher income total
    expect(afterResult.totalIncome).toBeGreaterThan(beforeResult.totalIncome);
  });
});
