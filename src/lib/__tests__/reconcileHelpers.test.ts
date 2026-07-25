import { describe, it, expect } from 'vitest';
import {
  reconcileMonth,
  chequingLedgerNet,
  ReconcileTxRow,
  ReconcileAccountRow,
} from '../reconcileHelpers';
import { signedAmount } from '../envelopeHelpers';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const CHQ = 'chq-1';
const CARD = 'card-1';
const SAV = 'sav-1';

const accounts: ReconcileAccountRow[] = [
  { id: CHQ,  type: 'chequing',     name: 'Chequing'  },
  { id: CARD, type: 'credit_card',  name: 'Visa'      },
  { id: SAV,  type: 'savings',      name: 'Emergency' },
];

let _id = 0;
function tx(
  overrides: Partial<ReconcileTxRow> & { amount: number; type: string }
): ReconcileTxRow {
  return {
    id: `tx-${++_id}`,
    date: '2026-06-15',
    description: null,
    account_id: CHQ,
    is_bridge: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Normal month — both nets match
// ---------------------------------------------------------------------------

describe('reconcileMonth — normal month', () => {
  it('two nets match on a month with income, expenses, bridge line, and transfer', () => {
    const transactions: ReconcileTxRow[] = [
      // Income deposited into chequing
      tx({ type: 'income',   account_id: CHQ,  amount: 5200 }),
      // Regular chequing expense
      tx({ type: 'expense',  account_id: CHQ,  amount: 3240 }),
      // Card spending (on card account — excluded from chequing net)
      tx({ type: 'expense',  account_id: CARD, amount: 600  }),
      // Bridge payment: card spending appears as chequing expense next month
      tx({ type: 'expense',  account_id: CHQ,  amount: 600, is_bridge: true }),
      // Transfer out to savings
      tx({ type: 'transfer', account_id: CHQ,  amount: 600  }),
      tx({ type: 'transfer', account_id: SAV,  amount: 600  }), // goal-side
    ];

    const result = reconcileMonth(transactions, accounts);

    // Bucket breakdown
    expect(result.totalIncome).toBe(5200);
    expect(result.totalExpenses).toBe(3840);  // 3240 + 600 bridge
    expect(result.totalSavings).toBe(600);
    expect(result.totalBridgePayments).toBe(600);

    // Both nets must match
    expect(result.netFromBuckets).toBe(760);   // 5200 − 3840 − 600
    expect(result.netFromChequing).toBe(760);  // 5200 − 3840 − 600 (chequing direct)
    expect(result.netDifference).toBe(0);
    expect(result.reconciled).toBe(true);
  });

  it('net = income − expenses − savings via both paths', () => {
    const transactions: ReconcileTxRow[] = [
      tx({ type: 'income',   account_id: CHQ, amount: 4000 }),
      tx({ type: 'expense',  account_id: CHQ, amount: 1500 }),
      tx({ type: 'transfer', account_id: CHQ, amount: 500  }),
      tx({ type: 'transfer', account_id: SAV, amount: 500  }),
    ];
    const result = reconcileMonth(transactions, accounts);
    expect(result.netFromBuckets).toBe(2000);
    expect(result.netFromChequing).toBe(2000);
    expect(result.reconciled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Card refunds — Phase 1 fix (2026-07-16)
//
// This describe block used to assert the OPPOSITE of what it now asserts:
// it treated "income posted to a card account creates a non-zero
// netDifference" as a *feature* proving the dual-path audit catches breaks,
// explicitly commented "not a realistic scenario". It was realistic — Build
// 2 introduced card refunds ("money in" entries on a credit_card account,
// type='income', netting against that card's spend) — and this exact shape
// was the real, persistent reconciliation mismatch the founder saw live,
// unrelated to bridge timing. computeMonthTotals now scopes income to
// chequing (dashboardHelpers.ts), matching chequingLedgerNet, so a card
// refund is excluded from BOTH paths and reconciliation holds.
// ---------------------------------------------------------------------------

describe('reconcileMonth — card refunds do not break reconciliation', () => {
  it('a card refund (income on a credit_card account) is excluded from both paths — reconciled', () => {
    const transactions: ReconcileTxRow[] = [
      tx({ type: 'income',  account_id: CARD, amount: 500 }), // card refund — not household income
      tx({ type: 'expense', account_id: CHQ,  amount: 300 }),
    ];

    const result = reconcileMonth(transactions, accounts);

    expect(result.totalIncome).toBe(0);           // card refund excluded, not counted as income
    expect(result.netFromBuckets).toBe(-300);     // 0 − 300 − 0
    expect(result.netFromChequing).toBe(-300);     // chequing: 0 in − 300 out
    expect(result.netDifference).toBe(0);
    expect(result.reconciled).toBe(true);
  });

  it('a real household income row plus a card refund in the same month both classify correctly', () => {
    const transactions: ReconcileTxRow[] = [
      tx({ type: 'income',  account_id: CARD, amount: 1000 }), // card refund — excluded
      tx({ type: 'income',  account_id: CHQ,  amount: 3000 }), // real paycheque
      tx({ type: 'expense', account_id: CHQ,  amount: 2000 }),
    ];
    const result = reconcileMonth(transactions, accounts);
    expect(result.totalIncome).toBe(3000); // card refund never enters household income
    expect(result.reconciled).toBe(true);
    expect(result.netDifference).toBe(0);
  });

  it('a refund that fully offsets that month\'s card spend still reconciles', () => {
    const transactions: ReconcileTxRow[] = [
      tx({ type: 'income',   account_id: CHQ,  amount: 4000 }),
      tx({ type: 'expense',  account_id: CARD, amount: 150  }), // card spend — excluded from chequing net
      tx({ type: 'income',   account_id: CARD, amount: 150  }), // full refund on the same card
      tx({ type: 'expense',  account_id: CHQ,  amount: 2500 }),
    ];
    const result = reconcileMonth(transactions, accounts);
    expect(result.reconciled).toBe(true);
    expect(result.netDifference).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Account balances — each account reconciles to its own ledger
// ---------------------------------------------------------------------------

describe('reconcileMonth — per-account balances', () => {
  it('chequing account balance = income − expenses − transfers for the month', () => {
    const transactions: ReconcileTxRow[] = [
      tx({ type: 'income',   account_id: CHQ, amount: 3000 }),
      tx({ type: 'expense',  account_id: CHQ, amount: 1200 }),
      tx({ type: 'transfer', account_id: CHQ, amount: 300  }),
      tx({ type: 'transfer', account_id: SAV, amount: 300  }),
    ];
    const result = reconcileMonth(transactions, accounts);
    const chq = result.accounts.find((a) => a.accountId === CHQ)!;
    expect(chq.monthBalance).toBe(1500); // 3000 − 1200 − 300
  });

  it('credit card account balance = sum of card expense transactions', () => {
    const transactions: ReconcileTxRow[] = [
      tx({ type: 'expense', account_id: CARD, amount: 200 }),
      tx({ type: 'expense', account_id: CARD, amount: 150 }),
    ];
    const result = reconcileMonth(transactions, accounts);
    const card = result.accounts.find((a) => a.accountId === CARD)!;
    expect(card.monthBalance).toBe(350);
  });

  // Regression for the reconcile-vs-envelopes drift (2026-07-25): the
  // credit_card branch used to sum only expense rows, silently dropping
  // refund (income) rows, while Card Envelopes (envelopeHelpers.ts's
  // signedAmount) already netted them. Fixture mirrors the real Visa Avion
  // July 2026 data that surfaced the $129.33 gap ($4,008.18 expense-only vs.
  // the correct $3,878.85 net). Asserted against signedAmount's own output,
  // not a hardcoded number, so the two derivations can never silently
  // re-diverge.
  it('credit card balance nets refunds (income) against expenses, agreeing with envelopeHelpers signedAmount', () => {
    const transactions: ReconcileTxRow[] = [
      tx({ type: 'expense', account_id: CARD, amount: 3000 }),
      tx({ type: 'expense', account_id: CARD, amount: 1008.18 }),
      tx({ type: 'income',  account_id: CARD, amount: 23.20 }),
      tx({ type: 'income',  account_id: CARD, amount: 19.00 }),
      tx({ type: 'income',  account_id: CARD, amount: 51.69 }),
      tx({ type: 'income',  account_id: CARD, amount: 35.44 }),
    ];

    const result = reconcileMonth(transactions, accounts);
    const card = result.accounts.find((a) => a.accountId === CARD)!;

    const expectedFromSignedAmount = transactions
      .filter((t) => t.account_id === CARD)
      .reduce((sum, t) => sum + (signedAmount(t) ?? 0), 0);

    expect(card.monthBalance).toBeCloseTo(expectedFromSignedAmount, 2);
    expect(card.monthBalance).toBeCloseTo(3878.85, 2);
  });

  it('goal account balance = sum of transfer inflows', () => {
    const transactions: ReconcileTxRow[] = [
      tx({ type: 'transfer', account_id: CHQ, amount: 400 }),
      tx({ type: 'transfer', account_id: SAV, amount: 400 }),
    ];
    const result = reconcileMonth(transactions, accounts);
    const sav = result.accounts.find((a) => a.accountId === SAV)!;
    expect(sav.monthBalance).toBe(400);
  });

  it('each account lists only its own transactions', () => {
    const transactions: ReconcileTxRow[] = [
      tx({ type: 'income',  account_id: CHQ,  amount: 5000 }),
      tx({ type: 'expense', account_id: CARD, amount: 800  }),
    ];
    const result = reconcileMonth(transactions, accounts);
    const chq  = result.accounts.find((a) => a.accountId === CHQ)!;
    const card = result.accounts.find((a) => a.accountId === CARD)!;
    expect(chq.transactions).toHaveLength(1);
    expect(card.transactions).toHaveLength(1);
    expect(chq.transactions[0].amount).toBe(5000);
    expect(card.transactions[0].amount).toBe(800);
  });
});

// ---------------------------------------------------------------------------
// 4. Empty month — zeros and ✓ match (0 = 0)
// ---------------------------------------------------------------------------

describe('reconcileMonth — empty month', () => {
  it('returns all zeros and reconciled=true for a month with no transactions', () => {
    const result = reconcileMonth([], accounts);
    expect(result.totalIncome).toBe(0);
    expect(result.totalExpenses).toBe(0);
    expect(result.totalSavings).toBe(0);
    expect(result.totalDebtPayments).toBe(0);
    expect(result.totalBorrowed).toBe(0);
    expect(result.totalBridgePayments).toBe(0);
    expect(result.netFromBuckets).toBe(0);
    expect(result.netFromChequing).toBe(0);
    expect(result.netDifference).toBe(0);
    expect(result.reconciled).toBe(true);
  });

  it('each account has monthBalance=0 and empty transaction list', () => {
    const result = reconcileMonth([], accounts);
    for (const acct of result.accounts) {
      expect(acct.monthBalance).toBe(0);
      expect(acct.transactions).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 4b. Per-transaction display fields — category name and installment label
//     pass through to the audit line (additive fields for the Phase B "raw
//     transaction list" moved from Expenses onto Audit).
// ---------------------------------------------------------------------------

describe('reconcileMonth — category and installment passthrough', () => {
  it('carries categoryName and installmentLabel onto each account transaction line', () => {
    const transactions: ReconcileTxRow[] = [
      tx({ type: 'expense', account_id: CHQ, amount: 50, categoryName: 'Groceries', installment_label: '2/12' }),
    ];
    const result = reconcileMonth(transactions, accounts);
    const chq = result.accounts.find((a) => a.accountId === CHQ)!;
    expect(chq.transactions[0].categoryName).toBe('Groceries');
    expect(chq.transactions[0].installmentLabel).toBe('2/12');
  });

  it('defaults both to null when absent', () => {
    const transactions: ReconcileTxRow[] = [tx({ type: 'expense', account_id: CHQ, amount: 50 })];
    const result = reconcileMonth(transactions, accounts);
    const chq = result.accounts.find((a) => a.accountId === CHQ)!;
    expect(chq.transactions[0].categoryName).toBeNull();
    expect(chq.transactions[0].installmentLabel).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. chequingLedgerNet — standalone
// ---------------------------------------------------------------------------

describe('chequingLedgerNet', () => {
  it('sums only chequing rows with correct signs', () => {
    const transactions: ReconcileTxRow[] = [
      tx({ type: 'income',   account_id: CHQ,  amount: 4000 }),
      tx({ type: 'expense',  account_id: CHQ,  amount: 1500 }),
      tx({ type: 'transfer', account_id: CHQ,  amount: 500  }),
      tx({ type: 'expense',  account_id: CARD, amount: 999  }), // excluded
    ];
    expect(chequingLedgerNet(transactions, accounts)).toBe(2000); // 4000−1500−500
  });

  it('returns 0 for empty transactions', () => {
    expect(chequingLedgerNet([], accounts)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Sinking fund reconciliation invariant (Build 4 Part 2, 2026-07-21)
//
// A bill paid straight from a sinking fund is the one expense that never
// bridges through chequing — money leaves the household right on the fund
// account. Both independent paths (computeMonthTotals via reconcileMonth,
// and chequingLedgerNet) had to learn this fact identically, or reconciled
// would flip permanently false the first time any bill was ever paid this
// way. This is the exact regression this section guards.
// ---------------------------------------------------------------------------

const FUND = 'fund-1';
const accountsWithFund: ReconcileAccountRow[] = [
  ...accounts,
  { id: FUND, type: 'savings', name: 'Property tax fund', is_sinking_fund: true },
];

describe('reconcileMonth — sinking fund contribution and bill payment stay reconciled', () => {
  it('a chequing→fund contribution reconciles (relocation, not a household expense)', () => {
    const transactions: ReconcileTxRow[] = [
      tx({ type: 'income',   account_id: CHQ,  amount: 5000 }),
      tx({ type: 'transfer', account_id: CHQ,  amount: 300  }),
      tx({ type: 'transfer', account_id: FUND, amount: 300  }),
    ];
    const result = reconcileMonth(transactions, accountsWithFund);
    expect(result.totalExpenses).toBe(0);
    expect(result.totalSavings).toBe(300);
    expect(result.netFromBuckets).toBe(4700);
    expect(result.netFromChequing).toBe(4700);
    expect(result.reconciled).toBe(true);
  });

  it('a bill paid from the fund reconciles — a real household expense on a non-chequing account', () => {
    const transactions: ReconcileTxRow[] = [
      tx({ type: 'income',  account_id: CHQ,  amount: 5000 }),
      tx({ type: 'expense', account_id: FUND, amount: 3600 }), // property tax, paid from the fund
    ];
    const result = reconcileMonth(transactions, accountsWithFund);
    expect(result.totalExpenses).toBe(3600);
    expect(result.netFromBuckets).toBe(1400);
    expect(result.netFromChequing).toBe(1400);
    expect(result.reconciled).toBe(true);
  });

  it('the fund\'s own account audit balance rises with contributions and drops with the bill payment', () => {
    const transactions: ReconcileTxRow[] = [
      tx({ type: 'transfer', account_id: CHQ,  amount: 300, date: '2026-01-15' }),
      tx({ type: 'transfer', account_id: FUND, amount: 300, date: '2026-01-15' }),
      tx({ type: 'expense',  account_id: FUND, amount: 200, date: '2026-01-20' }),
    ];
    const result = reconcileMonth(transactions, accountsWithFund);
    const fund = result.accounts.find((a) => a.accountId === FUND)!;
    expect(fund.monthBalance).toBe(100); // 300 in − 200 out
  });

  it('full-cycle invariant: a year of contributions then the bill payment stays reconciled at every step', () => {
    // Jan–Feb contributions, March bill payment, April contribution again —
    // the "reset" is just the real expense row, no special logic needed.
    const months: ReconcileTxRow[][] = [
      [ // January — contribution
        tx({ type: 'income',   account_id: CHQ,  amount: 5000, date: '2026-01-15' }),
        tx({ type: 'transfer', account_id: CHQ,  amount: 300,  date: '2026-01-15' }),
        tx({ type: 'transfer', account_id: FUND, amount: 300,  date: '2026-01-15' }),
      ],
      [ // February — contribution
        tx({ type: 'income',   account_id: CHQ,  amount: 5000, date: '2026-02-15' }),
        tx({ type: 'transfer', account_id: CHQ,  amount: 300,  date: '2026-02-15' }),
        tx({ type: 'transfer', account_id: FUND, amount: 300,  date: '2026-02-15' }),
      ],
      [ // March — the bill lands, paid from the fund
        tx({ type: 'income',  account_id: CHQ,  amount: 5000, date: '2026-03-15' }),
        tx({ type: 'expense', account_id: FUND, amount: 600,  date: '2026-03-01' }),
      ],
      [ // April — refilling again
        tx({ type: 'income',   account_id: CHQ,  amount: 5000, date: '2026-04-15' }),
        tx({ type: 'transfer', account_id: CHQ,  amount: 300,  date: '2026-04-15' }),
        tx({ type: 'transfer', account_id: FUND, amount: 300,  date: '2026-04-15' }),
      ],
    ];
    for (const monthTxns of months) {
      const result = reconcileMonth(monthTxns, accountsWithFund);
      expect(result.reconciled).toBe(true);
      expect(result.netDifference).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Debt draws (Build 4, 2026-08-01)
//
// The live bug this feature fixes: a founder drew $2,000 from his credit
// line to cover expenses. Before this change there was no draw concept at
// all — the household had to type a plain type='income' row on chequing
// (inflating totalIncome and netCashFlow, reading as a healthy surplus) plus
// an unlinked negative transfer row on the debt account, with nothing
// enforcing they agreed. Path 1 (buckets) and path 2 (chequingLedgerNet)
// both had to learn the same new fact — a negative chequing-side transfer is
// borrowed, not savings, and excluded from net — independently, the same
// dual-path lesson the Phase 1 income-scope fix and the sinking-fund fix
// above each already had to learn once.
// ---------------------------------------------------------------------------

const DEBT = 'debt-1';
const accountsWithDebt: ReconcileAccountRow[] = [
  ...accounts,
  { id: DEBT, type: 'debt', name: 'Credit Line' },
];

describe('chequingLedgerNet — debt draws', () => {
  it('a draw contributes neither an inflow nor an outflow — skipped entirely', () => {
    const transactions: ReconcileTxRow[] = [
      tx({ type: 'income',   account_id: CHQ,  amount: 3000 }),
      tx({ type: 'expense',  account_id: CHQ,  amount: 3005 }), // $5 short
      tx({ type: 'transfer', account_id: CHQ,  amount: -2000 }), // draw — real cash, but skipped here
      tx({ type: 'transfer', account_id: DEBT, amount: -2000 }),
    ];
    // 3000 income − 3005 expense = −5, exactly as if the draw never happened.
    expect(chequingLedgerNet(transactions, accountsWithDebt)).toBe(-5);
  });

  it('a draw and a payment on the same debt account both net correctly', () => {
    const transactions: ReconcileTxRow[] = [
      tx({ type: 'transfer', account_id: CHQ,  amount: -1000 }), // draw — skipped
      tx({ type: 'transfer', account_id: DEBT, amount: -1000 }),
      tx({ type: 'transfer', account_id: CHQ,  amount: 400 }),   // payment — outflow
      tx({ type: 'transfer', account_id: DEBT, amount: 400 }),
    ];
    expect(chequingLedgerNet(transactions, accountsWithDebt)).toBe(-400);
  });
});

// ---------------------------------------------------------------------------
// Reconciliation screen fix (2026-08-01): debt payments split out of
// "Savings transfers" — same math, separate bucket. chequingLedgerNet (path
// 2) is untouched — it doesn't classify by destination, so both a debt
// payment and a savings contribution are still just "a chequing outflow" to
// it, exactly as before. Only path 1's bucket labeling changes.
// ---------------------------------------------------------------------------

describe('chequingLedgerNet — unaffected by the debt-payment/savings split', () => {
  it('a debt payment nets the same way whether or not the peer link is available to path 1', () => {
    const transactions: ReconcileTxRow[] = [
      tx({ id: 'chq-1', type: 'transfer', account_id: CHQ,  amount: 833.33, transfer_peer_id: 'debt-1' }),
      tx({ id: 'debt-1', type: 'transfer', account_id: DEBT, amount: 833.33, transfer_peer_id: 'chq-1' }),
    ];
    expect(chequingLedgerNet(transactions, accountsWithDebt)).toBe(-833.33);
  });
});

describe('reconcileMonth — debt payments vs savings split', () => {
  it('a debt payment is bucketed as totalDebtPayments, dual-net still agrees', () => {
    const transactions: ReconcileTxRow[] = [
      tx({ type: 'income',    account_id: CHQ,  amount: 3000 }),
      tx({ id: 'chq-1', type: 'transfer', account_id: CHQ,  amount: 833.33, transfer_peer_id: 'debt-1' }),
      tx({ id: 'debt-1', type: 'transfer', account_id: DEBT, amount: 833.33, transfer_peer_id: 'chq-1' }),
    ];
    const result = reconcileMonth(transactions, accountsWithDebt);
    expect(result.totalDebtPayments).toBe(833.33);
    expect(result.totalSavings).toBe(0);
    expect(result.netFromBuckets).toBe(2166.67); // 3000 − 833.33, same as the old single-bucket total
    expect(result.netFromChequing).toBe(2166.67);
    expect(result.reconciled).toBe(true);
  });

  it('a debt payment and a savings contribution in the same month land in separate buckets, still fully reconciled', () => {
    const transactions: ReconcileTxRow[] = [
      tx({ type: 'income',    account_id: CHQ,  amount: 5000 }),
      tx({ id: 'chq-1', type: 'transfer', account_id: CHQ,  amount: 833.33, transfer_peer_id: 'debt-1' }),
      tx({ id: 'debt-1', type: 'transfer', account_id: DEBT, amount: 833.33, transfer_peer_id: 'chq-1' }),
      tx({ id: 'chq-2', type: 'transfer', account_id: CHQ,  amount: 300, transfer_peer_id: 'sav-1' }),
      tx({ id: 'sav-1', type: 'transfer', account_id: SAV,  amount: 300, transfer_peer_id: 'chq-2' }),
    ];
    const result = reconcileMonth(transactions, accountsWithDebt);
    expect(result.totalDebtPayments).toBe(833.33);
    expect(result.totalSavings).toBe(300);
    expect(result.reconciled).toBe(true);
    expect(result.netDifference).toBe(0);
  });

  it('a debt payment and a draw in the same month are classified into three separate, correct buckets', () => {
    const transactions: ReconcileTxRow[] = [
      tx({ type: 'income',    account_id: CHQ,  amount: 3000 }),
      tx({ id: 'chq-pay', type: 'transfer', account_id: CHQ,  amount: 400, transfer_peer_id: 'debt-pay' }),
      tx({ id: 'debt-pay', type: 'transfer', account_id: DEBT, amount: 400, transfer_peer_id: 'chq-pay' }),
      tx({ type: 'transfer', account_id: CHQ,  amount: -1000 }), // draw, unlinked in this fixture on purpose
      tx({ type: 'transfer', account_id: DEBT, amount: -1000 }),
    ];
    const result = reconcileMonth(transactions, accountsWithDebt);
    expect(result.totalDebtPayments).toBe(400);
    expect(result.totalBorrowed).toBe(1000);
    expect(result.totalSavings).toBe(0);
    expect(result.reconciled).toBe(true);
  });
});

describe('reconcileMonth — the founder scenario, fixed: a draw never reads as surplus', () => {
  it('a $2,000 draw covering a real $5 shortfall reconciles at netCashFlow = −5, not +1995', () => {
    const transactions: ReconcileTxRow[] = [
      tx({ type: 'income',   account_id: CHQ,  amount: 3000 }),
      tx({ type: 'expense',  account_id: CHQ,  amount: 3005 }),
      tx({ type: 'transfer', account_id: CHQ,  amount: -2000, description: 'Credit Line (draw)' }),
      tx({ type: 'transfer', account_id: DEBT, amount: -2000, description: 'Credit Line (draw)' }),
    ];
    const result = reconcileMonth(transactions, accountsWithDebt);
    // Verify the draw is not hiding inside Income: it is type='transfer',
    // never type='income', so totalIncome must be exactly the real salary
    // row — unaffected by a $2,000 draw landing in the same month.
    expect(result.totalIncome).toBe(3000);
    expect(result.totalBorrowed).toBe(2000);
    expect(result.netFromBuckets).toBe(-5);
    expect(result.netFromChequing).toBe(-5);
    expect(result.netDifference).toBe(0);
    expect(result.reconciled).toBe(true);

    // The debt account's own audit balance shows the draw made it worse —
    // never framed as a positive inflow.
    const debtAcct = result.accounts.find((a) => a.accountId === DEBT)!;
    expect(debtAcct.monthBalance).toBe(-2000);

    // And the real chequing balance genuinely did rise — the cash IS there,
    // it's simply not surplus. monthBalance = income − expense − transfer =
    // 3000 − 3005 − (−2000) = 1995.
    const chqAcct = result.accounts.find((a) => a.accountId === CHQ)!;
    expect(chqAcct.monthBalance).toBe(1995);
  });

  it('full-cycle invariant: draw → payment → draw stays reconciled at every step', () => {
    const months: ReconcileTxRow[][] = [
      [ // July — draw
        tx({ type: 'income',   account_id: CHQ,  amount: 3000, date: '2026-07-15' }),
        tx({ type: 'expense',  account_id: CHQ,  amount: 3005, date: '2026-07-20' }),
        tx({ type: 'transfer', account_id: CHQ,  amount: -2000, date: '2026-07-21' }),
        tx({ type: 'transfer', account_id: DEBT, amount: -2000, date: '2026-07-21' }),
      ],
      [ // August — payment, paying part of it back down
        tx({ type: 'income',   account_id: CHQ,  amount: 3000, date: '2026-08-15' }),
        tx({ type: 'expense',  account_id: CHQ,  amount: 2500, date: '2026-08-20' }),
        tx({ type: 'transfer', account_id: CHQ,  amount: 500,  date: '2026-08-31' }),
        tx({ type: 'transfer', account_id: DEBT, amount: 500,  date: '2026-08-31' }),
      ],
      [ // September — another draw
        tx({ type: 'income',   account_id: CHQ,  amount: 3000, date: '2026-09-15' }),
        tx({ type: 'expense',  account_id: CHQ,  amount: 4200, date: '2026-09-20' }),
        tx({ type: 'transfer', account_id: CHQ,  amount: -1000, date: '2026-09-25' }),
        tx({ type: 'transfer', account_id: DEBT, amount: -1000, date: '2026-09-25' }),
      ],
    ];
    for (const monthTxns of months) {
      const result = reconcileMonth(monthTxns, accountsWithDebt);
      expect(result.reconciled).toBe(true);
      expect(result.netDifference).toBe(0);
    }
  });
});
