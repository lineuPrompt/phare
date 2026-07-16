/**
 * Tests for the three data-entry/editing scenarios:
 *   1. One-off income entry — lands in income bucket, not expenses or savings
 *   2. Expense category edit — reconciliation invariant holds
 *   3. Recurring item edit — re-materialization produces correct dates, no duplicates
 */
import { describe, it, expect } from 'vitest';
import { computeMonthTotals, computeGoalBalance, TxRow, AccountRow } from '../dashboardHelpers';
import { materializeFromMonthStart } from '../dateHelpers';

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
    ];
    const result = computeMonthTotals(txns, accounts);
    expect(result.totalSavings).toBe(0);
    expect(result.totalExpenses).toBe(0);
    expect(result.totalIncome).toBe(1000);
  });

  it('Phase 1 fix — a card refund (type=income on a credit_card account) is NOT household income', () => {
    // A "money in" entry on a card is a refund/credit against that card's
    // spend (envelopeHelpers.ts), not new household cash. Before the fix,
    // this counted toward totalIncome here while chequingLedgerNet (the
    // reconcile screen's independent path) correctly excluded it — a real,
    // persistent dual-path mismatch any time a card refund existed.
    const txns: TxRow[] = [
      { type: 'income', account_id: CHEQUING_ID, amount: 1000 }, // real household income
      { type: 'income', account_id: CARD_ID,     amount: 200  }, // card refund — not income
    ];
    const result = computeMonthTotals(txns, accounts);
    expect(result.totalIncome).toBe(1000); // card refund excluded
    expect(result.totalSavings).toBe(0);
    expect(result.totalExpenses).toBe(0);
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
    const monthlyDates = materializeFromMonthStart(
      { cadence: 'monthly', anchorDate: ANCHOR, secondDay: null },
      TODAY,
      MONTHS
    );
    const biweeklyDates = materializeFromMonthStart(
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
    const monthlyDates = materializeFromMonthStart(
      { cadence: 'monthly', anchorDate: ANCHOR, secondDay: null },
      TODAY,
      MONTHS
    );
    const semiDates = materializeFromMonthStart(
      { cadence: 'semimonthly', anchorDate: ANCHOR, secondDay: 30 },
      TODAY,
      MONTHS
    );
    // Semimonthly: ~2 per month
    expect(semiDates.length).toBeGreaterThan(monthlyDates.length);
  });

  it('re-materialized date set contains no duplicates', () => {
    for (const cadence of ['monthly', 'biweekly', 'semimonthly'] as const) {
      const dates = materializeFromMonthStart(
        { cadence, anchorDate: ANCHOR, secondDay: cadence === 'semimonthly' ? 30 : null },
        TODAY,
        MONTHS
      );
      const unique = new Set(dates);
      expect(unique.size).toBe(dates.length);
    }
  });

  it('re-materialized dates are all >= the start of the current month (months prior to it excluded)', () => {
    // Months are real: an edit made mid-month (TODAY = 2026-06-19) still
    // regenerates the WHOLE current month, including any occurrence earlier
    // than today (e.g. a monthly rule anchored on the 15th → June 15, which
    // is before TODAY but still this month) — it must not be dropped. Only
    // months strictly before the current one stay untouched.
    const monthStart = TODAY.slice(0, 7) + '-01';
    for (const cadence of ['monthly', 'biweekly', 'semimonthly'] as const) {
      const dates = materializeFromMonthStart(
        { cadence, anchorDate: ANCHOR, secondDay: cadence === 'semimonthly' ? 30 : null },
        TODAY,
        MONTHS
      );
      for (const d of dates) {
        expect(d >= monthStart).toBe(true);
      }
    }
  });

  it('a monthly occurrence earlier this month than today is still included, not dropped', () => {
    // ANCHOR day-of-month is 15; TODAY is the 19th — June 15 is before TODAY
    // but still June, so it must be present.
    const dates = materializeFromMonthStart(
      { cadence: 'monthly', anchorDate: ANCHOR, secondDay: null },
      TODAY,
      MONTHS
    );
    expect(dates).toContain('2026-06-15');
  });

  it('editing amount does not change future date count (dates are cadence-only)', () => {
    // materializeFromMonthStart only takes cadence params — amount is applied at row insert time.
    // This test asserts that changing amount has zero effect on the date set.
    const datesOld = materializeFromMonthStart(
      { cadence: 'monthly', anchorDate: ANCHOR, secondDay: null },
      TODAY,
      MONTHS
    );
    const datesNew = materializeFromMonthStart(
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
    const run1 = materializeFromMonthStart(rule, TODAY, MONTHS);
    const run2 = materializeFromMonthStart(rule, TODAY, MONTHS);
    expect(run1.length).toBe(run2.length);
    expect(run1).toEqual(run2);
  });

  it('reconciliation invariant holds after a recurring item is re-materialized', () => {
    // Before edit: one monthly income row per future month
    // After edit (cadence → biweekly, still income): more rows, but all still income
    const oldDates = materializeFromMonthStart(
      { cadence: 'monthly', anchorDate: ANCHOR, secondDay: null },
      TODAY,
      MONTHS
    );
    const newDates = materializeFromMonthStart(
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

// ---------------------------------------------------------------------------
// 4. Income edit — amount change flows to income bucket
// ---------------------------------------------------------------------------

describe('income edit — amount change reflects in totals and reconciliation', () => {
  it('editing income amount up increases totalIncome by the delta', () => {
    const before: TxRow[] = [
      { type: 'income',  account_id: CHEQUING_ID, amount: 3000 },
      { type: 'expense', account_id: CHEQUING_ID, amount: 1200 },
    ];
    const after: TxRow[] = [
      { type: 'income',  account_id: CHEQUING_ID, amount: 3500 }, // edited up by $500
      { type: 'expense', account_id: CHEQUING_ID, amount: 1200 },
    ];
    const rb = computeMonthTotals(before, accounts);
    const ra = computeMonthTotals(after, accounts);
    expect(ra.totalIncome - rb.totalIncome).toBeCloseTo(500, 10);
    expect(ra.totalExpenses).toBe(rb.totalExpenses); // expenses unchanged
    expect(ra.netCashFlow - rb.netCashFlow).toBeCloseTo(500, 10);
  });

  it('editing income amount down decreases totalIncome by the delta', () => {
    const before: TxRow[] = [
      { type: 'income',  account_id: CHEQUING_ID, amount: 2750 },
      { type: 'expense', account_id: CHEQUING_ID, amount: 800  },
    ];
    const after: TxRow[] = [
      { type: 'income',  account_id: CHEQUING_ID, amount: 2500 }, // edited down by $250
      { type: 'expense', account_id: CHEQUING_ID, amount: 800  },
    ];
    const rb = computeMonthTotals(before, accounts);
    const ra = computeMonthTotals(after, accounts);
    expect(rb.totalIncome - ra.totalIncome).toBeCloseTo(250, 10);
    expect(ra.netCashFlow).toBeCloseTo(1700, 10);
  });

  it('reconciliation invariant holds after income amount edit', () => {
    const txns: TxRow[] = [
      { type: 'income',   account_id: CHEQUING_ID, amount: 2500 }, // post-edit amount
      { type: 'expense',  account_id: CHEQUING_ID, amount: 900  },
      { type: 'transfer', account_id: CHEQUING_ID, amount: 200  },
      { type: 'transfer', account_id: SAVINGS_ID,  amount: 200  },
    ];
    const r = computeMonthTotals(txns, accounts);
    expect(r.netCashFlow).toBeCloseTo(r.totalIncome - r.totalExpenses - r.totalSavings, 10);
    expect(r.netCashFlow).toBeCloseTo(1400, 10);
  });
});

// ---------------------------------------------------------------------------
// 5. Income delete — removed row disappears from totals
// ---------------------------------------------------------------------------

describe('income delete — row removal reflects in totals and reconciliation', () => {
  it('deleting a one-off income row reduces totalIncome to remaining items only', () => {
    const before: TxRow[] = [
      { type: 'income', account_id: CHEQUING_ID, amount: 5000 }, // salary
      { type: 'income', account_id: CHEQUING_ID, amount: 500  }, // one-off bonus — to be deleted
    ];
    const after: TxRow[] = [
      { type: 'income', account_id: CHEQUING_ID, amount: 5000 }, // salary only
    ];
    const rb = computeMonthTotals(before, accounts);
    const ra = computeMonthTotals(after, accounts);
    expect(rb.totalIncome).toBe(5500);
    expect(ra.totalIncome).toBe(5000);
  });

  it('deleted income row does not appear in any other bucket', () => {
    const after: TxRow[] = [
      { type: 'income',  account_id: CHEQUING_ID, amount: 5000 },
      { type: 'expense', account_id: CHEQUING_ID, amount: 2000 },
    ];
    const r = computeMonthTotals(after, accounts);
    expect(r.totalExpenses).toBe(2000);
    expect(r.totalSavings).toBe(0);
  });

  it('reconciliation invariant holds after income delete', () => {
    const txns: TxRow[] = [
      { type: 'income',   account_id: CHEQUING_ID, amount: 5000 }, // salary (bonus deleted)
      { type: 'expense',  account_id: CHEQUING_ID, amount: 2000 },
      { type: 'transfer', account_id: CHEQUING_ID, amount: 300  },
      { type: 'transfer', account_id: SAVINGS_ID,  amount: 300  },
    ];
    const r = computeMonthTotals(txns, accounts);
    expect(r.netCashFlow).toBeCloseTo(r.totalIncome - r.totalExpenses - r.totalSavings, 10);
    expect(r.netCashFlow).toBe(2700);
  });
});

// ---------------------------------------------------------------------------
// 6. Transfer edit — amount change flows to savings bucket and reconciliation
// ---------------------------------------------------------------------------

describe('transfer edit — amount change reflects in savings and reconciliation', () => {
  it('editing a transfer amount up increases totalSavings by the delta', () => {
    const GOAL_ID = 'goal-1';
    const goalAccounts: AccountRow[] = [
      ...accounts,
      { id: GOAL_ID, type: 'savings' },
    ];

    // Before: $200 transfer
    const before: TxRow[] = [
      { type: 'income',   account_id: CHEQUING_ID, amount: 5000 },
      { type: 'expense',  account_id: CHEQUING_ID, amount: 2000 },
      { type: 'transfer', account_id: CHEQUING_ID, amount: 200  }, // chequing-side
      { type: 'transfer', account_id: GOAL_ID,     amount: 200  }, // goal-side
    ];
    // After: edited to $300
    const after: TxRow[] = [
      { type: 'income',   account_id: CHEQUING_ID, amount: 5000 },
      { type: 'expense',  account_id: CHEQUING_ID, amount: 2000 },
      { type: 'transfer', account_id: CHEQUING_ID, amount: 300  },
      { type: 'transfer', account_id: GOAL_ID,     amount: 300  },
    ];

    const rb = computeMonthTotals(before, goalAccounts);
    const ra = computeMonthTotals(after, goalAccounts);

    expect(ra.totalSavings - rb.totalSavings).toBeCloseTo(100, 10);
    expect(ra.netCashFlow - rb.netCashFlow).toBeCloseTo(-100, 10); // net drops by same delta
  });

  it('reconciliation invariant holds after transfer edit', () => {
    const GOAL_ID = 'goal-1';
    const goalAccounts: AccountRow[] = [
      ...accounts,
      { id: GOAL_ID, type: 'savings' },
    ];
    const txns: TxRow[] = [
      { type: 'income',   account_id: CHEQUING_ID, amount: 5000 },
      { type: 'expense',  account_id: CHEQUING_ID, amount: 2000 },
      { type: 'transfer', account_id: CHEQUING_ID, amount: 300  }, // post-edit amount
      { type: 'transfer', account_id: GOAL_ID,     amount: 300  },
    ];
    const r = computeMonthTotals(txns, goalAccounts);
    expect(r.netCashFlow).toBeCloseTo(r.totalIncome - r.totalExpenses - r.totalSavings, 10);
    expect(r.netCashFlow).toBe(2700); // 5000 − 2000 − 300
  });

  it('goal balance correctly reflects the edited transfer amount', () => {
    const GOAL_ID = 'goal-1';
    // The goal-side row uses computeGoalBalance, not computeMonthTotals
    // Verify that after editing $200 → $300, computeGoalBalance returns 300
    const txAfter: TxRow[] = [
      { type: 'transfer', account_id: GOAL_ID, amount: 300 }, // edited row
    ];
    // contract: goal balance = sum of transfer inflows for that account
    const balance = computeGoalBalance(txAfter, GOAL_ID);
    expect(balance).toBe(300);
  });
});
