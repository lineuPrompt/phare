import { describe, it, expect } from 'vitest';
import { computeMonthTotals, TxRow, AccountRow } from '../dashboardHelpers';

const CHEQUING_ID = 'chq-1';
const CARD_ID     = 'card-1';

const accounts: AccountRow[] = [
  { id: CHEQUING_ID, type: 'chequing'    },
  { id: CARD_ID,     type: 'credit_card' },
];

function tx(overrides: Partial<TxRow> & { amount: number }): TxRow {
  return {
    type: 'expense',
    account_id: CHEQUING_ID,
    ...overrides,
  };
}

describe('computeMonthTotals', () => {
  it('returns zeroes for an empty transaction list', () => {
    expect(computeMonthTotals([], accounts)).toEqual({
      totalIncome: 0,
      totalExpenses: 0,
      netCashFlow: 0,
    });
  });

  it('sums only type=income transactions into totalIncome', () => {
    const txns: TxRow[] = [
      tx({ type: 'income', account_id: CHEQUING_ID, amount: 3000 }),
      tx({ type: 'expense', account_id: CHEQUING_ID, amount: 200 }),
    ];
    const result = computeMonthTotals(txns, accounts);
    expect(result.totalIncome).toBe(3000);
  });

  it('sums chequing expense transactions into totalExpenses', () => {
    const txns: TxRow[] = [
      tx({ type: 'expense', account_id: CHEQUING_ID, amount: 500 }),
      tx({ type: 'expense', account_id: CHEQUING_ID, amount: 300 }),
    ];
    const result = computeMonthTotals(txns, accounts);
    expect(result.totalExpenses).toBe(800);
  });

  it('excludes card expense transactions from totalExpenses (double-count prevention)', () => {
    // $500 card purchase + $500 bridge payment on chequing.
    // The card purchase must NOT be counted — only the bridge line counts.
    const txns: TxRow[] = [
      tx({ type: 'expense', account_id: CARD_ID,     amount: 500 }), // raw card spend — excluded
      tx({ type: 'expense', account_id: CHEQUING_ID, amount: 500 }), // bridge payment — included
    ];
    const result = computeMonthTotals(txns, accounts);
    expect(result.totalExpenses).toBe(500); // not 1000
  });

  it('includes bridge lines (is_bridge=true) in money-out because they live on chequing', () => {
    // Bridge lines don't carry is_bridge in the TxRow shape used here;
    // they are simply chequing expense rows, so they're counted correctly.
    const txns: TxRow[] = [
      tx({ type: 'expense', account_id: CHEQUING_ID, amount: 450 }), // bridge payment
    ];
    const result = computeMonthTotals(txns, accounts);
    expect(result.totalExpenses).toBe(450);
  });

  it('computes net = totalIncome - totalExpenses', () => {
    const txns: TxRow[] = [
      tx({ type: 'income',  account_id: CHEQUING_ID, amount: 4000 }),
      tx({ type: 'expense', account_id: CHEQUING_ID, amount: 1200 }),
    ];
    const result = computeMonthTotals(txns, accounts);
    expect(result.netCashFlow).toBe(2800);
  });

  it('net is negative when expenses exceed income', () => {
    const txns: TxRow[] = [
      tx({ type: 'income',  account_id: CHEQUING_ID, amount: 1000 }),
      tx({ type: 'expense', account_id: CHEQUING_ID, amount: 1500 }),
    ];
    const result = computeMonthTotals(txns, accounts);
    expect(result.netCashFlow).toBe(-500);
  });

  it('ignores transactions with null account_id in expense totals', () => {
    const txns: TxRow[] = [
      tx({ type: 'expense', account_id: null, amount: 999 }),
    ];
    const result = computeMonthTotals(txns, accounts);
    expect(result.totalExpenses).toBe(0);
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
      tx({ type: 'income',  account_id: CHEQUING_ID, amount: 0.1 }),
      tx({ type: 'income',  account_id: CHEQUING_ID, amount: 0.2 }),
    ];
    const result = computeMonthTotals(txns, accounts);
    expect(result.totalIncome).toBe(0.30);
  });
});
