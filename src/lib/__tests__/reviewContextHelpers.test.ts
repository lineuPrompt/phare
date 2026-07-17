import { describe, it, expect } from 'vitest';
import { detectWindfalls } from '../reviewContextHelpers';

const LINEU_PAYCHEQUE = { id: 'ri-1', description: "Lineu's paycheque", cadence: 'biweekly', type: 'income' };
const JULIA_PAYCHEQUE = { id: 'ri-2', description: "Julia's paycheque", cadence: 'semimonthly', type: 'income' };
const MORTGAGE = { id: 'ri-3', description: 'Mortgage', cadence: 'biweekly', type: 'expense' };
const RENT = { id: 'ri-4', description: 'Rent', cadence: 'monthly', type: 'expense' };
const RRSP_CONTRIBUTION = { id: 'ri-5', description: 'RRSP contribution', cadence: 'monthly', type: 'transfer' };

describe('detectWindfalls', () => {
  it('flags a three-occurrence month for a normally-2x biweekly paycheque', () => {
    const txns = [
      { recurring_item_id: 'ri-1', amount: 2749 },
      { recurring_item_id: 'ri-1', amount: 2749 },
      { recurring_item_id: 'ri-1', amount: 2749 },
    ];
    const flags = detectWindfalls(txns, [LINEU_PAYCHEQUE]);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toEqual({
      label: "Lineu's paycheque",
      type: 'income',
      cadence: 'biweekly',
      occurrences: 3,
      typicalOccurrences: 2,
      amount: 2749,
    });
  });

  it('does not flag a normal two-occurrence biweekly month', () => {
    const txns = [
      { recurring_item_id: 'ri-1', amount: 2749 },
      { recurring_item_id: 'ri-1', amount: 2749 },
    ];
    expect(detectWindfalls(txns, [LINEU_PAYCHEQUE])).toHaveLength(0);
  });

  it('flags an extra (third) mortgage payment the same way as income', () => {
    const txns = [
      { recurring_item_id: 'ri-3', amount: 1200 },
      { recurring_item_id: 'ri-3', amount: 1200 },
      { recurring_item_id: 'ri-3', amount: 1200 },
    ];
    const flags = detectWindfalls(txns, [MORTGAGE]);
    expect(flags).toEqual([{
      label: 'Mortgage', type: 'expense', cadence: 'biweekly', occurrences: 3, typicalOccurrences: 2, amount: 1200,
    }]);
  });

  it('never flags monthly or semimonthly items — they always land at their typical count by construction', () => {
    const txns = [
      { recurring_item_id: 'ri-2', amount: 2742 },
      { recurring_item_id: 'ri-2', amount: 2742 },
      { recurring_item_id: 'ri-4', amount: 1500 },
    ];
    expect(detectWindfalls(txns, [JULIA_PAYCHEQUE, RENT])).toHaveLength(0);
  });

  it('ignores transfer-type recurring items (contributions/debt payments) — income/expense only', () => {
    const txns = [
      { recurring_item_id: 'ri-5', amount: 500 },
      { recurring_item_id: 'ri-5', amount: 500 },
      { recurring_item_id: 'ri-5', amount: 500 },
    ];
    expect(detectWindfalls(txns, [RRSP_CONTRIBUTION])).toHaveLength(0);
  });

  it('ignores transactions with no recurring_item_id (one-off entries)', () => {
    const txns = [
      { recurring_item_id: null, amount: 999 },
      { recurring_item_id: null, amount: 999 },
      { recurring_item_id: null, amount: 999 },
    ];
    expect(detectWindfalls(txns, [])).toHaveLength(0);
  });

  it('flags multiple independent windfalls in the same month', () => {
    const txns = [
      { recurring_item_id: 'ri-1', amount: 2749 },
      { recurring_item_id: 'ri-1', amount: 2749 },
      { recurring_item_id: 'ri-1', amount: 2749 },
      { recurring_item_id: 'ri-3', amount: 1200 },
      { recurring_item_id: 'ri-3', amount: 1200 },
      { recurring_item_id: 'ri-3', amount: 1200 },
    ];
    const flags = detectWindfalls(txns, [LINEU_PAYCHEQUE, MORTGAGE]);
    expect(flags).toHaveLength(2);
    expect(flags.map((f) => f.label).sort()).toEqual(['Lineu\'s paycheque', 'Mortgage'].sort());
  });

  it('handles a weekly cadence (typical 4/month), flagging a 5-occurrence month', () => {
    const weeklyItem = { id: 'ri-6', description: 'Weekly allowance', cadence: 'weekly', type: 'income' };
    const txns = Array.from({ length: 5 }, () => ({ recurring_item_id: 'ri-6', amount: 100 }));
    const flags = detectWindfalls(txns, [weeklyItem]);
    expect(flags).toEqual([{
      label: 'Weekly allowance', type: 'income', cadence: 'weekly', occurrences: 5, typicalOccurrences: 4, amount: 100,
    }]);
  });
});
