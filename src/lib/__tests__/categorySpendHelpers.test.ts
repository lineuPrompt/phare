import { describe, it, expect } from 'vitest';
import {
  householdCategoryActuals,
  householdCategoryActualRows,
  CategorySpendAccount,
} from '../categorySpendHelpers';
import { signedAmount, UNCATEGORIZED_ROW_ID, EnvTx } from '../envelopeHelpers';
import { computeMonthTotals, TxRow, AccountRow } from '../dashboardHelpers';

const CHEQUING = 'chq-1';
const VISA = 'visa-1';
const GOAL = 'goal-1';
const CAT_HOUSING = 'cat-housing';
const CAT_GROCERY = 'cat-grocery';

const DEFAULT_ACCOUNTS: CategorySpendAccount[] = [
  { id: CHEQUING, type: 'chequing' },
  { id: VISA, type: 'credit_card' },
  { id: GOAL, type: 'savings' },
];

// One fixture shape that structurally satisfies both EnvTx (for the new
// helper) and TxRow (for computeMonthTotals) — lets the same array feed both
// functions in the cross-check tests below, so there is no risk of the two
// fixtures silently drifting apart.
type Tx = {
  account_id: string;
  amount: number;
  type: string;
  date: string;
  category_id: string | null;
  is_bridge?: boolean;
};

function tx(overrides: Partial<Tx> & { amount: number; date: string }): Tx {
  return { account_id: CHEQUING, type: 'expense', category_id: CAT_GROCERY, ...overrides };
}

// ---------------------------------------------------------------------------
// THE property that matters most: a categorized transfer must never appear.
// ---------------------------------------------------------------------------

describe('categorized transfer rows are structurally excluded', () => {
  it('signedAmount returns null for a transfer row even when category_id is set', () => {
    const draw = { type: 'transfer', amount: -500, category_id: CAT_HOUSING } as unknown as EnvTx;
    expect(signedAmount(draw)).toBeNull();
  });

  it('a credit-line draw (transfer, negative amount, WITH a category_id) does not appear in any category slice', () => {
    const draw: Tx = {
      account_id: GOAL, amount: -500, type: 'transfer', date: '2026-06-10', category_id: CAT_HOUSING,
    };
    const result = householdCategoryActuals([draw] as EnvTx[], DEFAULT_ACCOUNTS, '2026-06');
    expect(result.has(CAT_HOUSING)).toBe(false);
    expect(result.size).toBe(0);
  });

  it('a categorized transfer does not leak into total either when mixed with real spend', () => {
    const txns: Tx[] = [
      tx({ amount: 200, date: '2026-06-05', category_id: CAT_HOUSING }),
      { account_id: GOAL, amount: -500, type: 'transfer', date: '2026-06-10', category_id: CAT_HOUSING },
    ];
    const result = householdCategoryActuals(txns as EnvTx[], DEFAULT_ACCOUNTS, '2026-06');
    // If the draw had leaked in, Housing would be 200 - 500 = -300.
    expect(result.get(CAT_HOUSING)).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Refund/income netting — account type distinguishes a card refund (nets)
// from real chequing income (excluded). Both directions regression-tested.
// ---------------------------------------------------------------------------

describe('card refund netting — regression, must not break', () => {
  it('an income (refund) row on a CARD nets against its category, same sign rule as categoryActualsForCard', () => {
    const txns: Tx[] = [
      tx({ account_id: VISA, amount: 80, type: 'expense', date: '2026-06-10', category_id: CAT_GROCERY }),
      tx({ account_id: VISA, amount: 10, type: 'income', date: '2026-06-15', category_id: CAT_GROCERY }),
    ];
    const result = householdCategoryActuals(txns as EnvTx[], DEFAULT_ACCOUNTS, '2026-06');
    expect(result.get(CAT_GROCERY)).toBe(70);
  });

  it('a category that nets to exactly 0 still appears (visible, not a phantom absence)', () => {
    const txns: Tx[] = [
      tx({ account_id: VISA, amount: 50, type: 'expense', date: '2026-06-10', category_id: CAT_GROCERY }),
      tx({ account_id: VISA, amount: 50, type: 'income', date: '2026-06-11', category_id: CAT_GROCERY }),
    ];
    const result = householdCategoryActuals(txns as EnvTx[], DEFAULT_ACCOUNTS, '2026-06');
    expect(result.has(CAT_GROCERY)).toBe(true);
    expect(result.get(CAT_GROCERY)).toBe(0);
  });
});

describe('chequing income is excluded — the step 1b fix', () => {
  it('chequing income (a paycheque, category_id null) is excluded entirely — Uncategorized = 150, not -2850', () => {
    // Step 1 (before this fix) yielded -2850 here: signedAmount netted the
    // paycheque as if it were a refund, because it can't tell "real income"
    // from "a refund" on its own. Step 1b fixes this by excluding
    // chequing-side income before signedAmount ever runs on it — the account
    // (not the row) is the signal, same distinction computeMonthTotals
    // already makes. See categorySpendHelpers.ts's file header, THE RULE.
    const txns: Tx[] = [
      tx({ amount: 150, date: '2026-06-06', category_id: null }),                 // a real uncategorized expense
      tx({ amount: 3000, date: '2026-06-01', type: 'income', category_id: null }), // a real paycheque
    ];
    const result = householdCategoryActuals(txns as EnvTx[], DEFAULT_ACCOUNTS, '2026-06');
    expect(result.get(UNCATEGORIZED_ROW_ID)).toBe(150);
  });

  it('a chequing income row WITH a category_id set is still excluded, not netted against that category', () => {
    // Someone will eventually categorize a paycheque (e.g. tag it "Salary").
    // It must not become negative spend under Housing just because it now
    // carries a category_id — account type is the only signal used, per the
    // instruction to avoid any category-naming or description heuristic.
    const txns: Tx[] = [
      tx({ amount: 200, date: '2026-06-05', category_id: CAT_HOUSING }),
      tx({ amount: 3000, date: '2026-06-01', type: 'income', category_id: CAT_HOUSING }),
    ];
    const result = householdCategoryActuals(txns as EnvTx[], DEFAULT_ACCOUNTS, '2026-06');
    expect(result.get(CAT_HOUSING)).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Uncategorized handling — explicit bucket, never silently dropped
// ---------------------------------------------------------------------------

describe('uncategorized transactions', () => {
  it('groups null-category transactions under the shared UNCATEGORIZED_ROW_ID, not dropped', () => {
    const txns: Tx[] = [
      tx({ amount: 40, date: '2026-06-05', category_id: null }),
    ];
    const result = householdCategoryActuals(txns as EnvTx[], DEFAULT_ACCOUNTS, '2026-06');
    expect(result.get(UNCATEGORIZED_ROW_ID)).toBe(40);
  });

  it('householdCategoryActualRows labels the uncategorized bucket with the caller-supplied label', () => {
    const txns: Tx[] = [
      tx({ amount: 40, date: '2026-06-05', category_id: null }),
      tx({ amount: 25, date: '2026-06-06', category_id: CAT_HOUSING }),
    ];
    const rows = householdCategoryActualRows(
      txns as EnvTx[], DEFAULT_ACCOUNTS, '2026-06', new Map([[CAT_HOUSING, 'Housing']]), 'Uncategorized'
    );
    const uncategorizedRow = rows.find((r) => r.categoryId === UNCATEGORIZED_ROW_ID);
    expect(uncategorizedRow?.categoryName).toBe('Uncategorized');
    expect(uncategorizedRow?.actual).toBe(40);
    const housingRow = rows.find((r) => r.categoryId === CAT_HOUSING);
    expect(housingRow?.categoryName).toBe('Housing');
  });
});

// ---------------------------------------------------------------------------
// Empty month — empty result, not zeroes for phantom categories
// ---------------------------------------------------------------------------

describe('a month with no transactions', () => {
  it('returns an empty map', () => {
    const result = householdCategoryActuals([], DEFAULT_ACCOUNTS, '2026-06');
    expect(result.size).toBe(0);
  });

  it('excludes transactions from other months', () => {
    const txns: Tx[] = [
      tx({ amount: 100, date: '2026-05-20', category_id: CAT_HOUSING }),
    ];
    const result = householdCategoryActuals(txns as EnvTx[], DEFAULT_ACCOUNTS, '2026-06');
    expect(result.size).toBe(0);
  });

  it('excludes bridge lines the same way categoryActualsForCard does', () => {
    const txns: Tx[] = [
      tx({ amount: 999, date: '2026-06-01', category_id: CAT_GROCERY, is_bridge: true }),
    ];
    const result = householdCategoryActuals(txns as EnvTx[], DEFAULT_ACCOUNTS, '2026-06');
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Cross-check against computeMonthTotals — the test that matters most for
// trust: prove where the two agree, and precisely quantify where they don't.
// ---------------------------------------------------------------------------

describe('consistency with computeMonthTotals', () => {
  it('sums to exactly totalExpenses when there is no credit-card activity (no timing shift possible)', () => {
    const accounts: AccountRow[] = [{ id: CHEQUING, type: 'chequing' }];
    const txns: Tx[] = [
      tx({ amount: 200, date: '2026-06-05', category_id: CAT_HOUSING }),
      tx({ amount: 150, date: '2026-06-06', category_id: null }), // uncategorized
    ];

    const totals = computeMonthTotals(txns as TxRow[], accounts);
    const categoryTotal = Array.from(householdCategoryActuals(txns as EnvTx[], accounts, '2026-06').values())
      .reduce((sum, v) => sum + v, 0);

    expect(totals.totalExpenses).toBe(350);
    expect(categoryTotal).toBe(350);
  });

  it('still agrees exactly when chequing income is present, now that it is excluded rather than netted', () => {
    // Re-derivation check: before step 1b this test would have failed (income
    // would have netted into Uncategorized and thrown the totals off by the
    // income amount). With the fix, income contributes to neither total, so
    // they still agree.
    const accounts: AccountRow[] = [{ id: CHEQUING, type: 'chequing' }];
    const txns: Tx[] = [
      tx({ amount: 200, date: '2026-06-05', category_id: CAT_HOUSING }),
      tx({ amount: 150, date: '2026-06-06', category_id: null }),
      tx({ amount: 3000, date: '2026-06-01', type: 'income', category_id: null }),
    ];

    const totals = computeMonthTotals(txns as TxRow[], accounts);
    const categoryTotal = Array.from(householdCategoryActuals(txns as EnvTx[], accounts, '2026-06').values())
      .reduce((sum, v) => sum + v, 0);

    expect(totals.totalExpenses).toBe(350);
    expect(categoryTotal).toBe(350);
  });

  it('legitimately diverges by exactly one card-cycle timing shift when a card is involved — documented, not a bug', () => {
    const accounts: AccountRow[] = [
      { id: CHEQUING, type: 'chequing' },
      { id: VISA, type: 'credit_card' },
    ];
    const txns: Tx[] = [
      // Chequing: a direct expense, plus this month's bridge payment — the
      // bridge represents LAST cycle's card spend ($150), landing now.
      tx({ amount: 200, date: '2026-06-05', category_id: CAT_HOUSING }),
      tx({ amount: 150, date: '2026-06-03', category_id: null, is_bridge: true }),
      // Card: THIS month's real spend, net of a refund — won't bridge into
      // chequing until next month, so computeMonthTotals can't see it yet.
      tx({ account_id: VISA, amount: 80, date: '2026-06-10', category_id: CAT_GROCERY }),
      tx({ account_id: VISA, amount: 10, date: '2026-06-15', type: 'income', category_id: CAT_GROCERY }),
    ];

    const totals = computeMonthTotals(txns as TxRow[], accounts);
    const categoryTotal = Array.from(householdCategoryActuals(txns as EnvTx[], accounts, '2026-06').values())
      .reduce((sum, v) => sum + v, 0);

    // Cash-flow view: chequing housing (200) + this month's bridge, i.e. LAST
    // cycle's card spend (150) = 350.
    expect(totals.totalExpenses).toBe(350);
    // Calendar-spend view: chequing housing (200) + THIS month's real card
    // net spend (80 - 10 = 70), not yet bridged = 270.
    expect(categoryTotal).toBe(270);
    // The $80 gap is exactly: this month's bridge line (last cycle, $150)
    // minus this month's own not-yet-bridged card net spend ($70). Not a
    // discrepancy — a one-card-cycle timing shift between "cash left the
    // household" (computeMonthTotals) and "money was spent" (this helper).
    expect(totals.totalExpenses - categoryTotal).toBe(80);
  });
});
