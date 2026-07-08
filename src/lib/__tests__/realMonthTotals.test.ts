/**
 * Fix 3 — "months are real, not averaged."
 *
 * Proves the integration property end to end using the same functions the
 * app uses: materializeFromMonthStart (Fix 1) produces the real occurrence
 * dates for a given month; computeMonthTotals sums the resulting ledger
 * rows into the actual month total. monthlyEquivalent is a completely
 * separate figure (the 26/12 capacity-math average) that must never appear
 * mixed into a month's displayed total.
 */
import { describe, it, expect } from 'vitest';
import { materializeFromMonthStart } from '../dateHelpers';
import { computeMonthTotals, TxRow, AccountRow } from '../dashboardHelpers';
import { monthlyEquivalent } from '../incomeHelpers';

const CHEQUING_ID = 'chq-1';
const accounts: AccountRow[] = [{ id: CHEQUING_ID, type: 'chequing' }];

function makeTxns(dates: string[], amount: number, type: 'income' | 'expense'): TxRow[] {
  return dates.map((date) => ({ amount, type, account_id: CHEQUING_ID, date } as TxRow & { date: string }));
}

describe('real month totals vs. monthly-equivalent — the two figures never mix', () => {
  it('a normal two-payment July for a $1,500 bi-weekly mortgage totals exactly $3,000, not the $3,250 average', () => {
    const rule = { cadence: 'biweekly' as const, anchorDate: '2026-07-20' };
    const dates = materializeFromMonthStart(rule, '2026-07-20', 1)
      .filter((d) => d.startsWith('2026-07'));
    expect(dates).toEqual(['2026-07-06', '2026-07-20']); // 2 real occurrences

    const txns = makeTxns(dates, 1500, 'expense');
    const totals = computeMonthTotals(txns, accounts);

    expect(totals.totalExpenses).toBe(3000);
    // The capacity-math average is a different, larger number — proving the
    // real month total is not secretly the average.
    expect(monthlyEquivalent(1500, 'biweekly')).toBe(3250);
    expect(totals.totalExpenses).not.toBe(monthlyEquivalent(1500, 'biweekly'));
  });

  it('a genuine three-payment month for the same $1,500 bi-weekly mortgage totals exactly $4,500', () => {
    const rule = { cadence: 'biweekly' as const, anchorDate: '2026-07-01' };
    const dates = materializeFromMonthStart(rule, '2026-07-01', 1)
      .filter((d) => d.startsWith('2026-07'));
    expect(dates).toEqual(['2026-07-01', '2026-07-15', '2026-07-29']); // 3 real occurrences

    const txns = makeTxns(dates, 1500, 'expense');
    const totals = computeMonthTotals(txns, accounts);

    expect(totals.totalExpenses).toBe(4500);
    expect(totals.totalExpenses).not.toBe(monthlyEquivalent(1500, 'biweekly'));
  });

  it('capacity math (plan-generation / plausibility-guard) still uses the 26/12 average internally', () => {
    // This is the one place the average is supposed to survive — a real
    // month's ledger total must never substitute for it, and vice versa.
    expect(monthlyEquivalent(1500, 'biweekly')).toBe(3250);
    expect(monthlyEquivalent(2397.85, 'biweekly')).toBe(5195.34);
  });

  it('the two-payment and three-payment month totals never accidentally equal the average (no silent mixing)', () => {
    const average = monthlyEquivalent(1500, 'biweekly');
    const twoPaymentTotal = 1500 * 2;
    const threePaymentTotal = 1500 * 3;
    expect(twoPaymentTotal).not.toBe(average);
    expect(threePaymentTotal).not.toBe(average);
  });

  it('a bi-weekly income mortgage-equivalent scenario: two-occurrence month sums correctly for income too', () => {
    const rule = { cadence: 'biweekly' as const, anchorDate: '2026-07-20' };
    const dates = materializeFromMonthStart(rule, '2026-07-20', 1)
      .filter((d) => d.startsWith('2026-07'));
    const txns = makeTxns(dates, 2000, 'income');
    const totals = computeMonthTotals(txns, accounts);
    expect(totals.totalIncome).toBe(4000);
    expect(totals.totalIncome).not.toBe(monthlyEquivalent(2000, 'biweekly'));
  });
});
