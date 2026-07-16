import { describe, it, expect } from 'vitest';
import {
  reconcileMonth,
  chequingLedgerNet,
  ReconcileTxRow,
  ReconcileAccountRow,
} from '../reconcileHelpers';

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
