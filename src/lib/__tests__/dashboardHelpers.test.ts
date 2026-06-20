import { describe, it, expect } from 'vitest';
import {
  computeMonthTotals,
  computeGoalBalance,
  TxRow,
  AccountRow,
} from '../dashboardHelpers';

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
// ---------------------------------------------------------------------------

describe('computeGoalBalance', () => {
  it('returns 0 for an empty transaction list', () => {
    expect(computeGoalBalance([], SAVINGS_ID)).toBe(0);
  });

  it('returns 0 when no transactions match the goal account', () => {
    const txns: TxRow[] = [
      { type: 'transfer', account_id: CHEQUING_ID, amount: 500 },
    ];
    expect(computeGoalBalance(txns, SAVINGS_ID)).toBe(0);
  });

  it('sums transfer inflows for the goal account', () => {
    const txns: TxRow[] = [
      { type: 'transfer', account_id: SAVINGS_ID, amount: 300 },
      { type: 'transfer', account_id: SAVINGS_ID, amount: 200 },
    ];
    expect(computeGoalBalance(txns, SAVINGS_ID)).toBe(500);
  });

  it('only counts type=transfer rows (ignores other types)', () => {
    const txns: TxRow[] = [
      { type: 'transfer', account_id: SAVINGS_ID, amount: 400 },
      { type: 'income',   account_id: SAVINGS_ID, amount: 999 }, // should not happen, but guard
      { type: 'expense',  account_id: SAVINGS_ID, amount: 50  }, // should not happen, but guard
    ];
    expect(computeGoalBalance(txns, SAVINGS_ID)).toBe(400);
  });

  it('does not mix balances across different goal accounts', () => {
    const txns: TxRow[] = [
      { type: 'transfer', account_id: SAVINGS_ID, amount: 300 },
      { type: 'transfer', account_id: TFSA_ID,    amount: 500 },
      { type: 'transfer', account_id: RRSP_ID,    amount: 200 },
    ];
    expect(computeGoalBalance(txns, SAVINGS_ID)).toBe(300);
    expect(computeGoalBalance(txns, TFSA_ID)).toBe(500);
    expect(computeGoalBalance(txns, RRSP_ID)).toBe(200);
  });

  it('rounds to two decimal places', () => {
    const txns: TxRow[] = [
      { type: 'transfer', account_id: SAVINGS_ID, amount: 0.1 },
      { type: 'transfer', account_id: SAVINGS_ID, amount: 0.2 },
    ];
    expect(computeGoalBalance(txns, SAVINGS_ID)).toBe(0.30);
  });

  it('handles string amounts (Supabase numeric type)', () => {
    const txns: TxRow[] = [
      { type: 'transfer', account_id: SAVINGS_ID, amount: '750.50' as unknown as number },
    ];
    expect(computeGoalBalance(txns, SAVINGS_ID)).toBe(750.50);
  });

  it('after a transfer pair: chequing balance down, goal balance up, net worth unchanged', () => {
    // Before transfer: income 5000, expenses 1000
    // Transfer 500 chequing → savings
    const txns: TxRow[] = [
      { type: 'income',   account_id: CHEQUING_ID, amount: 5000 },
      { type: 'expense',  account_id: CHEQUING_ID, amount: 1000 },
      { type: 'transfer', account_id: CHEQUING_ID, amount: 500  }, // chequing outflow
      { type: 'transfer', account_id: SAVINGS_ID,  amount: 500  }, // goal inflow
    ];
    const buckets = computeMonthTotals(txns, accounts);
    const goalBalance = computeGoalBalance(txns, SAVINGS_ID);

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
      { type: 'income',   account_id: CHEQUING_ID, amount: 5000 },
      { type: 'transfer', account_id: CHEQUING_ID, amount: 750  }, // edited amount
      { type: 'transfer', account_id: SAVINGS_ID,  amount: 750  },
    ];
    const buckets = computeMonthTotals(afterEdit, accounts);
    const goalBalance = computeGoalBalance(afterEdit, SAVINGS_ID);
    expect(buckets.totalSavings).toBe(750);
    expect(goalBalance).toBe(750);
    expect(buckets.netCashFlow + goalBalance).toBe(buckets.totalIncome - buckets.totalExpenses);
  });

  it('transfer deletion: both sides removed, balances revert correctly', () => {
    // State AFTER deleting the transfer pair: back to no transfer
    const afterDelete: TxRow[] = [
      { type: 'income',   account_id: CHEQUING_ID, amount: 5000 },
      { type: 'expense',  account_id: CHEQUING_ID, amount: 1000 },
    ];
    const buckets = computeMonthTotals(afterDelete, accounts);
    const goalBalance = computeGoalBalance(afterDelete, SAVINGS_ID);
    expect(buckets.totalSavings).toBe(0);
    expect(goalBalance).toBe(0);
    expect(buckets.netCashFlow).toBe(4000); // reverted to pre-transfer net
  });
});

// ---------------------------------------------------------------------------
// computeGoalBalance — full-history contract
// The dashboard endpoint must pass ALL-TIME transactions, not a month slice.
// These tests verify the accumulation behavior that enforces that contract.
// ---------------------------------------------------------------------------

describe('computeGoalBalance — full history contract', () => {
  it('accumulates transfers across multiple "months" (simulated by separate rows)', () => {
    // Three deposits that would span different calendar months in production.
    // The function sees them all because the caller passes the full history.
    const allTime: TxRow[] = [
      { type: 'transfer', account_id: SAVINGS_ID, amount: 200 }, // month 1
      { type: 'transfer', account_id: SAVINGS_ID, amount: 300 }, // month 2
      { type: 'transfer', account_id: SAVINGS_ID, amount: 150 }, // month 3
    ];
    expect(computeGoalBalance(allTime, SAVINGS_ID)).toBe(650);
  });

  it('a month-scoped slice underestimates the balance vs full history', () => {
    const fullHistory: TxRow[] = [
      { type: 'transfer', account_id: SAVINGS_ID, amount: 500 }, // prior month
      { type: 'transfer', account_id: SAVINGS_ID, amount: 200 }, // current month
    ];
    const currentMonthOnly: TxRow[] = [
      { type: 'transfer', account_id: SAVINGS_ID, amount: 200 },
    ];
    const fullBalance  = computeGoalBalance(fullHistory, SAVINGS_ID);
    const sliceBalance = computeGoalBalance(currentMonthOnly, SAVINGS_ID);
    expect(fullBalance).toBe(700);
    expect(sliceBalance).toBe(200);
    // The slice underestimates by exactly the prior-month deposit.
    expect(fullBalance - sliceBalance).toBe(500);
  });

  it('balance across all three goal types accumulates independently over time', () => {
    const allTime: TxRow[] = [
      { type: 'transfer', account_id: SAVINGS_ID, amount: 100 },
      { type: 'transfer', account_id: TFSA_ID,    amount: 200 },
      { type: 'transfer', account_id: RRSP_ID,    amount: 300 },
      { type: 'transfer', account_id: SAVINGS_ID, amount: 50  }, // second deposit to savings
      { type: 'transfer', account_id: TFSA_ID,    amount: 75  }, // second deposit to TFSA
    ];
    expect(computeGoalBalance(allTime, SAVINGS_ID)).toBe(150);
    expect(computeGoalBalance(allTime, TFSA_ID)).toBe(275);
    expect(computeGoalBalance(allTime, RRSP_ID)).toBe(300);
  });
});
