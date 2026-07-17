import { describe, it, expect } from 'vitest';
import {
  computeMonthTotals,
  computeGoalBalance,
  TxRow,
  AccountRow,
} from '../dashboardHelpers';
import { reconcileMonth, ReconcileTxRow, ReconcileAccountRow } from '../reconcileHelpers';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const CHEQUING_ID = 'chq-1';
const CARD_ID     = 'card-1';
const SAVINGS_ID  = 'sav-1';
const TFSA_ID     = 'tfsa-1';
const RRSP_ID     = 'rrsp-1';

const accounts: AccountRow[] = [
  { id: CHEQUING_ID, type: 'chequing'     },
  { id: CARD_ID,     type: 'credit_card'  },
  { id: SAVINGS_ID,  type: 'savings'      },
  { id: TFSA_ID,     type: 'tfsa'         },
  { id: RRSP_ID,     type: 'rrsp'         },
];

function tx(overrides: Partial<TxRow> & { amount: number }): TxRow {
  return { type: 'expense', account_id: CHEQUING_ID, ...overrides };
}

// ---------------------------------------------------------------------------
// computeMonthTotals — baseline (existing behaviour)
// ---------------------------------------------------------------------------

describe('computeMonthTotals — baseline', () => {
  it('returns zeroes for an empty transaction list', () => {
    expect(computeMonthTotals([], accounts)).toEqual({
      totalIncome:   0,
      totalExpenses: 0,
      totalSavings:  0,
      netCashFlow:   0,
    });
  });

  it('sums only type=income transactions into totalIncome', () => {
    const txns: TxRow[] = [
      tx({ type: 'income',  account_id: CHEQUING_ID, amount: 3000 }),
      tx({ type: 'expense', account_id: CHEQUING_ID, amount: 200  }),
    ];
    expect(computeMonthTotals(txns, accounts).totalIncome).toBe(3000);
  });

  it('sums chequing expense transactions into totalExpenses', () => {
    const txns: TxRow[] = [
      tx({ type: 'expense', account_id: CHEQUING_ID, amount: 500 }),
      tx({ type: 'expense', account_id: CHEQUING_ID, amount: 300 }),
    ];
    expect(computeMonthTotals(txns, accounts).totalExpenses).toBe(800);
  });

  it('excludes card expense transactions (double-count prevention)', () => {
    // $500 card purchase + $500 bridge payment on chequing → only $500 counted.
    const txns: TxRow[] = [
      tx({ type: 'expense', account_id: CARD_ID,     amount: 500 }), // excluded
      tx({ type: 'expense', account_id: CHEQUING_ID, amount: 500 }), // included
    ];
    expect(computeMonthTotals(txns, accounts).totalExpenses).toBe(500);
  });

  it('includes bridge lines (is_bridge chequing rows) in money-out', () => {
    const txns: TxRow[] = [
      tx({ type: 'expense', account_id: CHEQUING_ID, amount: 450 }),
    ];
    expect(computeMonthTotals(txns, accounts).totalExpenses).toBe(450);
  });

  it('computes net = totalIncome - totalExpenses when no savings', () => {
    const txns: TxRow[] = [
      tx({ type: 'income',  account_id: CHEQUING_ID, amount: 4000 }),
      tx({ type: 'expense', account_id: CHEQUING_ID, amount: 1200 }),
    ];
    const result = computeMonthTotals(txns, accounts);
    expect(result.totalSavings).toBe(0);
    expect(result.netCashFlow).toBe(2800);
  });

  it('net is negative when expenses exceed income', () => {
    const txns: TxRow[] = [
      tx({ type: 'income',  account_id: CHEQUING_ID, amount: 1000 }),
      tx({ type: 'expense', account_id: CHEQUING_ID, amount: 1500 }),
    ];
    expect(computeMonthTotals(txns, accounts).netCashFlow).toBe(-500);
  });

  it('ignores transactions with null account_id in expense totals', () => {
    const txns: TxRow[] = [
      tx({ type: 'expense', account_id: null, amount: 999 }),
    ];
    expect(computeMonthTotals(txns, accounts).totalExpenses).toBe(0);
  });

  it('handles amounts passed as strings (Supabase numeric type)', () => {
    const txns: TxRow[] = [
      { type: 'income',  account_id: CHEQUING_ID, amount: '2500.50' as unknown as number },
      { type: 'expense', account_id: CHEQUING_ID, amount: '800.25'  as unknown as number },
    ];
    const result = computeMonthTotals(txns, accounts);
    expect(result.totalIncome).toBe(2500.50);
    expect(result.totalExpenses).toBe(800.25);
    expect(result.netCashFlow).toBe(1700.25);
  });

  it('rounds results to two decimal places', () => {
    const txns: TxRow[] = [
      tx({ type: 'income', account_id: CHEQUING_ID, amount: 0.1 }),
      tx({ type: 'income', account_id: CHEQUING_ID, amount: 0.2 }),
    ];
    expect(computeMonthTotals(txns, accounts).totalIncome).toBe(0.30);
  });
});

// ---------------------------------------------------------------------------
// computeMonthTotals — transfers and savings bucket
// ---------------------------------------------------------------------------

describe('computeMonthTotals — transfers and savings bucket', () => {
  it('chequing→savings transfer: counted as savings, not expense', () => {
    // Transfer pair: chequing outflow + savings inflow
    const txns: TxRow[] = [
      { type: 'transfer', account_id: CHEQUING_ID, amount: 500 }, // chequing side — savings
      { type: 'transfer', account_id: SAVINGS_ID,  amount: 500 }, // goal side — ignored
    ];
    const result = computeMonthTotals(txns, accounts);
    expect(result.totalExpenses).toBe(0);   // not an expense
    expect(result.totalSavings).toBe(500);  // counted as savings
    expect(result.totalIncome).toBe(0);     // not income
  });

  it('chequing→TFSA transfer: same invariant, correct account type', () => {
    const txns: TxRow[] = [
      { type: 'transfer', account_id: CHEQUING_ID, amount: 300 },
      { type: 'transfer', account_id: TFSA_ID,     amount: 300 },
    ];
    const result = computeMonthTotals(txns, accounts);
    expect(result.totalExpenses).toBe(0);
    expect(result.totalSavings).toBe(300);
    expect(result.totalIncome).toBe(0);
  });

  it('chequing→RRSP transfer: same invariant', () => {
    const txns: TxRow[] = [
      { type: 'transfer', account_id: CHEQUING_ID, amount: 200 },
      { type: 'transfer', account_id: RRSP_ID,     amount: 200 },
    ];
    const result = computeMonthTotals(txns, accounts);
    expect(result.totalSavings).toBe(200);
    expect(result.totalExpenses).toBe(0);
    expect(result.totalIncome).toBe(0);
  });

  it('goal-side inflow is NOT counted as income', () => {
    const txns: TxRow[] = [
      { type: 'transfer', account_id: SAVINGS_ID, amount: 1000 }, // goal-side only
    ];
    const result = computeMonthTotals(txns, accounts);
    expect(result.totalIncome).toBe(0);   // not income
    expect(result.totalSavings).toBe(0);  // not savings (not on chequing)
    expect(result.totalExpenses).toBe(0);
  });

  it('net = income − expenses − savings (three-bucket formula)', () => {
    const txns: TxRow[] = [
      { type: 'income',   account_id: CHEQUING_ID, amount: 5000 },
      { type: 'expense',  account_id: CHEQUING_ID, amount: 2000 },
      { type: 'transfer', account_id: CHEQUING_ID, amount: 500  }, // chequing outflow
      { type: 'transfer', account_id: SAVINGS_ID,  amount: 500  }, // goal inflow — ignored
    ];
    const result = computeMonthTotals(txns, accounts);
    expect(result.totalIncome).toBe(5000);
    expect(result.totalExpenses).toBe(2000);
    expect(result.totalSavings).toBe(500);
    expect(result.netCashFlow).toBe(2500); // 5000 − 2000 − 500
  });

  it('multiple transfers to different goal accounts sum correctly', () => {
    const txns: TxRow[] = [
      { type: 'income',   account_id: CHEQUING_ID, amount: 6000 },
      { type: 'transfer', account_id: CHEQUING_ID, amount: 300  }, // → savings
      { type: 'transfer', account_id: SAVINGS_ID,  amount: 300  },
      { type: 'transfer', account_id: CHEQUING_ID, amount: 500  }, // → TFSA
      { type: 'transfer', account_id: TFSA_ID,     amount: 500  },
    ];
    const result = computeMonthTotals(txns, accounts);
    expect(result.totalSavings).toBe(800);   // 300 + 500
    expect(result.totalIncome).toBe(6000);
    expect(result.totalExpenses).toBe(0);
    expect(result.netCashFlow).toBe(5200);   // 6000 − 0 − 800
  });

  it('credit-card bridge is unaffected by transfers — still counts once', () => {
    // Card spending in prior month, bridge line on chequing, plus a savings transfer
    const txns: TxRow[] = [
      { type: 'income',   account_id: CHEQUING_ID, amount: 4000 },
      { type: 'expense',  account_id: CARD_ID,     amount: 600  }, // card spend — excluded
      { type: 'expense',  account_id: CHEQUING_ID, amount: 600  }, // bridge — counted once
      { type: 'transfer', account_id: CHEQUING_ID, amount: 200  }, // savings transfer
      { type: 'transfer', account_id: SAVINGS_ID,  amount: 200  },
    ];
    const result = computeMonthTotals(txns, accounts);
    expect(result.totalExpenses).toBe(600);  // bridge counted once, card excluded
    expect(result.totalSavings).toBe(200);
    expect(result.netCashFlow).toBe(3200);   // 4000 − 600 − 200
  });
});

// ---------------------------------------------------------------------------
// computeMonthTotals — full reconciliation invariant
// income − expenses − savings = net; every bucket logically consistent
// ---------------------------------------------------------------------------

describe('computeMonthTotals — full reconciliation', () => {
  it('income − expenses − savings always equals netCashFlow', () => {
    const cases: TxRow[][] = [
      // typical month
      [
        { type: 'income',   account_id: CHEQUING_ID, amount: 5500 },
        { type: 'expense',  account_id: CHEQUING_ID, amount: 3200 },
        { type: 'transfer', account_id: CHEQUING_ID, amount: 400  },
        { type: 'transfer', account_id: SAVINGS_ID,  amount: 400  },
      ],
      // month with card bridge and two goal transfers
      [
        { type: 'income',   account_id: CHEQUING_ID, amount: 7000 },
        { type: 'expense',  account_id: CHEQUING_ID, amount: 1500 },
        { type: 'expense',  account_id: CARD_ID,     amount: 900  },
        { type: 'expense',  account_id: CHEQUING_ID, amount: 900  }, // bridge
        { type: 'transfer', account_id: CHEQUING_ID, amount: 600  },
        { type: 'transfer', account_id: TFSA_ID,     amount: 600  },
        { type: 'transfer', account_id: CHEQUING_ID, amount: 100  },
        { type: 'transfer', account_id: RRSP_ID,     amount: 100  },
      ],
      // no transfers
      [
        { type: 'income',   account_id: CHEQUING_ID, amount: 3000 },
        { type: 'expense',  account_id: CHEQUING_ID, amount: 2500 },
      ],
    ];
    for (const txns of cases) {
      const r = computeMonthTotals(txns, accounts);
      expect(r.netCashFlow).toBeCloseTo(r.totalIncome - r.totalExpenses - r.totalSavings, 10);
    }
  });
});

// ---------------------------------------------------------------------------
// computeGoalBalance
//
// Phase 3 round-2 fix (2026-07-17): recurring transfers materialize 12
// months of REAL future-dated rows (Phase 2). Summing all of them
// unconditionally overstated a goal's/debt's CURRENT balance by every
// not-yet-happened payment — a debt showing "paid off" months before a
// single future payment actually landed. computeGoalBalance now takes a
// required `today` cutoff and only counts transactions dated on or before
// it. Every fixture below gets an explicit `date`; TODAY is fixed so past
// vs. future is unambiguous across the whole file.
// ---------------------------------------------------------------------------

const TODAY = '2026-07-10';
const PAST1 = '2026-05-01';
const PAST2 = '2026-06-01';
const PAST3 = '2026-07-01';
const FUTURE1 = '2026-08-01';
const FUTURE2 = '2026-09-01';

describe('computeGoalBalance', () => {
  it('returns 0 for an empty transaction list', () => {
    expect(computeGoalBalance([], SAVINGS_ID, TODAY)).toBe(0);
  });

  it('returns 0 when no transactions match the goal account', () => {
    const txns: TxRow[] = [
      { type: 'transfer', account_id: CHEQUING_ID, amount: 500, date: PAST1 },
    ];
    expect(computeGoalBalance(txns, SAVINGS_ID, TODAY)).toBe(0);
  });

  it('sums transfer inflows for the goal account', () => {
    const txns: TxRow[] = [
      { type: 'transfer', account_id: SAVINGS_ID, amount: 300, date: PAST1 },
      { type: 'transfer', account_id: SAVINGS_ID, amount: 200, date: PAST2 },
    ];
    expect(computeGoalBalance(txns, SAVINGS_ID, TODAY)).toBe(500);
  });

  it('only counts type=transfer rows (ignores other types)', () => {
    const txns: TxRow[] = [
      { type: 'transfer', account_id: SAVINGS_ID, amount: 400, date: PAST1 },
      { type: 'income',   account_id: SAVINGS_ID, amount: 999, date: PAST1 }, // should not happen, but guard
      { type: 'expense',  account_id: SAVINGS_ID, amount: 50,  date: PAST1 }, // should not happen, but guard
    ];
    expect(computeGoalBalance(txns, SAVINGS_ID, TODAY)).toBe(400);
  });

  it('does not mix balances across different goal accounts', () => {
    const txns: TxRow[] = [
      { type: 'transfer', account_id: SAVINGS_ID, amount: 300, date: PAST1 },
      { type: 'transfer', account_id: TFSA_ID,    amount: 500, date: PAST1 },
      { type: 'transfer', account_id: RRSP_ID,    amount: 200, date: PAST1 },
    ];
    expect(computeGoalBalance(txns, SAVINGS_ID, TODAY)).toBe(300);
    expect(computeGoalBalance(txns, TFSA_ID, TODAY)).toBe(500);
    expect(computeGoalBalance(txns, RRSP_ID, TODAY)).toBe(200);
  });

  it('rounds to two decimal places', () => {
    const txns: TxRow[] = [
      { type: 'transfer', account_id: SAVINGS_ID, amount: 0.1, date: PAST1 },
      { type: 'transfer', account_id: SAVINGS_ID, amount: 0.2, date: PAST1 },
    ];
    expect(computeGoalBalance(txns, SAVINGS_ID, TODAY)).toBe(0.30);
  });

  it('handles string amounts (Supabase numeric type)', () => {
    const txns: TxRow[] = [
      { type: 'transfer', account_id: SAVINGS_ID, amount: '750.50' as unknown as number, date: PAST1 },
    ];
    expect(computeGoalBalance(txns, SAVINGS_ID, TODAY)).toBe(750.50);
  });

  it('after a transfer pair: chequing balance down, goal balance up, net worth unchanged', () => {
    // Before transfer: income 5000, expenses 1000
    // Transfer 500 chequing → savings
    const txns: TxRow[] = [
      { type: 'income',   account_id: CHEQUING_ID, amount: 5000, date: PAST1 },
      { type: 'expense',  account_id: CHEQUING_ID, amount: 1000, date: PAST1 },
      { type: 'transfer', account_id: CHEQUING_ID, amount: 500,  date: PAST1 }, // chequing outflow
      { type: 'transfer', account_id: SAVINGS_ID,  amount: 500,  date: PAST1 }, // goal inflow
    ];
    const buckets = computeMonthTotals(txns, accounts);
    const goalBalance = computeGoalBalance(txns, SAVINGS_ID, TODAY);

    // Chequing after transfer: income - expenses - savings = 5000 - 1000 - 500 = 3500
    expect(buckets.netCashFlow).toBe(3500);
    // Goal received 500
    expect(goalBalance).toBe(500);
    // Net worth = chequing remainder + goal balance = 3500 + 500 = 4000 = original net (5000 - 1000)
    expect(buckets.netCashFlow + goalBalance).toBe(buckets.totalIncome - buckets.totalExpenses);
  });

  it('transfer edit: updated amount reflected in both savings bucket and goal balance', () => {
    // Simulates the state AFTER an edit: old pair gone, new pair with different amount
    const afterEdit: TxRow[] = [
      { type: 'income',   account_id: CHEQUING_ID, amount: 5000, date: PAST1 },
      { type: 'transfer', account_id: CHEQUING_ID, amount: 750,  date: PAST1 }, // edited amount
      { type: 'transfer', account_id: SAVINGS_ID,  amount: 750,  date: PAST1 },
    ];
    const buckets = computeMonthTotals(afterEdit, accounts);
    const goalBalance = computeGoalBalance(afterEdit, SAVINGS_ID, TODAY);
    expect(buckets.totalSavings).toBe(750);
    expect(goalBalance).toBe(750);
    expect(buckets.netCashFlow + goalBalance).toBe(buckets.totalIncome - buckets.totalExpenses);
  });

  it('transfer deletion: both sides removed, balances revert correctly', () => {
    // State AFTER deleting the transfer pair: back to no transfer
    const afterDelete: TxRow[] = [
      { type: 'income',   account_id: CHEQUING_ID, amount: 5000, date: PAST1 },
      { type: 'expense',  account_id: CHEQUING_ID, amount: 1000, date: PAST1 },
    ];
    const buckets = computeMonthTotals(afterDelete, accounts);
    const goalBalance = computeGoalBalance(afterDelete, SAVINGS_ID, TODAY);
    expect(buckets.totalSavings).toBe(0);
    expect(goalBalance).toBe(0);
    expect(buckets.netCashFlow).toBe(4000); // reverted to pre-transfer net
  });

  // -------------------------------------------------------------------
  // Future-dated cutoff — the actual Phase 3 round-2 bug.
  // -------------------------------------------------------------------
  it('excludes transactions dated after today — a future materialized payment is not yet "in" the balance', () => {
    const txns: TxRow[] = [
      { type: 'transfer', account_id: SAVINGS_ID, amount: 200, date: PAST1 },
      { type: 'transfer', account_id: SAVINGS_ID, amount: 300, date: FUTURE1 }, // not yet happened
    ];
    expect(computeGoalBalance(txns, SAVINGS_ID, TODAY)).toBe(200);
  });

  it('includes a transaction dated exactly today (inclusive cutoff)', () => {
    const txns: TxRow[] = [
      { type: 'transfer', account_id: SAVINGS_ID, amount: 200, date: PAST1 },
      { type: 'transfer', account_id: SAVINGS_ID, amount: 300, date: TODAY },
    ];
    expect(computeGoalBalance(txns, SAVINGS_ID, TODAY)).toBe(500);
  });

  it('a debt with future materialized payments still shows the true (unpaid) balance today', () => {
    // Opening -500, then twelve future $500 payments materialized ahead of
    // time by Phase 2 — none of them have happened yet.
    const futurePayments: TxRow[] = Array.from({ length: 12 }, (_, i) => ({
      type: 'transfer' as const,
      account_id: SAVINGS_ID,
      amount: 500,
      date: `2026-${String(8 + i > 12 ? i - 4 : 8 + i).padStart(2, '0')}-01`,
    }));
    const txns: TxRow[] = [
      { type: 'transfer', account_id: SAVINGS_ID, amount: -500, date: PAST1 }, // opening balance
      ...futurePayments,
    ];
    // Still -500 today — none of the future payments count yet.
    expect(computeGoalBalance(txns, SAVINGS_ID, TODAY)).toBe(-500);
  });

  it('the day a materialized payment\'s date arrives, it counts', () => {
    const txns: TxRow[] = [
      { type: 'transfer', account_id: SAVINGS_ID, amount: -500, date: PAST1 },
      { type: 'transfer', account_id: SAVINGS_ID, amount: 200,  date: PAST3 }, // already arrived
      { type: 'transfer', account_id: SAVINGS_ID, amount: 200,  date: FUTURE1 }, // not yet
    ];
    expect(computeGoalBalance(txns, SAVINGS_ID, TODAY)).toBe(-300); // -500 + 200
  });
});

// ---------------------------------------------------------------------------
// computeGoalBalance — full-history contract
// The dashboard endpoint must pass ALL-TIME transactions (past AND future —
// the cutoff itself does the future-exclusion), not a month slice.
// These tests verify the accumulation behavior that enforces that contract.
// ---------------------------------------------------------------------------

describe('computeGoalBalance — full history contract', () => {
  it('accumulates transfers across multiple "months" (simulated by separate rows)', () => {
    // Three deposits that would span different calendar months in production.
    // The function sees them all because the caller passes the full history.
    const allTime: TxRow[] = [
      { type: 'transfer', account_id: SAVINGS_ID, amount: 200, date: PAST1 }, // month 1
      { type: 'transfer', account_id: SAVINGS_ID, amount: 300, date: PAST2 }, // month 2
      { type: 'transfer', account_id: SAVINGS_ID, amount: 150, date: PAST3 }, // month 3
    ];
    expect(computeGoalBalance(allTime, SAVINGS_ID, TODAY)).toBe(650);
  });

  it('a month-scoped slice underestimates the balance vs full history', () => {
    const fullHistory: TxRow[] = [
      { type: 'transfer', account_id: SAVINGS_ID, amount: 500, date: PAST1 }, // prior month
      { type: 'transfer', account_id: SAVINGS_ID, amount: 200, date: PAST3 }, // current month
    ];
    const currentMonthOnly: TxRow[] = [
      { type: 'transfer', account_id: SAVINGS_ID, amount: 200, date: PAST3 },
    ];
    const fullBalance  = computeGoalBalance(fullHistory, SAVINGS_ID, TODAY);
    const sliceBalance = computeGoalBalance(currentMonthOnly, SAVINGS_ID, TODAY);
    expect(fullBalance).toBe(700);
    expect(sliceBalance).toBe(200);
    // The slice underestimates by exactly the prior-month deposit.
    expect(fullBalance - sliceBalance).toBe(500);
  });

  it('balance across all three goal types accumulates independently over time', () => {
    const allTime: TxRow[] = [
      { type: 'transfer', account_id: SAVINGS_ID, amount: 100, date: PAST1 },
      { type: 'transfer', account_id: TFSA_ID,    amount: 200, date: PAST1 },
      { type: 'transfer', account_id: RRSP_ID,    amount: 300, date: PAST1 },
      { type: 'transfer', account_id: SAVINGS_ID, amount: 50,  date: PAST2 }, // second deposit to savings
      { type: 'transfer', account_id: TFSA_ID,    amount: 75,  date: PAST2 }, // second deposit to TFSA
    ];
    expect(computeGoalBalance(allTime, SAVINGS_ID, TODAY)).toBe(150);
    expect(computeGoalBalance(allTime, TFSA_ID, TODAY)).toBe(275);
    expect(computeGoalBalance(allTime, RRSP_ID, TODAY)).toBe(300);
  });

  it('a goal with future contributions excludes them from today\'s progress', () => {
    const withFuture: TxRow[] = [
      { type: 'transfer', account_id: SAVINGS_ID, amount: 1000, date: PAST1 },
      { type: 'transfer', account_id: SAVINGS_ID, amount: 500,  date: FUTURE1 },
      { type: 'transfer', account_id: SAVINGS_ID, amount: 500,  date: FUTURE2 },
    ];
    expect(computeGoalBalance(withFuture, SAVINGS_ID, TODAY)).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// computeMonthTotals — bi-weekly + semi-monthly income (windfall month)
//
// Regression suite for the regenerate-plan income bug:
//   recurring_items.amount = per-paycheque amount (e.g. $2,749 bi-weekly)
//   Summing raw amounts = $2,749 + $2,742 + $383 = $5,874 (the bug)
//   Correct source     = transactions for the month (materialized paycheques)
//
// Trial household (real numbers):
//   Lineu  — bi-weekly salary $2,749/paycheque  (2 or 3 paycheques/month)
//   Julia  — semi-monthly salary $2,742/paycheque (always 2/month)
//   Benefits — monthly $383
// ---------------------------------------------------------------------------

describe('computeMonthTotals — bi-weekly + semi-monthly income (windfall month)', () => {
  const chequingAcct: AccountRow = { id: CHEQUING_ID, type: 'chequing' };

  // The one-of-each-source bug amount: what regenerate-plan used to return
  // when reading recurring_items.amount without frequency multiplication.
  const BUG_AMOUNT = 2749 + 2742 + 383; // 5874

  it('3-paycheque July: income = 3×biweekly + 2×semimonthly + 1×monthly = $14,114', () => {
    // Lineu bi-weekly × 3, Julia semi-monthly × 2, benefits × 1
    const txns: TxRow[] = [
      { type: 'income', account_id: CHEQUING_ID, amount: 2749 }, // Lineu paycheque 1
      { type: 'income', account_id: CHEQUING_ID, amount: 2749 }, // Lineu paycheque 2
      { type: 'income', account_id: CHEQUING_ID, amount: 2749 }, // Lineu paycheque 3 (windfall)
      { type: 'income', account_id: CHEQUING_ID, amount: 2742 }, // Julia paycheque 1
      { type: 'income', account_id: CHEQUING_ID, amount: 2742 }, // Julia paycheque 2
      { type: 'income', account_id: CHEQUING_ID, amount: 383  }, // Benefits
    ];
    const { totalIncome } = computeMonthTotals(txns, [chequingAcct]);
    expect(totalIncome).toBe(14114); // 3×2749 + 2×2742 + 383
    expect(totalIncome).not.toBe(BUG_AMOUNT); // NOT the one-of-each-source bug total
    // 3-paycheque month yields the higher figure vs 2-paycheque month
    expect(totalIncome).toBeGreaterThan(11365); // the 2-paycheque month amount
  });

  it('2-paycheque month: income = 2×biweekly + 2×semimonthly + 1×monthly = $11,365', () => {
    const txns: TxRow[] = [
      { type: 'income', account_id: CHEQUING_ID, amount: 2749 }, // Lineu paycheque 1
      { type: 'income', account_id: CHEQUING_ID, amount: 2749 }, // Lineu paycheque 2
      { type: 'income', account_id: CHEQUING_ID, amount: 2742 }, // Julia paycheque 1
      { type: 'income', account_id: CHEQUING_ID, amount: 2742 }, // Julia paycheque 2
      { type: 'income', account_id: CHEQUING_ID, amount: 383  }, // Benefits
    ];
    const { totalIncome } = computeMonthTotals(txns, [chequingAcct]);
    expect(totalIncome).toBe(11365); // ≈ the $11,150 figure cited in the bug report
    expect(totalIncome).not.toBe(BUG_AMOUNT); // NOT the bug amount
    expect(totalIncome).toBeLessThan(14114);  // lower than 3-paycheque windfall month
  });

  it('REGRESSION — ledger income ($11,365) is never the same as one-of-each-source ($5,874)', () => {
    // Confirms the root cause of the regenerate-plan bug:
    //   old code: sum recurring_items.amount without frequency = $5,874 → reports deficit
    //   fix:      sum transactions for month                  = $11,365 → reports surplus
    const recurringRawAmounts = [2749, 2742, 383]; // per-paycheque amounts from recurring_items
    const bugTotal = recurringRawAmounts.reduce((s, a) => s + a, 0);
    expect(bugTotal).toBe(BUG_AMOUNT); // confirms the bug number: $5,874

    // Real ledger for a normal 2-paycheque month
    const txns: TxRow[] = [
      { type: 'income', account_id: CHEQUING_ID, amount: 2749 },
      { type: 'income', account_id: CHEQUING_ID, amount: 2749 },
      { type: 'income', account_id: CHEQUING_ID, amount: 2742 },
      { type: 'income', account_id: CHEQUING_ID, amount: 2742 },
      { type: 'income', account_id: CHEQUING_ID, amount: 383  },
    ];
    const { totalIncome, netCashFlow } = computeMonthTotals(txns, [chequingAcct]);

    // Income must be the ledger amount, not the bug amount
    expect(totalIncome).not.toBe(bugTotal);
    expect(totalIncome).toBeGreaterThan(bugTotal * 1.9); // nearly double — bi-weekly counted twice

    // With $9,600 in planned expenses the review was seeing a deficit.
    // With real ledger income a surplus must be evident.
    const plannedExpenses = 9600; // approximate from the bug report context
    const surplusFromLedger = totalIncome - plannedExpenses;
    const deficitFromBug    = bugTotal - plannedExpenses;
    expect(surplusFromLedger).toBeGreaterThan(0); // surplus ✓
    expect(deficitFromBug).toBeLessThan(0);        // bug said deficit ✗ ← the reported $142/month deficit
  });
});

// ---------------------------------------------------------------------------
// computeMonthTotals — bi-weekly expense frequency (plan/review input)
//
// Mirror of the income windfall tests, applied to the expense side.
// Before this fix, regenerate-plan read recurring_items.amount directly for
// expenses (one-of-each-source, no cadence applied). A bi-weekly mortgage of
// $1,200/payment would be counted as $1,200 instead of $2,400 or $3,600,
// understating expenses and inflating the apparent surplus.
// ---------------------------------------------------------------------------

describe('computeMonthTotals — bi-weekly expense frequency (plan/review input)', () => {
  const chequingAcct: AccountRow = { id: CHEQUING_ID, type: 'chequing' };

  it('bi-weekly expense: 2-payment month counts both payments', () => {
    // $1,200 bi-weekly mortgage → 2 chequing rows this month
    const txns: TxRow[] = [
      { type: 'income',  account_id: CHEQUING_ID, amount: 5000 },
      { type: 'expense', account_id: CHEQUING_ID, amount: 1200 }, // mortgage pay 1
      { type: 'expense', account_id: CHEQUING_ID, amount: 1200 }, // mortgage pay 2
      { type: 'expense', account_id: CHEQUING_ID, amount: 800  }, // other expenses
    ];
    const { totalExpenses } = computeMonthTotals(txns, [chequingAcct]);
    expect(totalExpenses).toBe(3200); // $1,200 × 2 + $800
    expect(totalExpenses).not.toBe(2000); // NOT one-of-each ($1,200 + $800)
  });

  it('bi-weekly expense: 3-payment month counts all three', () => {
    const txns: TxRow[] = [
      { type: 'income',  account_id: CHEQUING_ID, amount: 6000 },
      { type: 'expense', account_id: CHEQUING_ID, amount: 1200 }, // mortgage pay 1
      { type: 'expense', account_id: CHEQUING_ID, amount: 1200 }, // mortgage pay 2
      { type: 'expense', account_id: CHEQUING_ID, amount: 1200 }, // mortgage pay 3 (windfall)
      { type: 'expense', account_id: CHEQUING_ID, amount: 800  }, // other expenses
    ];
    const { totalExpenses } = computeMonthTotals(txns, [chequingAcct]);
    expect(totalExpenses).toBe(4400); // $1,200 × 3 + $800
    expect(totalExpenses).toBeGreaterThan(3200); // higher than 2-payment month
  });

  it('net cash flow equals income − expenses − savings (ledger identity)', () => {
    // Verifies that the review headline is the ledger net, not a mixed actual/planned figure
    const txns: TxRow[] = [
      { type: 'income',   account_id: CHEQUING_ID, amount: 11365 },
      { type: 'expense',  account_id: CHEQUING_ID, amount: 2400  }, // bi-weekly mortgage × 2
      { type: 'expense',  account_id: CHEQUING_ID, amount: 5484  }, // other chequing expenses
      { type: 'transfer', account_id: CHEQUING_ID, amount: 500   }, // savings transfer (chequing side)
      { type: 'transfer', account_id: SAVINGS_ID,  amount: 500   }, // savings transfer (goal side — ignored)
    ];
    const { totalIncome, totalExpenses, totalSavings, netCashFlow } =
      computeMonthTotals(txns, [chequingAcct, { id: SAVINGS_ID, type: 'savings' }]);
    // Net = income − expenses − savings
    expect(netCashFlow).toBeCloseTo(totalIncome - totalExpenses - totalSavings, 10);
    expect(netCashFlow).toBe(2981); // 11365 − (2400 + 5484) − 500
  });

  it('REGRESSION — bi-weekly overspending: cannot be reported as surplus', () => {
    // Income: $5,000/month
    // Expenses: $1,200 bi-weekly mortgage (2 payments = $2,400) + $3,200 other = $5,600 total
    //
    // Bug (one-of-each from recurring_items): expenses = $1,200 + $3,200 = $4,400
    //   → net = $5,000 − $4,400 = +$600 (falsely reported surplus)
    //
    // Fix (transactions): expenses = $2,400 + $3,200 = $5,600
    //   → net = $5,000 − $5,600 = −$600 (correct deficit)
    const txns: TxRow[] = [
      { type: 'income',  account_id: CHEQUING_ID, amount: 5000 },
      { type: 'expense', account_id: CHEQUING_ID, amount: 1200 }, // mortgage pay 1
      { type: 'expense', account_id: CHEQUING_ID, amount: 1200 }, // mortgage pay 2
      { type: 'expense', account_id: CHEQUING_ID, amount: 3200 }, // other expenses
    ];
    const { totalExpenses, netCashFlow } = computeMonthTotals(txns, [chequingAcct]);

    // Transaction-based: both mortgage payments counted → correct deficit
    expect(totalExpenses).toBe(5600);
    expect(netCashFlow).toBe(-600); // deficit

    // What the old bug would produce (one-of-each recurring_item amount):
    const bugExpenses = 1200 + 3200; // only one mortgage payment from recurring_items
    const bugNet = 5000 - bugExpenses;
    expect(bugExpenses).toBe(4400);
    expect(bugNet).toBe(600); // bug falsely showed +$600 surplus for an overspending household
    expect(netCashFlow).not.toBe(bugNet); // ledger net ≠ bug net
  });
});

// ---------------------------------------------------------------------------
// Cross-view reconciliation invariant
//
// Dashboard, Planner, and Reconcile all call computeMonthTotals with the same
// transaction set for a given month.  This test makes that guarantee explicit:
// given the same transactions, computeMonthTotals and reconcileMonth (which
// delegates to computeMonthTotals internally) produce identical totals.
// When the dashboard is unfrozen and reads the current calendar month, it will
// always agree with the planner and reconcile screen for that same month.
// ---------------------------------------------------------------------------

const CROSS_CHQ  = 'x-chq';
const CROSS_CARD = 'x-card';
const CROSS_SAV  = 'x-sav';

const crossAccounts: AccountRow[] = [
  { id: CROSS_CHQ,  type: 'chequing'    },
  { id: CROSS_CARD, type: 'credit_card' },
  { id: CROSS_SAV,  type: 'savings'     },
];

const crossAccountsForReconcile: ReconcileAccountRow[] = [
  { id: CROSS_CHQ,  type: 'chequing',    name: 'Chequing'  },
  { id: CROSS_CARD, type: 'credit_card', name: 'Visa'      },
  { id: CROSS_SAV,  type: 'savings',     name: 'Emergency' },
];

function rtx(overrides: Partial<ReconcileTxRow> & { amount: number; type: string }): ReconcileTxRow {
  return { id: 'r-' + Math.random(), date: '2026-06-15', description: null,
    account_id: CROSS_CHQ, is_bridge: false, ...overrides };
}

describe('cross-view reconciliation invariant — dashboard = planner = reconcile', () => {
  it('computeMonthTotals totals match reconcileMonth path-1 totals for the same transaction set', () => {
    const txns: ReconcileTxRow[] = [
      rtx({ type: 'income',   account_id: CROSS_CHQ,  amount: 6000 }),
      rtx({ type: 'expense',  account_id: CROSS_CHQ,  amount: 2500 }),
      rtx({ type: 'expense',  account_id: CROSS_CARD, amount: 800  }), // card spend — excluded
      rtx({ type: 'expense',  account_id: CROSS_CHQ,  amount: 800, is_bridge: true }), // bridge
      rtx({ type: 'transfer', account_id: CROSS_CHQ,  amount: 400  }), // chequing→savings
      rtx({ type: 'transfer', account_id: CROSS_SAV,  amount: 400  }), // savings inflow (ignored)
    ];

    // Path used by dashboard API
    const dashboard = computeMonthTotals(txns, crossAccounts);

    // Path used by reconcile screen (path 1 delegates to computeMonthTotals)
    const reconcile = reconcileMonth(txns, crossAccountsForReconcile);

    expect(dashboard.totalIncome).toBe(reconcile.totalIncome);
    expect(dashboard.totalExpenses).toBe(reconcile.totalExpenses);
    expect(dashboard.totalSavings).toBe(reconcile.totalSavings);
    expect(dashboard.netCashFlow).toBe(reconcile.netFromBuckets);
    // Both paths must agree (reconciled = true)
    expect(reconcile.reconciled).toBe(true);
  });

  it('dashboard numbers are stable across different months — same txns give same totals', () => {
    // Simulates: dashboard displays June, user navigates to May (different date range in the
    // API query), but the math function itself is month-agnostic — the date filter is the
    // caller's responsibility.  Given identical transaction arrays the result is identical.
    const juneSet: TxRow[] = [
      { type: 'income',  account_id: CROSS_CHQ, amount: 5500 },
      { type: 'expense', account_id: CROSS_CHQ, amount: 3000 },
    ];
    const maySet: TxRow[] = [...juneSet]; // same data, different month in reality

    expect(computeMonthTotals(juneSet, crossAccounts))
      .toEqual(computeMonthTotals(maySet, crossAccounts));
  });
});
