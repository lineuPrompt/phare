import { describe, it, expect } from 'vitest';
import {
  householdCategoryActuals,
  householdCategoryActualRows,
} from '../categorySpendHelpers';
import { signedAmount, UNCATEGORIZED_ROW_ID, EnvTx } from '../envelopeHelpers';
import { computeMonthTotals, TxRow, AccountRow } from '../dashboardHelpers';

const CHEQUING = 'chq-1';
const VISA = 'visa-1';
const GOAL = 'goal-1';
const CAT_HOUSING = 'cat-housing';
const CAT_GROCERY = 'cat-grocery';

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
    const result = householdCategoryActuals([draw] as EnvTx[], '2026-06');
    expect(result.has(CAT_HOUSING)).toBe(false);
    expect(result.size).toBe(0);
  });

  it('a categorized transfer does not leak into total either when mixed with real spend', () => {
    const txns: Tx[] = [
      tx({ amount: 200, date: '2026-06-05', category_id: CAT_HOUSING }),
      { account_id: GOAL, amount: -500, type: 'transfer', date: '2026-06-10', category_id: CAT_HOUSING },
    ];
    const result = householdCategoryActuals(txns as EnvTx[], '2026-06');
    // If the draw had leaked in, Housing would be 200 - 500 = -300.
    expect(result.get(CAT_HOUSING)).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Refund/income netting — consistent with signedAmount and Card Envelopes
// ---------------------------------------------------------------------------

describe('refund netting', () => {
  it('an income (refund) row nets against its category, same sign rule as categoryActualsForCard', () => {
    const txns: Tx[] = [
      tx({ account_id: VISA, amount: 80, type: 'expense', date: '2026-06-10', category_id: CAT_GROCERY }),
      tx({ account_id: VISA, amount: 10, type: 'income', date: '2026-06-15', category_id: CAT_GROCERY }),
    ];
    const result = householdCategoryActuals(txns as EnvTx[], '2026-06');
    expect(result.get(CAT_GROCERY)).toBe(70);
  });

  it('a category that nets to exactly 0 still appears (visible, not a phantom absence)', () => {
    const txns: Tx[] = [
      tx({ account_id: VISA, amount: 50, type: 'expense', date: '2026-06-10', category_id: CAT_GROCERY }),
      tx({ account_id: VISA, amount: 50, type: 'income', date: '2026-06-11', category_id: CAT_GROCERY }),
    ];
    const result = householdCategoryActuals(txns as EnvTx[], '2026-06');
    expect(result.has(CAT_GROCERY)).toBe(true);
    expect(result.get(CAT_GROCERY)).toBe(0);
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
    const result = householdCategoryActuals(txns as EnvTx[], '2026-06');
    expect(result.get(UNCATEGORIZED_ROW_ID)).toBe(40);
  });

  it('householdCategoryActualRows labels the uncategorized bucket with the caller-supplied label', () => {
    const txns: Tx[] = [
      tx({ amount: 40, date: '2026-06-05', category_id: null }),
      tx({ amount: 25, date: '2026-06-06', category_id: CAT_HOUSING }),
    ];
    const rows = householdCategoryActualRows(
      txns as EnvTx[], '2026-06', new Map([[CAT_HOUSING, 'Housing']]), 'Uncategorized'
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
    const result = householdCategoryActuals([], '2026-06');
    expect(result.size).toBe(0);
  });

  it('excludes transactions from other months', () => {
    const txns: Tx[] = [
      tx({ amount: 100, date: '2026-05-20', category_id: CAT_HOUSING }),
    ];
    const result = householdCategoryActuals(txns as EnvTx[], '2026-06');
    expect(result.size).toBe(0);
  });

  it('excludes bridge lines the same way categoryActualsForCard does', () => {
    const txns: Tx[] = [
      tx({ amount: 999, date: '2026-06-01', category_id: CAT_GROCERY, is_bridge: true }),
    ];
    const result = householdCategoryActuals(txns as EnvTx[], '2026-06');
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
    const categoryTotal = Array.from(householdCategoryActuals(txns as EnvTx[], '2026-06').values())
      .reduce((sum, v) => sum + v, 0);

    expect(totals.totalExpenses).toBe(350);
    expect(categoryTotal).toBe(350);
  });

  // KNOWN GAP — surfaced by this audit, not fixed here (see file header of
  // categorySpendHelpers.ts). Deliberately left as a documented, pinned
  // behavior rather than patched, since patching it means deciding how to
  // tell "real income" apart from "a refund," a scope decision this build
  // step doesn't own.
  it('KNOWN GAP: real chequing income (a paycheque, category_id null) nets NEGATIVE into Uncategorized — signedAmount cannot tell a paycheque from a refund', () => {
    // save-plan/route.ts always saves income recurring rows with
    // category_id: null and account_id = chequing (never a card) — so this
    // is not a hypothetical fixture, it is exactly how every real household's
    // paycheque row looks. categoryActualsForCard never sees this problem
    // because it's scoped to one card and paycheques never land on a card;
    // summing household-wide (this helper) makes it a live risk.
    const txns: Tx[] = [
      tx({ amount: 150, date: '2026-06-06', category_id: null }),         // a real uncategorized expense
      tx({ amount: 3000, date: '2026-06-01', type: 'income', category_id: null }), // a real paycheque
    ];
    const result = householdCategoryActuals(txns as EnvTx[], '2026-06');
    // Honest expectation given the current, unmodified signedAmount reuse:
    // 150 (expense) - 3000 (income, netted as if it were a refund) = -2850.
    // A chart rendering this bucket as "Uncategorized spend: -$2850" would be
    // nonsensical. This test exists to keep that fact visible, not to argue
    // it's acceptable.
    expect(result.get(UNCATEGORIZED_ROW_ID)).toBe(-2850);
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
    const categoryTotal = Array.from(householdCategoryActuals(txns as EnvTx[], '2026-06').values())
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
