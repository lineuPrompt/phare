import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Part A3 invariant, transfer flavor — editing or deleting a single
 * materialized recurring TRANSFER occurrence (a recurring contribution or
 * debt payment, created via create_transfer with p_recurring_item_id set)
 * through PATCH/DELETE /api/transfers/[id] must detach BOTH pair rows from
 * the rule atomically: one tombstone recording the occurrence's original
 * date (so a later rule edit can't regenerate it), and recurring_item_id
 * cleared on both sides in the same update. A one-off transfer (no
 * recurring_item_id) must never write a tombstone.
 *
 * Same mutable-store fake convention as transferLifecycleInvariant.test.ts,
 * extended with a generic insert() (for the tombstone table) since that
 * file's fake only ever creates transaction rows via the scripted
 * create_transfer RPC.
 */

type Row = Record<string, unknown> & { id: string };

function makeFakeSupabase(seed: { users: Row[]; household_members: Row[]; accounts: Row[]; transactions: Row[] }) {
  const store: Record<string, Row[]> = {
    users: [...seed.users],
    household_members: [...seed.household_members],
    accounts: [...seed.accounts],
    transactions: [...seed.transactions],
    recurring_skipped_dates: [],
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
        insert(row: Record<string, unknown>) {
          store[table] = [...store[table], { id: `${table}-${idCounter++}`, ...row } as Row];
          return Promise.resolve({ data: null, error: null });
        },
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
    currentTransactions(): Row[] { return store.transactions; },
    currentTombstones(): Row[] { return store.recurring_skipped_dates; },
  };

  return supabase;
}

const HOUSEHOLD = 'hh-1';
const CHEQUING = 'acc-chq';
const GOAL = 'acc-goal';

function seedSupabase() {
  return makeFakeSupabase({
    users: [{ id: 'user-1', household_id: HOUSEHOLD }],
    household_members: [{ id: 'member-1', household_id: HOUSEHOLD, user_id: 'user-1' }],
    accounts: [
      { id: CHEQUING, household_id: HOUSEHOLD, type: 'chequing', name: 'Chequing' },
      { id: GOAL, household_id: HOUSEHOLD, type: 'savings', name: 'Emergency Fund' },
    ],
    transactions: [],
  });
}

async function createRecurringOccurrence(supabase: ReturnType<typeof makeFakeSupabase>) {
  const { data } = await supabase.rpc('create_transfer', {
    p_household_id: HOUSEHOLD,
    p_member_id: 'member-1',
    p_chequing_id: CHEQUING,
    p_goal_id: GOAL,
    p_amount: 300,
    p_date: '2026-10-05',
    p_description: 'Emergency fund',
    p_recurring_item_id: 'ri-contrib',
  }) as { data: { chequing_row_id: string; goal_row_id: string } };
  return data;
}

vi.mock('@/lib/supabase-server', () => ({
  createClient: vi.fn(),
}));

describe('PATCH/DELETE /api/transfers/[id] — Part A3 detach-on-edit/delete (paired)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('PATCH on a materialized transfer occurrence tombstones the original date and detaches BOTH pair rows', async () => {
    const supabase = seedSupabase();
    const { chequing_row_id: chequingRowId } = await createRecurringOccurrence(supabase);

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    const { PATCH } = await import('../route');
    const res = await PATCH(
      new Request(`http://localhost/api/transfers/${chequingRowId}`, {
        method: 'PATCH',
        body: JSON.stringify({ amount: 350 }),
      }),
      { params: Promise.resolve({ id: chequingRowId }) }
    );
    expect(res.status).toBe(200);

    expect(supabase.currentTombstones()).toHaveLength(1);
    expect(supabase.currentTombstones()[0]).toMatchObject({ recurring_item_id: 'ri-contrib', date: '2026-10-05' });

    const pair = supabase.currentTransactions();
    expect(pair).toHaveLength(2);
    for (const row of pair) {
      expect(row.amount).toBe(350);
      expect(row.recurring_item_id).toBeNull();
    }
  });

  it('DELETE on a materialized transfer occurrence tombstones the date before removing both pair rows', async () => {
    const supabase = seedSupabase();
    const { goal_row_id: goalRowId } = await createRecurringOccurrence(supabase);

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    const { DELETE } = await import('../route');
    const res = await DELETE(
      new Request(`http://localhost/api/transfers/${goalRowId}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: goalRowId }) }
    );
    expect(res.status).toBe(200);

    expect(supabase.currentTombstones()).toHaveLength(1);
    expect(supabase.currentTombstones()[0]).toMatchObject({ recurring_item_id: 'ri-contrib', date: '2026-10-05' });
    expect(supabase.currentTransactions()).toHaveLength(0);
  });

  it('a one-off transfer (no recurring_item_id) never writes a tombstone on edit or delete', async () => {
    const supabase = seedSupabase();
    const { data } = await supabase.rpc('create_transfer', {
      p_household_id: HOUSEHOLD,
      p_member_id: 'member-1',
      p_chequing_id: CHEQUING,
      p_goal_id: GOAL,
      p_amount: 100,
      p_date: '2026-10-05',
      p_description: 'One-off',
    }) as { data: { chequing_row_id: string } };

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    const { PATCH } = await import('../route');
    await PATCH(
      new Request(`http://localhost/api/transfers/${data.chequing_row_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ amount: 150 }),
      }),
      { params: Promise.resolve({ id: data.chequing_row_id }) }
    );

    expect(supabase.currentTombstones()).toHaveLength(0);
    expect(supabase.currentTransactions().every((r) => r.amount === 150)).toBe(true);
  });
});
