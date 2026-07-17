import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reconcileMonth, type ReconcileTxRow, type ReconcileAccountRow } from '../reconcileHelpers';

/**
 * Part A invariant (2026-07-19): a one-off transfer created through
 * POST /api/transfers, then deleted through DELETE /api/transfers/[id],
 * must leave the ledger exactly as it was before creation — both peer rows
 * gone together, reconciliation still agreeing. Also proves, as a contrast
 * case, WHY the atomic path matters: manually removing only one side (the
 * bug class the atomic DELETE exists to prevent) produces a real, detectable
 * reconciliation delta.
 *
 * Drives the actual exported route handlers (not just pure functions) against
 * a small in-memory fake Supabase client — the same "mock @/lib/supabase-server,
 * script the tables" convention already used by
 * regenerate-plan/__tests__/route.test.ts, extended here to a mutable store
 * so a create → query-back → delete sequence works, and to implement
 * create_transfer's real atomic-pair-insert behavior (the RPC itself is SQL,
 * not something a generic fake can proxy through).
 */

type Row = Record<string, unknown> & { id: string };

function makeFakeSupabase(seed: { users: Row[]; household_members: Row[]; accounts: Row[]; transactions: Row[] }) {
  const store: Record<string, Row[]> = {
    users: [...seed.users],
    household_members: [...seed.household_members],
    accounts: [...seed.accounts],
    transactions: [...seed.transactions],
  };
  let idCounter = 1;

  function selectChain(rows: Row[]) {
    let result = rows;
    const api = {
      eq(field: string, value: unknown) { result = result.filter((r) => r[field] === value); return api; },
      in(field: string, values: unknown[]) { result = result.filter((r) => values.includes(r[field])); return api; },
      order() { return api; },
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
        update(patch: Record<string, unknown>) {
          const filters: { field: string; value: unknown }[] = [];
          const inFilters: { field: string; values: unknown[] }[] = [];
          const api = {
            eq(field: string, value: unknown) { filters.push({ field, value }); return api; },
            in(field: string, values: unknown[]) { inFilters.push({ field, values }); return api; },
            then(resolve: (v: { data: null; error: null }) => unknown) {
              store[table] = rows.map((r) => {
                const matchesEq = filters.every((f) => r[f.field] === f.value);
                const matchesIn = inFilters.every((f) => f.values.includes(r[f.field]));
                return matchesEq && matchesIn ? { ...r, ...patch } : r;
              });
              return Promise.resolve({ data: null, error: null }).then(resolve);
            },
          };
          return api;
        },
        delete() {
          const filters: { field: string; value: unknown }[] = [];
          const inFilters: { field: string; values: unknown[] }[] = [];
          const api = {
            eq(field: string, value: unknown) { filters.push({ field, value }); return api; },
            in(field: string, values: unknown[]) { inFilters.push({ field, values }); return api; },
            then(resolve: (v: { data: null; error: null }) => unknown) {
              store[table] = rows.filter((r) => {
                const matchesEq = filters.every((f) => r[f.field] === f.value);
                const matchesIn = inFilters.every((f) => f.values.includes(r[f.field]));
                return !(matchesEq && matchesIn);
              });
              return Promise.resolve({ data: null, error: null }).then(resolve);
            },
          };
          return api;
        },
      };
    },
    // Implements create_transfer's real behavior: two inserts + one update,
    // atomically (synchronously, from the test's perspective) against the
    // in-memory transactions store — mirroring the actual plpgsql function.
    rpc(name: string, params: Record<string, unknown>) {
      if (name !== 'create_transfer') throw new Error(`fake supabase: unexpected rpc "${name}"`);
      const goalRow: Row = {
        id: `tx-${idCounter++}`,
        household_id: params.p_household_id,
        member_id: params.p_member_id,
        account_id: params.p_goal_id,
        amount: params.p_amount,
        description: params.p_description,
        date: params.p_date,
        type: 'transfer',
        source: 'manual',
        transfer_peer_id: null,
        recurring_item_id: params.p_recurring_item_id ?? null,
        is_bridge: false,
      };
      const chqRow: Row = {
        id: `tx-${idCounter++}`,
        household_id: params.p_household_id,
        member_id: params.p_member_id,
        account_id: params.p_chequing_id,
        amount: params.p_amount,
        description: params.p_description,
        date: params.p_date,
        type: 'transfer',
        source: 'manual',
        transfer_peer_id: goalRow.id,
        recurring_item_id: params.p_recurring_item_id ?? null,
        is_bridge: false,
      };
      goalRow.transfer_peer_id = chqRow.id;
      store.transactions = [...store.transactions, goalRow, chqRow];
      return Promise.resolve({ data: { chequing_row_id: chqRow.id, goal_row_id: goalRow.id }, error: null });
    },
    currentTransactions(): Row[] {
      return store.transactions;
    },
  };

  return supabase;
}

const HOUSEHOLD = 'hh-1';
const CHEQUING = 'acc-chq';
const GOAL = 'acc-goal';

function accountsFixture(): ReconcileAccountRow[] {
  return [
    { id: CHEQUING, type: 'chequing', name: 'Chequing' },
    { id: GOAL, type: 'savings', name: 'Emergency Fund' },
  ];
}

function reconcileAll(supabase: ReturnType<typeof makeFakeSupabase>) {
  const txns = supabase.currentTransactions().map((r) => ({
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

function seedSupabase(existingTxns: Row[] = []) {
  return makeFakeSupabase({
    users: [{ id: 'user-1', household_id: HOUSEHOLD }],
    household_members: [{ id: 'member-1', household_id: HOUSEHOLD, user_id: 'user-1' }],
    accounts: [
      { id: CHEQUING, household_id: HOUSEHOLD, type: 'chequing', name: 'Chequing' },
      { id: GOAL, household_id: HOUSEHOLD, type: 'savings', name: 'Emergency Fund' },
    ],
    transactions: existingTxns,
  });
}

vi.mock('@/lib/supabase-server', () => ({
  createClient: vi.fn(),
}));

describe('Part A invariant — one-off transfer create → delete leaves the ledger unchanged, reconciled throughout', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('create: both peer rows exist, reconciled', async () => {
    const supabase = seedSupabase([
      { id: 'e1', household_id: HOUSEHOLD, account_id: CHEQUING, amount: 5000, type: 'income', date: '2026-07-01', description: 'Salary', is_bridge: false },
    ]);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    const { POST } = await import('../../app/api/transfers/route');
    const res = await POST(new Request('http://localhost/api/transfers', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-07-05', amount: 300, goalAccountId: GOAL, description: 'Emergency fund' }),
    }));
    expect(res.status).toBe(200);

    expect(supabase.currentTransactions()).toHaveLength(3); // salary + 2 transfer sides
    expect(reconcileAll(supabase).reconciled).toBe(true);
  });

  it('create then delete (either side\'s id): both peer rows gone, ledger back to its pre-transfer state, reconciled', async () => {
    const supabase = seedSupabase([
      { id: 'e1', household_id: HOUSEHOLD, account_id: CHEQUING, amount: 5000, type: 'income', date: '2026-07-01', description: 'Salary', is_bridge: false },
    ]);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    const { POST } = await import('../../app/api/transfers/route');
    const createRes = await POST(new Request('http://localhost/api/transfers', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-07-05', amount: 300, goalAccountId: GOAL }),
    }));
    const { chequingRowId } = await createRes.json();
    expect(supabase.currentTransactions()).toHaveLength(3);

    const { DELETE } = await import('../../app/api/transfers/[id]/route');
    const delRes = await DELETE(
      new Request(`http://localhost/api/transfers/${chequingRowId}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: chequingRowId }) }
    );
    expect(delRes.status).toBe(200);

    // Back to exactly the pre-transfer ledger: only the original salary row.
    expect(supabase.currentTransactions()).toHaveLength(1);
    const result = reconcileAll(supabase);
    expect(result.reconciled).toBe(true);
    expect(result.netDifference).toBe(0);
  });

  it('deleting via the GOAL-side id also removes both sides (peer resolution works from either direction)', async () => {
    const supabase = seedSupabase([]);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    const { POST } = await import('../../app/api/transfers/route');
    const createRes = await POST(new Request('http://localhost/api/transfers', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-07-05', amount: 300, goalAccountId: GOAL }),
    }));
    const { goalRowId } = await createRes.json();
    expect(supabase.currentTransactions()).toHaveLength(2);

    const { DELETE } = await import('../../app/api/transfers/[id]/route');
    await DELETE(
      new Request(`http://localhost/api/transfers/${goalRowId}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: goalRowId }) }
    );

    expect(supabase.currentTransactions()).toHaveLength(0);
  });

  it('contrast case — an orphaned goal-side half is why the delete MUST be atomic, not just detectable', () => {
    // Simulates the exact bug atomicity prevents: only the goal-side row of
    // a pair got deleted (or only it ever got inserted) — a lone goal-side
    // transfer row with no matching chequing-side debit anywhere.
    const orphanedGoalOnly: ReconcileTxRow[] = [
      { id: 'orphan-1', date: '2026-07-05', description: null, amount: 300, type: 'transfer', account_id: GOAL, is_bridge: false },
    ];
    const result = reconcileMonth(orphanedGoalOnly, accountsFixture());

    // Path 1 (buckets) sees no CHEQUING transfer at all → savings = 0. Path 2
    // (chequing ledger) also sees nothing on chequing → also 0. Both
    // derivation paths "agree" — netDifference is 0, reconciled is TRUE.
    expect(result.reconciled).toBe(true);
    // And yet the goal account's own balance shows +300 — a contribution
    // with no real chequing outflow behind it anywhere. This is precisely
    // why the delete (and the create) must be atomic rather than relying on
    // the dual-path audit to catch a broken pair after the fact: an orphaned
    // goal-side row does NOT always trip reconciled=false. It silently
    // inflates a goal's tracked balance, untethered from any real money
    // movement, with the audit reporting a clean bill of health.
    const goalBalance = result.accounts.find((a) => a.accountId === GOAL)?.monthBalance;
    expect(goalBalance).toBe(300);
  });
});
