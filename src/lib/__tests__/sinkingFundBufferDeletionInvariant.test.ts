import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reconcileMonth, type ReconcileTxRow, type ReconcileAccountRow } from '../reconcileHelpers';

/**
 * Sinking fund buffer deletion (Build 4 Part A lifecycle, 2026-07-21) —
 * deletion invariant.
 *
 * Unlike a real goal/debt account, the buffer can carry TWO kinds of real
 * history: type='transfer' rows (contributions, same shape as a goal) AND
 * type='expense' rows (bills paid straight from the fund, Build 4 Part 2) —
 * these have no chequing-side peer to relabel, so delete_goal_account's
 * blanket "delete every row on this account" would silently erase a real
 * bill payment. delete_sinking_fund_buffer instead:
 *   1. Relabels (never deletes) PAST chequing-side transfer peers.
 *   2. REASSIGNS past bill-payment (expense) rows to chequing, relabeled —
 *      the only way to keep them alive once the fund account is gone.
 *   3. Deletes FUTURE transfers entirely, both sides.
 *   4. Deletes FUTURE bill payments (speculative, never really happened).
 *   5. Deletes the recurring rule(s) targeting this account (active AND any
 *      historically-superseded row from an earlier amount edit).
 *   6. Deletes the fund account itself.
 *   7. Reconciliation for the CURRENT month must agree before and after.
 *
 * Drives the actual exported DELETE handler (/api/accounts/[id]) against an
 * in-memory fake Supabase whose rpc('delete_sinking_fund_buffer', ...)
 * faithfully reimplements the real SQL function — same convention as
 * goalDeletionInvariant.test.ts.
 */

type Row = Record<string, unknown> & { id: string };

function makeFakeSupabase(seed: {
  users: Row[]; accounts: Row[]; transactions: Row[]; recurring_items: Row[]; households?: Row[];
}) {
  const store: Record<string, Row[]> = {
    users: [...seed.users],
    accounts: [...seed.accounts],
    transactions: [...seed.transactions],
    recurring_items: [...seed.recurring_items],
    households: [...(seed.households ?? [])],
  };

  function selectChain(rows: Row[]) {
    let result = rows;
    const api = {
      eq(field: string, value: unknown) { result = result.filter((r) => r[field] === value); return api; },
      in(field: string, values: unknown[]) { result = result.filter((r) => values.includes(r[field])); return api; },
      single() {
        return Promise.resolve(result[0] ? { data: { ...result[0] }, error: null } : { data: null, error: { message: 'not found' } });
      },
      maybeSingle() {
        return Promise.resolve({ data: result[0] ? { ...result[0] } : null, error: null });
      },
      then(resolve: (v: { data: Row[]; error: null }) => unknown) {
        return Promise.resolve({ data: result.map((r) => ({ ...r })), error: null }).then(resolve);
      },
    };
    return api;
  }

  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from(table: string) {
      const rows = store[table];
      if (!rows) throw new Error(`fake supabase: unknown table "${table}"`);
      return {
        select() { return selectChain(rows); },
      };
    },
    // Faithful reimplementation of
    // 20260727000000_delete_sinking_fund_buffer.sql's delete_sinking_fund_buffer.
    rpc(name: string, params: Record<string, unknown>) {
      if (name !== 'delete_sinking_fund_buffer') throw new Error(`fake supabase: unexpected rpc "${name}"`);
      const householdId = params.p_household_id as string;
      const accountId = params.p_account_id as string;
      const today = params.p_today as string;

      const chequing = store.accounts.find((a) => a.household_id === householdId && a.type === 'chequing');
      const chequingId = chequing!.id;

      const fundRows = store.transactions.filter((t) => t.household_id === householdId && t.account_id === accountId);
      const pastTransferIds = new Set(
        fundRows.filter((t) => t.type === 'transfer' && (t.date as string) <= today).map((t) => t.id)
      );
      const futureTransferIds = new Set(
        fundRows.filter((t) => t.type === 'transfer' && (t.date as string) > today).map((t) => t.id)
      );

      // 1. Relabel past chequing-side transfer peers.
      let relabeledChequing = 0;
      store.transactions = store.transactions.map((t) => {
        if (t.household_id === householdId && pastTransferIds.has(t.transfer_peer_id as string)) {
          relabeledChequing += 1;
          return { ...t, description: 'Transfer to deleted sinking fund' };
        }
        return t;
      });

      // 2. Reassign + relabel past bill payments (expense rows) to chequing.
      let relabeledBills = 0;
      store.transactions = store.transactions.map((t) => {
        if (t.household_id === householdId && t.account_id === accountId && t.type === 'expense' && (t.date as string) <= today) {
          relabeledBills += 1;
          return { ...t, account_id: chequingId, description: `${t.description} (paid from since-deleted sinking fund)` };
        }
        return t;
      });

      // 3. Delete future transfers, both sides.
      const futurePeerIds = new Set(
        store.transactions.filter((t) => futureTransferIds.has(t.id)).map((t) => t.transfer_peer_id).filter(Boolean)
      );
      store.transactions = store.transactions.filter(
        (t) => !(futureTransferIds.has(t.id) || futurePeerIds.has(t.id))
      );

      // 4. Delete future bill payments.
      const deletedFutureBills = store.transactions.filter(
        (t) => t.household_id === householdId && t.account_id === accountId && t.type === 'expense' && (t.date as string) > today
      ).length;
      store.transactions = store.transactions.filter(
        (t) => !(t.household_id === householdId && t.account_id === accountId && t.type === 'expense' && (t.date as string) > today)
      );

      // 5. Delete remaining (past) fund-side transfer rows.
      const deletedPast = store.transactions.filter((t) => t.account_id === accountId).length;
      store.transactions = store.transactions.filter((t) => t.account_id !== accountId);

      // 6. Cancel every recurring rule targeting this account (active or not).
      const hadRecurring = store.recurring_items.some(
        (r) => r.household_id === householdId && r.destination_account_id === accountId && r.type === 'transfer'
      );
      store.recurring_items = store.recurring_items.filter(
        (r) => !(r.household_id === householdId && r.destination_account_id === accountId && r.type === 'transfer')
      );

      // 7. Delete the account.
      store.accounts = store.accounts.filter((a) => !(a.id === accountId && a.household_id === householdId));

      return Promise.resolve({
        data: {
          relabeledChequingRows: relabeledChequing,
          relabeledBillPayments: relabeledBills,
          deletedFutureRows: deletedFutureBills,
          deletedPastFundRows: deletedPast,
          deletedRecurringRule: hadRecurring,
        },
        error: null,
      });
    },
    currentTransactions(): Row[] { return store.transactions; },
    currentAccounts(): Row[] { return store.accounts; },
    currentRecurringItems(): Row[] { return store.recurring_items; },
  };

  return supabase;
}

const HOUSEHOLD = 'hh-1';
const CHEQUING = 'acc-chq';
const FUND = 'acc-fund';
const TODAY = '2026-07-17';

function accountsFixture(): ReconcileAccountRow[] {
  return [
    { id: CHEQUING, type: 'chequing', name: 'Chequing' },
    { id: FUND, type: 'savings', name: 'Sinking funds', is_sinking_fund: true },
  ];
}

function reconcileCurrentMonth(supabase: ReturnType<typeof makeFakeSupabase>) {
  const txns = supabase.currentTransactions()
    .filter((r) => (r.date as string).startsWith('2026-07'))
    .map((r) => ({
      id: r.id,
      date: r.date as string,
      description: (r.description ?? null) as string | null,
      amount: Number(r.amount),
      type: r.type as string,
      account_id: (r.account_id ?? null) as string | null,
      is_bridge: Boolean(r.is_bridge),
    })) as ReconcileTxRow[];
  return reconcileMonth(txns, accountsFixture());
}

vi.mock('@/lib/supabase-server', () => ({
  createClient: vi.fn(),
}));

describe('Sinking fund buffer deletion — honest consequences, atomicity, reconciliation invariant', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function seedScenario() {
    return makeFakeSupabase({
      users: [{ id: 'user-1', household_id: HOUSEHOLD }],
      households: [{ id: HOUSEHOLD, timezone: 'America/Toronto' }],
      accounts: [
        { id: CHEQUING, household_id: HOUSEHOLD, type: 'chequing', name: 'Chequing' },
        { id: FUND, household_id: HOUSEHOLD, type: 'savings', name: 'Sinking funds', is_sinking_fund: true },
      ],
      transactions: [
        // Unrelated chequing income, this month — reconciliation baseline.
        { id: 'e1', household_id: HOUSEHOLD, account_id: CHEQUING, amount: 5000, type: 'income', date: '2026-07-01', description: 'Salary', is_bridge: false },
        // A PAST contribution pair (already happened).
        { id: 'past-fund', household_id: HOUSEHOLD, account_id: FUND, amount: 708, type: 'transfer', date: '2026-07-05', description: 'Sinking funds', transfer_peer_id: 'past-chq', recurring_item_id: 'ri-1' },
        { id: 'past-chq', household_id: HOUSEHOLD, account_id: CHEQUING, amount: 708, type: 'transfer', date: '2026-07-05', description: 'Sinking funds', transfer_peer_id: 'past-fund', recurring_item_id: 'ri-1' },
        // A PAST bill payment (real expense, no chequing-side peer).
        { id: 'bill-1', household_id: HOUSEHOLD, account_id: FUND, amount: 300, type: 'expense', date: '2026-07-10', description: 'Property tax', is_bridge: false },
        // A FUTURE materialized contribution pair (recurring rule, hasn't happened yet).
        { id: 'future-fund', household_id: HOUSEHOLD, account_id: FUND, amount: 708, type: 'transfer', date: '2026-08-05', description: 'Sinking funds', transfer_peer_id: 'future-chq', recurring_item_id: 'ri-1' },
        { id: 'future-chq', household_id: HOUSEHOLD, account_id: CHEQUING, amount: 708, type: 'transfer', date: '2026-08-05', description: 'Sinking funds', transfer_peer_id: 'future-fund', recurring_item_id: 'ri-1' },
        // A speculative FUTURE-dated bill payment (never really happened).
        { id: 'future-bill', household_id: HOUSEHOLD, account_id: FUND, amount: 400, type: 'expense', date: '2026-09-01', description: 'Christmas' },
      ],
      recurring_items: [
        { id: 'ri-1', household_id: HOUSEHOLD, destination_account_id: FUND, type: 'transfer', active: true },
        // A historically-superseded rule from an earlier contribution-amount
        // edit (Timeline Part B split model) — still references this
        // account and must be cleaned up too, not just the active one.
        { id: 'ri-0', household_id: HOUSEHOLD, destination_account_id: FUND, type: 'transfer', active: false },
      ],
    });
  }

  it('reconciliation for the current month agrees BEFORE deletion (baseline, with a real bill payment already in the ledger)', () => {
    const supabase = seedScenario();
    const result = reconcileCurrentMonth(supabase);
    expect(result.reconciled).toBe(true);
  });

  it('deletes both sides of the FUTURE contribution and the speculative future bill entirely', async () => {
    const supabase = seedScenario();
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    vi.setSystemTime(new Date(TODAY + 'T12:00:00'));
    vi.useFakeTimers();
    try {
      const { DELETE } = await import('../../app/api/accounts/[id]/route');
      const res = await DELETE(
        new Request(`http://localhost/api/accounts/${FUND}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id: FUND }) }
      );
      expect(res.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }

    const remaining = supabase.currentTransactions();
    expect(remaining.find((t) => t.id === 'future-fund')).toBeUndefined();
    expect(remaining.find((t) => t.id === 'future-chq')).toBeUndefined();
    expect(remaining.find((t) => t.id === 'future-bill')).toBeUndefined();
  });

  it('preserves the PAST chequing-side transfer row, relabeled — never deletes real chequing history', async () => {
    const supabase = seedScenario();
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    vi.setSystemTime(new Date(TODAY + 'T12:00:00'));
    vi.useFakeTimers();
    try {
      const { DELETE } = await import('../../app/api/accounts/[id]/route');
      await DELETE(
        new Request(`http://localhost/api/accounts/${FUND}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id: FUND }) }
      );
    } finally {
      vi.useRealTimers();
    }

    const pastChq = supabase.currentTransactions().find((t) => t.id === 'past-chq');
    expect(pastChq).toBeDefined();
    expect(pastChq!.description).toBe('Transfer to deleted sinking fund');
    expect(pastChq!.amount).toBe(708); // amount untouched — real money, real history
    // The past fund-side row itself is gone (the account it belonged to no longer exists).
    expect(supabase.currentTransactions().find((t) => t.id === 'past-fund')).toBeUndefined();
  });

  it('reassigns the PAST bill payment to chequing, relabeled — never silently erases a real expense', async () => {
    const supabase = seedScenario();
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    vi.setSystemTime(new Date(TODAY + 'T12:00:00'));
    vi.useFakeTimers();
    try {
      const { DELETE } = await import('../../app/api/accounts/[id]/route');
      const res = await DELETE(
        new Request(`http://localhost/api/accounts/${FUND}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id: FUND }) }
      );
      const body = await res.json();
      expect(body.relabeledBillPayments).toBe(1);
    } finally {
      vi.useRealTimers();
    }

    const bill = supabase.currentTransactions().find((t) => t.id === 'bill-1');
    expect(bill).toBeDefined();
    expect(bill!.account_id).toBe(CHEQUING); // reassigned — the fund account no longer exists
    expect(bill!.amount).toBe(300); // amount untouched — real money really left the household
    expect(bill!.type).toBe('expense');
    expect(bill!.description).toBe('Property tax (paid from since-deleted sinking fund)');
  });

  it('cancels EVERY recurring rule targeting this account (active and historically-superseded) and deletes the account', async () => {
    const supabase = seedScenario();
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    vi.setSystemTime(new Date(TODAY + 'T12:00:00'));
    vi.useFakeTimers();
    try {
      const { DELETE } = await import('../../app/api/accounts/[id]/route');
      const res = await DELETE(
        new Request(`http://localhost/api/accounts/${FUND}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id: FUND }) }
      );
      const body = await res.json();
      expect(body.deletedRecurringRule).toBe(true);
    } finally {
      vi.useRealTimers();
    }

    expect(supabase.currentRecurringItems()).toHaveLength(0); // both ri-1 (active) and ri-0 (frozen) gone
    expect(supabase.currentAccounts().find((a) => a.id === FUND)).toBeUndefined();
  });

  it('reconciliation for the current month still agrees AFTER deletion, including the reassigned bill payment', async () => {
    const supabase = seedScenario();
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    vi.setSystemTime(new Date(TODAY + 'T12:00:00'));
    vi.useFakeTimers();
    try {
      const { DELETE } = await import('../../app/api/accounts/[id]/route');
      await DELETE(
        new Request(`http://localhost/api/accounts/${FUND}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id: FUND }) }
      );
    } finally {
      vi.useRealTimers();
    }

    const result = reconcileCurrentMonth(supabase);
    expect(result.reconciled).toBe(true);
    expect(result.netDifference).toBe(0);
    // The household's real net cash for the month is unchanged by the
    // deletion itself: the past contribution (708, relabeled but still a
    // real chequing-side transfer this month) still counts as savings, and
    // the bill payment (300, now reassigned onto chequing) still counts as
    // a real expense — exactly what actually happened, deletion or not.
    expect(result.netFromBuckets).toBe(5000 - 300 - 708);
  });
});
