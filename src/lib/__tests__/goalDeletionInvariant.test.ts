import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reconcileMonth, type ReconcileTxRow, type ReconcileAccountRow } from '../reconcileHelpers';

/**
 * Goal edit/delete feature (2026-07-21) — deletion invariant.
 *
 * Deleting a goal/debt account must:
 *   1. Relabel (never delete) PAST chequing-side peer rows — real money
 *      really left chequing, the timeline must not rewrite cash history.
 *   2. Delete FUTURE transfers entirely, both sides — nothing has actually
 *      happened yet.
 *   3. Delete the recurring rule targeting this goal (cancels further
 *      materialization).
 *   4. Delete the goal account itself.
 *   5. Reconciliation for the CURRENT month must agree before and after —
 *      the relabeling changes only a text description (no amount/type/
 *      account change), and future-row deletion doesn't touch the current
 *      month's ledger at all.
 *
 * Drives the actual exported DELETE handler (/api/accounts/[id]) against an
 * in-memory fake Supabase whose `rpc('delete_goal_account', ...)` faithfully
 * reimplements the real SQL function's logic (the real one is SQL, not
 * directly testable here — same convention as transferLifecycleInvariant.test.ts).
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
    // Faithful reimplementation of 20260721000000_delete_goal_account.sql's
    // delete_goal_account(p_household_id, p_goal_id, p_today).
    rpc(name: string, params: Record<string, unknown>) {
      if (name !== 'delete_goal_account') throw new Error(`fake supabase: unexpected rpc "${name}"`);
      const householdId = params.p_household_id as string;
      const goalId = params.p_goal_id as string;
      const today = params.p_today as string;

      const goalRows = store.transactions.filter((t) => t.household_id === householdId && t.account_id === goalId);
      const pastGoalRowIds = new Set(goalRows.filter((t) => (t.date as string) <= today).map((t) => t.id));
      const futureGoalRowIds = new Set(goalRows.filter((t) => (t.date as string) > today).map((t) => t.id));

      // 1. Relabel past chequing-side peers.
      let relabeled = 0;
      store.transactions = store.transactions.map((t) => {
        if (t.household_id === householdId && pastGoalRowIds.has(t.transfer_peer_id as string)) {
          relabeled += 1;
          return { ...t, description: 'Transfer to deleted goal' };
        }
        return t;
      });

      // 2. Delete future transfers, both sides.
      const futurePeerIds = new Set(
        store.transactions.filter((t) => futureGoalRowIds.has(t.id)).map((t) => t.transfer_peer_id).filter(Boolean)
      );
      const beforeCount = store.transactions.length;
      store.transactions = store.transactions.filter(
        (t) => !(futureGoalRowIds.has(t.id) || futurePeerIds.has(t.id))
      );
      const deletedFuture = beforeCount - store.transactions.length;

      // 3. Delete remaining (past) goal-side rows — auto-nulls surviving
      // peers' transfer_peer_id (simulated: those peers no longer match any
      // existing id, matching ON DELETE SET NULL's real-world effect for
      // reconciliation purposes — reconcileMonth doesn't read transfer_peer_id).
      const deletedPast = store.transactions.filter((t) => t.account_id === goalId).length;
      store.transactions = store.transactions.filter((t) => t.account_id !== goalId);

      // 4. Cancel the recurring rule targeting this goal.
      const hadRecurring = store.recurring_items.some(
        (r) => r.household_id === householdId && r.destination_account_id === goalId && r.type === 'transfer'
      );
      store.recurring_items = store.recurring_items.filter(
        (r) => !(r.household_id === householdId && r.destination_account_id === goalId && r.type === 'transfer')
      );

      // 5. Delete the account.
      store.accounts = store.accounts.filter((a) => !(a.id === goalId && a.household_id === householdId));

      return Promise.resolve({
        data: {
          relabeledChequingRows: relabeled,
          deletedFutureRows: deletedFuture,
          deletedPastGoalRows: deletedPast,
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
const GOAL = 'acc-goal';
const TODAY = '2026-07-17';

function accountsFixture(): ReconcileAccountRow[] {
  return [
    { id: CHEQUING, type: 'chequing', name: 'Chequing' },
    { id: GOAL, type: 'savings', name: 'Disney Trip' },
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

describe('Goal deletion — honest consequences, atomicity, reconciliation invariant', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function seedScenario() {
    return makeFakeSupabase({
      users: [{ id: 'user-1', household_id: HOUSEHOLD }],
      households: [{ id: HOUSEHOLD, timezone: 'America/Toronto' }],
      accounts: [
        { id: CHEQUING, household_id: HOUSEHOLD, type: 'chequing', name: 'Chequing' },
        { id: GOAL, household_id: HOUSEHOLD, type: 'savings', name: 'Disney Trip' },
      ],
      transactions: [
        // Unrelated chequing income, this month — reconciliation baseline.
        { id: 'e1', household_id: HOUSEHOLD, account_id: CHEQUING, amount: 5000, type: 'income', date: '2026-07-01', description: 'Salary', is_bridge: false },
        // A PAST transfer pair (already happened).
        { id: 'past-goal', household_id: HOUSEHOLD, account_id: GOAL, amount: 300, type: 'transfer', date: '2026-07-05', description: 'Disney Trip', transfer_peer_id: 'past-chq', recurring_item_id: null },
        { id: 'past-chq', household_id: HOUSEHOLD, account_id: CHEQUING, amount: 300, type: 'transfer', date: '2026-07-05', description: 'Disney Trip', transfer_peer_id: 'past-goal', recurring_item_id: null },
        // A FUTURE materialized pair (recurring rule, hasn't happened yet).
        { id: 'future-goal', household_id: HOUSEHOLD, account_id: GOAL, amount: 300, type: 'transfer', date: '2026-08-05', description: 'Disney Trip', transfer_peer_id: 'future-chq', recurring_item_id: 'ri-1' },
        { id: 'future-chq', household_id: HOUSEHOLD, account_id: CHEQUING, amount: 300, type: 'transfer', date: '2026-08-05', description: 'Disney Trip', transfer_peer_id: 'future-goal', recurring_item_id: 'ri-1' },
      ],
      recurring_items: [
        { id: 'ri-1', household_id: HOUSEHOLD, destination_account_id: GOAL, type: 'transfer', active: true },
      ],
    });
  }

  it('reconciliation for the current month agrees BEFORE deletion (baseline)', () => {
    const supabase = seedScenario();
    const result = reconcileCurrentMonth(supabase);
    expect(result.reconciled).toBe(true);
  });

  it('deletes both sides of the FUTURE transfer entirely', async () => {
    const supabase = seedScenario();
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    vi.setSystemTime(new Date(TODAY + 'T12:00:00'));
    vi.useFakeTimers();
    try {
      const { DELETE } = await import('../../app/api/accounts/[id]/route');
      const res = await DELETE(
        new Request(`http://localhost/api/accounts/${GOAL}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id: GOAL }) }
      );
      expect(res.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }

    const remaining = supabase.currentTransactions();
    expect(remaining.find((t) => t.id === 'future-goal')).toBeUndefined();
    expect(remaining.find((t) => t.id === 'future-chq')).toBeUndefined();
  });

  it('preserves the PAST chequing-side row, relabeled — never deletes real chequing history', async () => {
    const supabase = seedScenario();
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    vi.setSystemTime(new Date(TODAY + 'T12:00:00'));
    vi.useFakeTimers();
    try {
      const { DELETE } = await import('../../app/api/accounts/[id]/route');
      await DELETE(
        new Request(`http://localhost/api/accounts/${GOAL}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id: GOAL }) }
      );
    } finally {
      vi.useRealTimers();
    }

    const pastChq = supabase.currentTransactions().find((t) => t.id === 'past-chq');
    expect(pastChq).toBeDefined();
    expect(pastChq!.description).toBe('Transfer to deleted goal');
    expect(pastChq!.amount).toBe(300); // amount untouched — real money, real history
    expect(pastChq!.type).toBe('transfer');
    // The past goal-side row itself is gone (the account it belonged to no longer exists).
    expect(supabase.currentTransactions().find((t) => t.id === 'past-goal')).toBeUndefined();
  });

  it('cancels the recurring rule and deletes the account', async () => {
    const supabase = seedScenario();
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    vi.setSystemTime(new Date(TODAY + 'T12:00:00'));
    vi.useFakeTimers();
    try {
      const { DELETE } = await import('../../app/api/accounts/[id]/route');
      const res = await DELETE(
        new Request(`http://localhost/api/accounts/${GOAL}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id: GOAL }) }
      );
      const body = await res.json();
      expect(body.deletedRecurringRule).toBe(true);
    } finally {
      vi.useRealTimers();
    }

    expect(supabase.currentRecurringItems()).toHaveLength(0);
    expect(supabase.currentAccounts().find((a) => a.id === GOAL)).toBeUndefined();
  });

  it('reconciliation for the current month still agrees AFTER deletion', async () => {
    const supabase = seedScenario();
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    vi.setSystemTime(new Date(TODAY + 'T12:00:00'));
    vi.useFakeTimers();
    try {
      const { DELETE } = await import('../../app/api/accounts/[id]/route');
      await DELETE(
        new Request(`http://localhost/api/accounts/${GOAL}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id: GOAL }) }
      );
    } finally {
      vi.useRealTimers();
    }

    const result = reconcileCurrentMonth(supabase);
    expect(result.reconciled).toBe(true);
    expect(result.netDifference).toBe(0);
  });
});
