import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reconcileMonth, type ReconcileTxRow, type ReconcileAccountRow } from '../reconcileHelpers';
import { computeGoalBalance } from '../dashboardHelpers';

/**
 * Debt draw invariant (Build 4, 2026-08-01) — create_transfer's p_kind='draw'.
 *
 * The live bug: a founder drew $2,000 from his credit line to cover
 * expenses. There was no draw concept — he had to type a plain
 * type='income' row on chequing (inflating surplus) plus an unlinked
 * negative transfer row on the debt account by hand. This file drives the
 * REAL exported route handlers (POST /api/transfers, same as
 * transferLifecycleInvariant.test.ts's Part A) against a fake Supabase
 * client whose rpc('create_transfer', …) reimplements the actual plpgsql
 * function's p_kind logic (20260801000000_create_transfer_draw_kind.sql) —
 * including the debt-only restriction and the sign-flip — since the RPC
 * itself is SQL, not something a generic fake can proxy through.
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
          const api = {
            eq(field: string, value: unknown) { filters.push({ field, value }); return api; },
            then(resolve: (v: { data: null; error: null }) => unknown) {
              store[table] = rows.filter((r) => !filters.every((f) => r[f.field] === f.value));
              return Promise.resolve({ data: null, error: null }).then(resolve);
            },
          };
          return api;
        },
      };
    },
    // Reimplements create_transfer's real behavior INCLUDING p_kind
    // (20260801000000_create_transfer_draw_kind.sql): tenant checks, the
    // debt-only restriction on draws, and the signed-amount insert — same
    // value on both sides of the pair, negative for a draw, positive for a
    // contribution/payment.
    rpc(name: string, params: Record<string, unknown>) {
      if (name !== 'create_transfer') throw new Error(`fake supabase: unexpected rpc "${name}"`);

      const fail = (message: string) => Promise.resolve({ data: null, error: { message } });

      if (!params.p_household_id) return fail('create_transfer: p_household_id is required');
      if (!params.p_member_id) return fail('create_transfer: p_member_id is required');
      if (!params.p_chequing_id || !params.p_goal_id) {
        return fail('create_transfer: p_chequing_id and p_goal_id are required');
      }
      if (params.p_chequing_id === params.p_goal_id) {
        return fail('create_transfer: p_chequing_id and p_goal_id must differ');
      }
      if (!(Number(params.p_amount) > 0)) return fail('create_transfer: p_amount must be positive');
      if (!params.p_date) return fail('create_transfer: p_date is required');
      const kind = (params.p_kind as string | undefined) ?? 'contribution';
      if (kind !== 'contribution' && kind !== 'draw') {
        return fail(`create_transfer: p_kind must be contribution or draw (got ${kind})`);
      }

      const member = store.household_members.find((m) => m.id === params.p_member_id);
      if (!member || member.household_id !== params.p_household_id) {
        return fail(`create_transfer: member ${params.p_member_id} does not belong to household ${params.p_household_id}`);
      }

      const chq = store.accounts.find((a) => a.id === params.p_chequing_id);
      if (!chq || chq.household_id !== params.p_household_id) {
        return fail(`create_transfer: chequing account ${params.p_chequing_id} does not belong to household ${params.p_household_id}`);
      }
      if (chq.type !== 'chequing') {
        return fail(`create_transfer: account ${params.p_chequing_id} is not a chequing account (type=${chq.type})`);
      }

      const goal = store.accounts.find((a) => a.id === params.p_goal_id);
      if (!goal || goal.household_id !== params.p_household_id) {
        return fail(`create_transfer: goal account ${params.p_goal_id} does not belong to household ${params.p_household_id}`);
      }
      if (!['savings', 'tfsa', 'rrsp', 'debt'].includes(goal.type as string)) {
        return fail(`create_transfer: account ${params.p_goal_id} is not a goal account (type=${goal.type})`);
      }
      if (kind === 'draw' && goal.type !== 'debt') {
        return fail(`create_transfer: draws are only valid against a debt account (account ${params.p_goal_id} is type=${goal.type})`);
      }

      const signedAmount = kind === 'draw' ? -Number(params.p_amount) : Number(params.p_amount);

      const goalRow: Row = {
        id: `tx-${idCounter++}`,
        household_id: params.p_household_id,
        member_id: params.p_member_id,
        account_id: params.p_goal_id,
        amount: signedAmount,
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
        amount: signedAmount,
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
const DEBT = 'acc-debt';
const SAVINGS = 'acc-sav';

function accountsFixture(): ReconcileAccountRow[] {
  return [
    { id: CHEQUING, type: 'chequing', name: 'Chequing' },
    { id: DEBT,     type: 'debt',     name: 'Credit Line' },
    { id: SAVINGS,  type: 'savings',  name: 'Emergency Fund' },
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
      { id: DEBT,     household_id: HOUSEHOLD, type: 'debt',     name: 'Credit Line' },
      { id: SAVINGS,  household_id: HOUSEHOLD, type: 'savings',  name: 'Emergency Fund' },
    ],
    transactions: existingTxns,
  });
}

vi.mock('@/lib/supabase-server', () => ({
  createClient: vi.fn(),
}));

describe('POST /api/transfers with kind=draw — creates a real linked pair', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('a draw creates two peer rows, negative on both sides, debt balance more negative and chequing balance more positive', async () => {
    const supabase = seedSupabase([
      { id: 'e1', household_id: HOUSEHOLD, account_id: CHEQUING, amount: 3000, type: 'income', date: '2026-07-01', description: 'Salary', is_bridge: false },
    ]);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    const { POST } = await import('../../app/api/transfers/route');
    const res = await POST(new Request('http://localhost/api/transfers', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-07-21', amount: 2000, goalAccountId: DEBT, kind: 'draw' }),
    }));
    expect(res.status).toBe(200);
    const { chequingRowId, goalRowId } = await res.json();

    const txns = supabase.currentTransactions();
    expect(txns).toHaveLength(3); // salary + 2 draw-pair sides

    const chqRow = txns.find((t) => t.id === chequingRowId)!;
    const debtRow = txns.find((t) => t.id === goalRowId)!;
    expect(Number(chqRow.amount)).toBe(-2000);
    expect(Number(debtRow.amount)).toBe(-2000);
    expect(chqRow.transfer_peer_id).toBe(debtRow.id);
    expect(debtRow.transfer_peer_id).toBe(chqRow.id);

    // Description defaults to "(draw)", matching the "(payment)" convention
    // for contributions to a debt destination.
    expect(chqRow.description).toBe('Credit Line (draw)');

    // Debt balance is more negative (owes more); real chequing cash is up.
    const today = '2026-07-31';
    const allTxRows = txns.map((t) => ({ amount: Number(t.amount), type: t.type as string, account_id: t.account_id as string, date: t.date as string }));
    expect(computeGoalBalance(allTxRows, DEBT, today)).toBe(-2000);

    const result = reconcileAll(supabase);
    const chqAudit = result.accounts.find((a) => a.accountId === CHEQUING)!;
    expect(chqAudit.monthBalance).toBe(5000); // 3000 income + 2000 draw inflow
    expect(result.totalBorrowed).toBe(2000);
    expect(result.reconciled).toBe(true);
  });

  it('kind defaults to contribution when omitted — existing callers are unaffected', async () => {
    const supabase = seedSupabase([]);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    const { POST } = await import('../../app/api/transfers/route');
    const res = await POST(new Request('http://localhost/api/transfers', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-07-05', amount: 300, goalAccountId: SAVINGS }),
    }));
    expect(res.status).toBe(200);
    const txns = supabase.currentTransactions();
    expect(txns.every((t) => Number(t.amount) === 300)).toBe(true); // positive, unchanged behaviour
  });

  it('a draw against a non-debt goal is rejected with 400, before the RPC runs', async () => {
    const supabase = seedSupabase([]);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    const { POST } = await import('../../app/api/transfers/route');
    const res = await POST(new Request('http://localhost/api/transfers', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-07-05', amount: 300, goalAccountId: SAVINGS, kind: 'draw' }),
    }));
    expect(res.status).toBe(400);
    expect(supabase.currentTransactions()).toHaveLength(0);
  });

  it('the RPC itself also rejects a draw against a non-debt goal (defense in depth)', async () => {
    const supabase = seedSupabase([]);
    const { error } = await supabase.rpc('create_transfer', {
      p_household_id: HOUSEHOLD,
      p_member_id: 'member-1',
      p_chequing_id: CHEQUING,
      p_goal_id: SAVINGS,
      p_amount: 300,
      p_date: '2026-07-05',
      p_description: 'Attempted draw on savings',
      p_kind: 'draw',
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/draws are only valid against a debt account/);
    expect(supabase.currentTransactions()).toHaveLength(0);
  });
});

describe('Full-cycle invariant: draw → payment → draw stays reconciled through POST /api/transfers at every step', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('three real POSTs (draw, payment, draw) each leave the ledger reconciled with the running debt balance correct', async () => {
    const supabase = seedSupabase([]);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);
    const { POST } = await import('../../app/api/transfers/route');

    // July — draw $2,000
    let res = await POST(new Request('http://localhost/api/transfers', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-07-21', amount: 2000, goalAccountId: DEBT, kind: 'draw' }),
    }));
    expect(res.status).toBe(200);
    expect(reconcileAll(supabase).reconciled).toBe(true);

    // August — payment $500
    res = await POST(new Request('http://localhost/api/transfers', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-08-31', amount: 500, goalAccountId: DEBT, kind: 'contribution' }),
    }));
    expect(res.status).toBe(200);
    expect(reconcileAll(supabase).reconciled).toBe(true);

    // September — draw $1,000 again
    res = await POST(new Request('http://localhost/api/transfers', {
      method: 'POST',
      body: JSON.stringify({ date: '2026-09-25', amount: 1000, goalAccountId: DEBT, kind: 'draw' }),
    }));
    expect(res.status).toBe(200);
    const finalResult = reconcileAll(supabase);
    expect(finalResult.reconciled).toBe(true);
    expect(finalResult.netDifference).toBe(0);

    // Running debt balance: -2000 (draw) + 500 (payment) - 1000 (draw) = -2500.
    const allTxRows = supabase.currentTransactions().map((t) => ({
      amount: Number(t.amount), type: t.type as string, account_id: t.account_id as string, date: t.date as string,
    }));
    expect(computeGoalBalance(allTxRows, DEBT, '2026-09-30')).toBe(-2500);
  });
});
