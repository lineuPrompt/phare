/**
 * The opening-balance invariants, asserted rather than assumed.
 *
 * The headline one — NO OPENING-BALANCE ROW MAY EXIST ON A CHEQUING ACCOUNT
 * — used to be a convention living in a code comment. It matters because
 * breaking it is silent: a positive 'transfer' row on chequing is
 * double-counted against that account's balance anchor AND read as an
 * outflow by chequingLedgerNet, so the two reconcile paths simply stop
 * agreeing with no error anywhere. It is enforced in three independent
 * places now, and each is checked here:
 *
 *   1. the API guard        — acceptsOpeningBalance(), used by both routes
 *   2. the database trigger — enforce_opening_balance_account_type
 *   3. the balance math     — nothing else counts a goal row as cash flow
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  acceptsOpeningBalance,
  computeGoalBalance,
  computeMonthTotals,
  type AccountRow,
  type TxRow,
} from '../dashboardHelpers';
import { reconcileMonth, chequingLedgerNet, type ReconcileAccountRow, type ReconcileTxRow } from '../reconcileHelpers';

const MIGRATION = fs.readFileSync(
  path.join(process.cwd(), 'supabase', 'migrations', '20260831000000_transactions_is_opening_balance.sql'),
  'utf8'
);

describe('acceptsOpeningBalance — the API guard', () => {
  it('accepts every goal account type', () => {
    for (const t of ['savings', 'tfsa', 'rrsp', 'debt']) {
      expect(acceptsOpeningBalance(t)).toBe(true);
    }
  });

  it('REFUSES chequing — the reconcile-breaking case', () => {
    expect(acceptsOpeningBalance('chequing')).toBe(false);
  });

  it('refuses card types, whose balances are envelope-derived', () => {
    expect(acceptsOpeningBalance('credit_card')).toBe(false);
    expect(acceptsOpeningBalance('line_of_credit')).toBe(false);
  });

  it('refuses an unknown type rather than defaulting open', () => {
    expect(acceptsOpeningBalance('')).toBe(false);
    expect(acceptsOpeningBalance('brokerage')).toBe(false);
  });
});

describe('the database enforces it too, not just the API', () => {
  it('the trigger rejects any account type outside the goal set', () => {
    expect(MIGRATION).toMatch(/CREATE TRIGGER trg_enforce_opening_balance_account_type/);
    expect(MIGRATION).toMatch(/BEFORE INSERT OR UPDATE ON transactions/);
    // The allow-list inside the trigger body must be the goal types, so a
    // chequing row raises rather than inserting.
    const body = MIGRATION.slice(MIGRATION.indexOf('enforce_opening_balance_account_type()'));
    expect(body).toMatch(/NOT IN \('savings', 'tfsa', 'rrsp', 'debt'\)/);
    expect(body).toMatch(/RAISE EXCEPTION/);
  });

  it('guards UPDATE as well as INSERT, so a row cannot be flipped later', () => {
    expect(MIGRATION).toMatch(/BEFORE INSERT OR UPDATE/);
  });

  it('allows at most one opening balance per account', () => {
    expect(MIGRATION).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_one_opening_balance_per_account[\s\S]*?ON transactions \(account_id\)[\s\S]*?WHERE is_opening_balance/
    );
  });

  it('backfills only transfer rows on goal accounts', () => {
    const backfill = MIGRATION.slice(MIGRATION.indexOf('UPDATE transactions t'), MIGRATION.indexOf('CREATE UNIQUE INDEX'));
    expect(backfill).toMatch(/t\.type = 'transfer'/);
    expect(backfill).toMatch(/a\.type IN \('savings', 'tfsa', 'rrsp', 'debt'\)/);
    // 'Balance correction' is the debt re-baselining delta and means
    // something different — it must not be swept up.
    expect(backfill).not.toMatch(/Balance correction/);
  });
});

// ---------------------------------------------------------------------------
// The behavioural half: what an opening-balance row does to every figure.
// ---------------------------------------------------------------------------

const CHEQUING = 'acct-chq';
const GOAL = 'acct-goal';

const accounts: ReconcileAccountRow[] = [
  { id: CHEQUING, type: 'chequing', name: 'Chequing', is_sinking_fund: false },
  { id: GOAL, type: 'savings', name: 'Vacation', is_sinking_fund: false },
];

/** A household: one paycheque, one real contribution, one stated opening balance. */
const rows: ReconcileTxRow[] = [
  { id: 't1', date: '2026-08-01', description: 'Pay', amount: 3000, type: 'income', account_id: CHEQUING },
  { id: 't2', date: '2026-08-05', description: 'Contribution', amount: 200, type: 'transfer', account_id: CHEQUING, transfer_peer_id: 't3' },
  { id: 't3', date: '2026-08-05', description: 'Contribution', amount: 200, type: 'transfer', account_id: GOAL, transfer_peer_id: 't2' },
  { id: 't4', date: '2026-08-10', description: 'Starting balance', amount: 500, type: 'transfer', account_id: GOAL },
];

describe('an opening balance sums into the goal balance', () => {
  it('counts toward the balance, and therefore toward goal progress', () => {
    // Goal progress divides this same figure by goal_target — there is no
    // separate contributions-only numerator (GoalsSection reads goal.balance).
    expect(computeGoalBalance(rows as TxRow[], GOAL, '2026-08-31')).toBe(700);
  });

  it('is excluded once the cutoff precedes it, like any other dated row', () => {
    expect(computeGoalBalance(rows as TxRow[], GOAL, '2026-08-07')).toBe(200);
  });
});

describe('an opening balance is never household cash flow', () => {
  it('does not inflate totalSavings', () => {
    const totals = computeMonthTotals(rows as TxRow[], accounts as AccountRow[]);
    // The $200 real contribution only. The $500 seed is not money that moved.
    expect(totals.totalSavings).toBe(200);
    expect(totals.netCashFlow).toBe(2800);
  });

  it('keeps both reconcile paths in agreement', () => {
    const result = reconcileMonth(rows, accounts);
    expect(result.netFromBuckets).toBe(2800);
    expect(result.netFromChequing).toBe(2800);
    expect(result.netDifference).toBe(0);
    expect(result.reconciled).toBe(true);
  });

  it('THE FAILURE THE GUARD PREVENTS: the same row on chequing invents $500 of saving', () => {
    // Measured, not assumed. Putting the identical row on chequing turns a
    // stated starting position into a phantom outflow: the household is told
    // they saved $700 when they saved $200, and their net cash flow drops by
    // $500 that never left the account.
    const broken: ReconcileTxRow[] = [
      ...rows.slice(0, 3),
      { id: 't4', date: '2026-08-10', description: 'Starting balance', amount: 500, type: 'transfer', account_id: CHEQUING },
    ];
    const totals = computeMonthTotals(broken as TxRow[], accounts as AccountRow[]);
    expect(totals.totalSavings).toBe(700);   // correct answer is 200
    expect(totals.netCashFlow).toBe(2300);   // correct answer is 2800

    // AND RECONCILIATION WOULD NOT CATCH IT. Both paths classify a positive
    // chequing transfer as an outflow, so they agree — on the wrong number.
    // This is precisely why the rule is enforced at the API and in the
    // database rather than left for the audit to notice: the audit cannot.
    const result = reconcileMonth(broken, accounts);
    expect(result.netDifference).toBe(0);
    expect(result.reconciled).toBe(true);
  });

  it('and it would show on the Timeline, which renders rows by account_id', () => {
    // The Timeline query is .eq('account_id', chequingId). A goal-side row is
    // structurally invisible to it on any date; a chequing-side row is not.
    const timelineRows = (rs: ReconcileTxRow[]) => rs.filter((r) => r.account_id === CHEQUING);
    expect(timelineRows(rows)).toHaveLength(2);                 // pay + the real contribution
    const broken: ReconcileTxRow[] = [
      ...rows.slice(0, 3),
      { id: 't4', date: '2026-08-10', description: 'Starting balance', amount: 500, type: 'transfer', account_id: CHEQUING },
    ];
    expect(timelineRows(broken)).toHaveLength(3);               // a movement that never happened
  });
});

describe('a sinking-fund buffer behaves like any other goal account', () => {
  const bufferAccounts: ReconcileAccountRow[] = [
    { id: CHEQUING, type: 'chequing', name: 'Chequing', is_sinking_fund: false },
    { id: GOAL, type: 'savings', name: 'Sinking funds', is_sinking_fund: true },
  ];

  it('its opening balance still counts in the balance and not in either net', () => {
    // The buffer is the one account type that partially passes
    // chequingLedgerNet's filter (its EXPENSE rows are real outflows), so it
    // is the one most likely to leak. Only expenses count there — a transfer
    // row on it must not.
    expect(computeGoalBalance(rows as TxRow[], GOAL, '2026-08-31')).toBe(700);
    expect(chequingLedgerNet(rows, bufferAccounts)).toBe(2800);
    expect(reconcileMonth(rows, bufferAccounts).netDifference).toBe(0);
  });
});

describe('a debt opening balance is negative and still behaves', () => {
  const debtAccounts: ReconcileAccountRow[] = [
    { id: CHEQUING, type: 'chequing', name: 'Chequing', is_sinking_fund: false },
    { id: GOAL, type: 'debt', name: 'Credit Line', is_sinking_fund: false },
  ];
  const debtRows: ReconcileTxRow[] = [
    { id: 'd1', date: '2026-08-01', description: 'Pay', amount: 3000, type: 'income', account_id: CHEQUING },
    { id: 'd2', date: '2026-08-10', description: 'Starting balance', amount: -5000, type: 'transfer', account_id: GOAL },
  ];

  it('shows as owed without touching either net', () => {
    expect(computeGoalBalance(debtRows as TxRow[], GOAL, '2026-08-31')).toBe(-5000);
    const result = reconcileMonth(debtRows, debtAccounts);
    expect(result.netFromBuckets).toBe(3000);
    expect(result.netFromChequing).toBe(3000);
    expect(result.reconciled).toBe(true);
  });

  it('is not counted as borrowed cash — no money entered chequing', () => {
    expect(computeMonthTotals(debtRows as TxRow[], debtAccounts as AccountRow[]).totalBorrowed).toBe(0);
  });
});
