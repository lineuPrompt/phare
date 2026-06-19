import { describe, it, expect } from 'vitest';
import { groupPlannerSections, PlannerTxRow } from '../plannerHelpers';
import { AccountRow } from '../dashboardHelpers';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const CHEQUING_ID = 'chq-1';
const CARD_ID     = 'card-1';
const SAVINGS_ID  = 'sav-1';
const TFSA_ID     = 'tfsa-1';

const accounts: AccountRow[] = [
  { id: CHEQUING_ID, type: 'chequing'    },
  { id: CARD_ID,     type: 'credit_card' },
  { id: SAVINGS_ID,  type: 'savings'     },
  { id: TFSA_ID,     type: 'tfsa'        },
];

let seq = 0;
function tx(overrides: Partial<PlannerTxRow> & { amount: number }): PlannerTxRow {
  return {
    id: `tx-${++seq}`,
    type: 'expense',
    account_id: CHEQUING_ID,
    description: 'Test',
    date: '2026-06-15',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Three sections sum correctly from a mixed transaction set
// ---------------------------------------------------------------------------

describe('groupPlannerSections — section grouping', () => {
  it('income transactions go to the income section only', () => {
    const txns = [
      tx({ type: 'income', account_id: CHEQUING_ID, amount: 3000, description: 'Salary' }),
      tx({ type: 'income', account_id: CHEQUING_ID, amount: 203,  description: 'Child benefit' }),
    ];
    const { income, expenses, savings } = groupPlannerSections(txns, accounts);
    expect(income).toHaveLength(2);
    expect(expenses).toHaveLength(0);
    expect(savings).toHaveLength(0);
    expect(income.reduce((s, l) => s + l.amount, 0)).toBe(3203);
  });

  it('chequing expense transactions go to the expenses section only', () => {
    const txns = [
      tx({ type: 'expense', account_id: CHEQUING_ID, amount: 1800, description: 'Mortgage' }),
      tx({ type: 'expense', account_id: CHEQUING_ID, amount: 140,  description: 'Hydro' }),
    ];
    const { income, expenses, savings } = groupPlannerSections(txns, accounts);
    expect(expenses).toHaveLength(2);
    expect(income).toHaveLength(0);
    expect(savings).toHaveLength(0);
    expect(expenses.reduce((s, l) => s + l.amount, 0)).toBe(1940);
  });

  it('chequing transfer rows go to savings section only', () => {
    const txns = [
      tx({ type: 'transfer', account_id: CHEQUING_ID, amount: 200, goalAccountName: 'Disney Fund' }),
      tx({ type: 'transfer', account_id: SAVINGS_ID,  amount: 200 }), // goal-side — excluded
    ];
    const { income, expenses, savings } = groupPlannerSections(txns, accounts);
    expect(savings).toHaveLength(1);
    expect(income).toHaveLength(0);
    expect(expenses).toHaveLength(0);
    expect(savings[0].description).toBe('Disney Fund');
    expect(savings[0].amount).toBe(200);
  });

  it('mixed month: all three sections populated with correct sums', () => {
    const txns = [
      tx({ type: 'income',   account_id: CHEQUING_ID, amount: 5200, description: 'Salary' }),
      tx({ type: 'income',   account_id: CHEQUING_ID, amount: 203,  description: 'Child benefit' }),
      tx({ type: 'expense',  account_id: CHEQUING_ID, amount: 1800, description: 'Mortgage' }),
      tx({ type: 'expense',  account_id: CHEQUING_ID, amount: 920,  description: 'Visa Payment' }),
      tx({ type: 'transfer', account_id: CHEQUING_ID, amount: 200,  goalAccountName: 'Disney Fund' }),
      tx({ type: 'transfer', account_id: SAVINGS_ID,  amount: 200 }), // goal-side — excluded
    ];
    const { income, expenses, savings, totals } = groupPlannerSections(txns, accounts);
    expect(income.reduce((s, l) => s + l.amount, 0)).toBe(5403);
    expect(expenses.reduce((s, l) => s + l.amount, 0)).toBe(2720);
    expect(savings.reduce((s, l) => s + l.amount, 0)).toBe(200);
    expect(totals.totalIncome).toBe(5403);
    expect(totals.totalExpenses).toBe(2720);
    expect(totals.totalSavings).toBe(200);
    expect(totals.netCashFlow).toBe(2483); // 5403 - 2720 - 200
  });
});

// ---------------------------------------------------------------------------
// 2. Remaining cash = income − expenses − savings = netCashFlow
// ---------------------------------------------------------------------------

describe('groupPlannerSections — remaining cash invariant', () => {
  it('remaining cash equals totals.netCashFlow', () => {
    const cases: PlannerTxRow[][] = [
      [
        tx({ type: 'income',   account_id: CHEQUING_ID, amount: 5200 }),
        tx({ type: 'expense',  account_id: CHEQUING_ID, amount: 1800 }),
        tx({ type: 'transfer', account_id: CHEQUING_ID, amount: 500  }),
        tx({ type: 'transfer', account_id: SAVINGS_ID,  amount: 500  }),
      ],
      [
        tx({ type: 'income',  account_id: CHEQUING_ID, amount: 3000 }),
        tx({ type: 'expense', account_id: CHEQUING_ID, amount: 2800 }),
      ],
      [
        tx({ type: 'income',   account_id: CHEQUING_ID, amount: 7000 }),
        tx({ type: 'transfer', account_id: CHEQUING_ID, amount: 300  }),
        tx({ type: 'transfer', account_id: TFSA_ID,     amount: 300  }),
        tx({ type: 'transfer', account_id: CHEQUING_ID, amount: 500  }),
        tx({ type: 'transfer', account_id: SAVINGS_ID,  amount: 500  }),
      ],
    ];
    for (const txns of cases) {
      const { income, expenses, savings, totals } = groupPlannerSections(txns, accounts);
      const sectionNet =
        income.reduce((s, l) => s + l.amount, 0) -
        expenses.reduce((s, l) => s + l.amount, 0) -
        savings.reduce((s, l) => s + l.amount, 0);
      expect(totals.netCashFlow).toBeCloseTo(sectionNet, 10);
      expect(totals.netCashFlow).toBeCloseTo(
        totals.totalIncome - totals.totalExpenses - totals.totalSavings,
        10
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Double-count guard: card purchase + bridge → counted once (via bridge)
// ---------------------------------------------------------------------------

describe('groupPlannerSections — double-count guard', () => {
  it('card purchase excluded; bridge line counted once in expenses', () => {
    const txns = [
      tx({ type: 'income',  account_id: CHEQUING_ID, amount: 4000 }),
      tx({ type: 'expense', account_id: CARD_ID,     amount: 920  }), // raw card spend — EXCLUDED
      tx({ type: 'expense', account_id: CHEQUING_ID, amount: 920, description: 'Visa Payment' }), // bridge
    ];
    const { income, expenses, totals } = groupPlannerSections(txns, accounts);
    expect(expenses).toHaveLength(1);
    expect(expenses[0].description).toBe('Visa Payment');
    expect(totals.totalExpenses).toBe(920);  // counted once
    expect(totals.totalIncome).toBe(4000);
    expect(totals.netCashFlow).toBe(3080);
  });

  it('card purchase and bridge together do not inflate expenses section', () => {
    const txns = [
      tx({ type: 'expense', account_id: CARD_ID,     amount: 650 }), // card
      tx({ type: 'expense', account_id: CHEQUING_ID, amount: 650 }), // bridge
    ];
    const { expenses } = groupPlannerSections(txns, accounts);
    expect(expenses.reduce((s, l) => s + l.amount, 0)).toBe(650);
  });
});

// ---------------------------------------------------------------------------
// 4. Transfer appears in savings, never in expenses
// ---------------------------------------------------------------------------

describe('groupPlannerSections — transfer bucket invariant', () => {
  it('chequing-side transfer is in savings, not expenses', () => {
    const txns = [
      tx({ type: 'transfer', account_id: CHEQUING_ID, amount: 500, goalAccountName: 'TFSA' }),
      tx({ type: 'transfer', account_id: TFSA_ID,     amount: 500 }),
    ];
    const { expenses, savings } = groupPlannerSections(txns, accounts);
    expect(expenses).toHaveLength(0);
    expect(savings).toHaveLength(1);
    expect(savings[0].amount).toBe(500);
  });

  it('goal-side transfer row does not appear in any section', () => {
    const txns = [
      tx({ type: 'transfer', account_id: SAVINGS_ID, amount: 300 }), // goal-side only
    ];
    const { income, expenses, savings } = groupPlannerSections(txns, accounts);
    expect(income).toHaveLength(0);
    expect(expenses).toHaveLength(0);
    expect(savings).toHaveLength(0);
  });

  it('multiple transfers to different goal accounts all land in savings', () => {
    const txns = [
      tx({ type: 'income',   account_id: CHEQUING_ID, amount: 6000 }),
      tx({ type: 'transfer', account_id: CHEQUING_ID, amount: 300,  goalAccountName: 'Disney Fund' }),
      tx({ type: 'transfer', account_id: SAVINGS_ID,  amount: 300  }),
      tx({ type: 'transfer', account_id: CHEQUING_ID, amount: 500,  goalAccountName: 'TFSA' }),
      tx({ type: 'transfer', account_id: TFSA_ID,     amount: 500  }),
    ];
    const { expenses, savings, totals } = groupPlannerSections(txns, accounts);
    expect(expenses).toHaveLength(0);
    expect(savings).toHaveLength(2);
    expect(totals.totalSavings).toBe(800);
  });
});

// ---------------------------------------------------------------------------
// 5. Empty month renders zeros, not errors
// ---------------------------------------------------------------------------

describe('groupPlannerSections — empty month', () => {
  it('empty transaction list returns all-zero sections and totals', () => {
    const { income, expenses, savings, totals } = groupPlannerSections([], accounts);
    expect(income).toHaveLength(0);
    expect(expenses).toHaveLength(0);
    expect(savings).toHaveLength(0);
    expect(totals.totalIncome).toBe(0);
    expect(totals.totalExpenses).toBe(0);
    expect(totals.totalSavings).toBe(0);
    expect(totals.netCashFlow).toBe(0);
  });

  it('empty transaction list with no accounts also returns zeros without throwing', () => {
    const { income, expenses, savings, totals } = groupPlannerSections([], []);
    expect(income).toHaveLength(0);
    expect(expenses).toHaveLength(0);
    expect(savings).toHaveLength(0);
    expect(totals.netCashFlow).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. goalAccountName takes priority over description for savings lines
// ---------------------------------------------------------------------------

describe('groupPlannerSections — savings line label', () => {
  it('uses goalAccountName when present', () => {
    const txns = [
      tx({ type: 'transfer', account_id: CHEQUING_ID, amount: 100, description: null, goalAccountName: 'Disney Fund' }),
      tx({ type: 'transfer', account_id: SAVINGS_ID,  amount: 100 }),
    ];
    const { savings } = groupPlannerSections(txns, accounts);
    expect(savings[0].description).toBe('Disney Fund');
  });

  it('falls back to description when goalAccountName is absent', () => {
    const txns = [
      tx({ type: 'transfer', account_id: CHEQUING_ID, amount: 100, description: 'Emergency fund', goalAccountName: undefined }),
      tx({ type: 'transfer', account_id: SAVINGS_ID,  amount: 100 }),
    ];
    const { savings } = groupPlannerSections(txns, accounts);
    expect(savings[0].description).toBe('Emergency fund');
  });

  it('empty string when both goalAccountName and description are absent', () => {
    const txns = [
      tx({ type: 'transfer', account_id: CHEQUING_ID, amount: 100, description: null, goalAccountName: undefined }),
      tx({ type: 'transfer', account_id: SAVINGS_ID,  amount: 100 }),
    ];
    const { savings } = groupPlannerSections(txns, accounts);
    expect(savings[0].description).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 7. String amounts (Supabase numeric type)
// ---------------------------------------------------------------------------

describe('groupPlannerSections — string amounts', () => {
  it('handles amounts passed as strings from Supabase', () => {
    const txns = [
      { id: 'a', type: 'income',  account_id: CHEQUING_ID, amount: '5200.50' as unknown as number, description: 'Salary', date: '2026-06-01' },
      { id: 'b', type: 'expense', account_id: CHEQUING_ID, amount: '800.25'  as unknown as number, description: 'Bill',   date: '2026-06-10' },
    ];
    const { income, expenses, totals } = groupPlannerSections(txns, accounts);
    expect(income[0].amount).toBe(5200.5);
    expect(expenses[0].amount).toBe(800.25);
    expect(totals.netCashFlow).toBe(4400.25);
  });
});
