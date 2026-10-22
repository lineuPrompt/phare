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
  // Switchable failures, set by a test before it calls the route:
  //   readError     — every .maybeSingle() read answers this error
  //   tombstoneError — the recurring_skipped_dates insert answers this error
  //   vanishOnWrite — the transfer is gone by the time the update/delete runs
  const faults: { readError?: string; tombstoneError?: { message: string; code?: string }; vanishOnWrite?: boolean } = {};

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
        if (faults.readError) return Promise.resolve({ data: null, error: { message: faults.readError } });
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
          if (table === 'recurring_skipped_dates') {
            if (faults.tombstoneError) return Promise.resolve({ data: null, error: faults.tombstoneError });
            if (store[table].some((s) => s.recurring_item_id === row.recurring_item_id && s.date === row.date)) {
              return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } });
            }
          }
          store[table] = [...store[table], { id: `${table}-${idCounter++}`, ...row } as Row];
          return Promise.resolve({ data: null, error: null });
        },
        update(patch: Record<string, unknown>) {
          const filters: { field: string; value: unknown }[] = [];
          const inFilters: { field: string; values: unknown[] }[] = [];
          const matched: Row[] = [];
          const api = {
            eq(field: string, value: unknown) { filters.push({ field, value }); return api; },
            in(field: string, values: unknown[]) { inFilters.push({ field, values }); return api; },
            select() { return api; },
            then(resolve: (v: { data: Row[]; error: null }) => unknown) {
              const source = faults.vanishOnWrite && table === 'transactions' ? [] : rows;
              store[table] = source.map((r) => {
                const matchesEq = filters.every((f) => r[f.field] === f.value);
                const matchesIn = inFilters.every((f) => f.values.includes(r[f.field]));
                if (matchesEq && matchesIn) { matched.push(r); return { ...r, ...patch }; }
                return r;
              });
              return Promise.resolve({ data: matched, error: null }).then(resolve);
            },
          };
          return api;
        },
        delete() {
          const filters: { field: string; value: unknown }[] = [];
          const inFilters: { field: string; values: unknown[] }[] = [];
          const matched: Row[] = [];
          const api = {
            eq(field: string, value: unknown) { filters.push({ field, value }); return api; },
            in(field: string, values: unknown[]) { inFilters.push({ field, values }); return api; },
            select() { return api; },
            then(resolve: (v: { data: Row[]; error: null }) => unknown) {
              const source = faults.vanishOnWrite && table === 'transactions' ? [] : rows;
              store[table] = source.filter((r) => {
                const matchesEq = filters.every((f) => r[f.field] === f.value);
                const matchesIn = inFilters.every((f) => f.values.includes(r[f.field]));
                if (matchesEq && matchesIn) { matched.push(r); return false; }
                return true;
              });
              return Promise.resolve({ data: matched, error: null }).then(resolve);
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
    faults,
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

// ---------------------------------------------------------------------------
// The transfer edit gaps (docs/tickets/expenses-patch-route-gaps.md): the
// create limits apply to an edit, a lost tombstone is never silent, a failed
// read is not "not found", and a write that touched nothing is not success.
// ---------------------------------------------------------------------------

describe('PATCH/DELETE /api/transfers/[id] — no silent edits', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function routeFor(supabase: ReturnType<typeof makeFakeSupabase>) {
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);
    return import('../route');
  }
  const patchReq = (id: string, body: Record<string, unknown>) =>
    [new Request(`http://localhost/api/transfers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id }) }] as const;
  const deleteReq = (id: string) =>
    [new Request(`http://localhost/api/transfers/${id}`, { method: 'DELETE' }), { params: Promise.resolve({ id }) }] as const;

  it.each([
    ['an amount past the ceiling', { amount: 1_000_000_000 }, 'INVALID_AMOUNT'],
    ['a date that is not a calendar date', { amount: 300, date: '2026-02-30' }, 'INVALID_DATE'],
    ['a description past 200 characters', { amount: 300, description: 'x'.repeat(201) }, 'DESCRIPTION_TOO_LONG'],
  ])('%s is refused (400 %s) and nothing changes', async (_label, body, code) => {
    const supabase = seedSupabase();
    const { chequing_row_id } = await createRecurringOccurrence(supabase);
    const before = supabase.currentTransactions().map((r) => ({ ...r }));
    const { PATCH } = await routeFor(supabase);

    const res = await PATCH(...patchReq(chequing_row_id, body));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe(code);
    expect(supabase.currentTransactions()).toEqual(before);
    expect(supabase.currentTombstones()).toEqual([]);
  });

  it('the largest allowed amount and a cleared description still save', async () => {
    const supabase = seedSupabase();
    const { chequing_row_id } = await createRecurringOccurrence(supabase);
    const { PATCH } = await routeFor(supabase);

    const res = await PATCH(...patchReq(chequing_row_id, { amount: 999_999_999.99, description: null }));
    expect(res.status).toBe(200);
    expect(supabase.currentTransactions().every((r) => r.amount === 999_999_999.99)).toBe(true);
  });

  it('PATCH: a failed tombstone answers 500 DETACH_FAILED and both rows are unchanged', async () => {
    const supabase = seedSupabase();
    const { chequing_row_id } = await createRecurringOccurrence(supabase);
    supabase.faults.tombstoneError = { message: 'permission denied for table recurring_skipped_dates' };
    const { PATCH } = await routeFor(supabase);

    const res = await PATCH(...patchReq(chequing_row_id, { amount: 350 }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.code).toBe('DETACH_FAILED');
    expect(json.error).toContain('permission denied for table recurring_skipped_dates');
    expect(supabase.currentTransactions().every((r) => r.amount === 300 && r.recurring_item_id === 'ri-contrib')).toBe(true);
  });

  it('DELETE: a failed tombstone answers 500 DETACH_FAILED and both rows remain', async () => {
    const supabase = seedSupabase();
    const { chequing_row_id } = await createRecurringOccurrence(supabase);
    supabase.faults.tombstoneError = { message: 'connection reset' };
    const { DELETE } = await routeFor(supabase);

    const res = await DELETE(...deleteReq(chequing_row_id));
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('DETACH_FAILED');
    expect(supabase.currentTransactions()).toHaveLength(2);
  });

  it('a tombstone that already exists (a retry) is success', async () => {
    const supabase = seedSupabase();
    const { chequing_row_id } = await createRecurringOccurrence(supabase);
    const { PATCH } = await routeFor(supabase);
    await supabase.from('recurring_skipped_dates').insert({ household_id: HOUSEHOLD, recurring_item_id: 'ri-contrib', date: '2026-10-05' });

    const res = await PATCH(...patchReq(chequing_row_id, { amount: 350 }));
    expect(res.status).toBe(200);
    expect(supabase.currentTransactions().every((r) => r.amount === 350)).toBe(true);
  });

  it('a failed read is a 500 with its reason, not "Transfer not found"', async () => {
    const supabase = seedSupabase();
    const { chequing_row_id } = await createRecurringOccurrence(supabase);
    supabase.faults.readError = 'canceling statement due to statement timeout';
    const { PATCH, DELETE } = await routeFor(supabase);

    const patched = await PATCH(...patchReq(chequing_row_id, { amount: 350 }));
    expect(patched.status).toBe(500);
    expect((await patched.json()).error).toContain('canceling statement due to statement timeout');

    const deleted = await DELETE(...deleteReq(chequing_row_id));
    expect(deleted.status).toBe(500);
    expect(supabase.currentTransactions()).toHaveLength(2);
  });

  it('PATCH: a pair gone before the write is a 409, not updated: true', async () => {
    const supabase = seedSupabase();
    const { chequing_row_id } = await createRecurringOccurrence(supabase);
    supabase.faults.vanishOnWrite = true;
    const { PATCH } = await routeFor(supabase);

    const res = await PATCH(...patchReq(chequing_row_id, { amount: 350 }));
    expect(res.status).toBe(409);
    expect((await res.json()).updated).toBeUndefined();
  });

  it('DELETE: a pair gone before the write is a 409, not deleted: true', async () => {
    const supabase = seedSupabase();
    const { chequing_row_id } = await createRecurringOccurrence(supabase);
    supabase.faults.vanishOnWrite = true;
    const { DELETE } = await routeFor(supabase);

    const res = await DELETE(...deleteReq(chequing_row_id));
    expect(res.status).toBe(409);
    expect((await res.json()).deleted).toBeUndefined();
  });
});
