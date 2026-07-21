import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Part A3 invariant — editing or deleting a single materialized recurring
 * occurrence through PATCH/DELETE /api/expenses/[id] must detach it from its
 * rule: tombstone the occurrence's ORIGINAL date in recurring_skipped_dates
 * (so a later edit to the RULE can't regenerate it — see
 * recurring/[id]/__tests__/route.test.ts for that half of the invariant) and,
 * for PATCH, clear recurring_item_id on the row itself so it becomes a plain
 * standalone entry going forward. A plain manual entry (recurring_item_id
 * already null) must never write a tombstone at all.
 *
 * Drives the real exported PATCH/DELETE handlers against a small in-memory
 * fake Supabase client — same mutable-store convention as
 * transferLifecycleInvariant.test.ts.
 */

type Row = Record<string, unknown> & { id: string };

function makeFakeSupabase(seed: { users: Row[]; transactions: Row[] }) {
  const store: Record<string, Row[]> = {
    users: [...seed.users],
    transactions: [...seed.transactions],
    recurring_skipped_dates: [],
  };
  let idCounter = 1;

  function selectChain(rows: Row[]) {
    let result = rows;
    const api = {
      eq(field: string, value: unknown) {
        result = result.filter((r) => r[field] === value);
        return api;
      },
      single() {
        return Promise.resolve(
          result[0] ? { data: { ...result[0] }, error: null } : { data: null, error: { message: 'not found' } }
        );
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
        select() {
          return selectChain(rows);
        },
        insert(row: Record<string, unknown>) {
          store[table] = [...store[table], { id: `${table}-${idCounter++}`, ...row } as Row];
          return Promise.resolve({ data: null, error: null });
        },
        update(patch: Record<string, unknown>) {
          const filters: { field: string; value: unknown }[] = [];
          const api = {
            eq(field: string, value: unknown) {
              filters.push({ field, value });
              return api;
            },
            select() {
              const matched: Row[] = [];
              store[table] = rows.map((r) => {
                if (filters.every((f) => r[f.field] === f.value)) {
                  const updated = { ...r, ...patch };
                  matched.push(updated);
                  return updated;
                }
                return r;
              });
              return Promise.resolve({ data: matched, error: null });
            },
          };
          return api;
        },
        delete() {
          const filters: { field: string; value: unknown }[] = [];
          const api = {
            eq(field: string, value: unknown) {
              filters.push({ field, value });
              return api;
            },
            select() {
              const matched: Row[] = [];
              store[table] = rows.filter((r) => {
                if (filters.every((f) => r[f.field] === f.value)) {
                  matched.push(r);
                  return false;
                }
                return true;
              });
              return Promise.resolve({ data: matched, error: null });
            },
          };
          return api;
        },
      };
    },
    currentTransactions(): Row[] {
      return store.transactions;
    },
    currentTombstones(): Row[] {
      return store.recurring_skipped_dates;
    },
  };

  return supabase;
}

const HOUSEHOLD = 'hh-1';

function seedSupabase(transactions: Row[]) {
  return makeFakeSupabase({
    users: [{ id: 'user-1', household_id: HOUSEHOLD }],
    transactions,
  });
}

vi.mock('@/lib/supabase-server', () => ({
  createClient: vi.fn(),
}));

describe('PATCH/DELETE /api/expenses/[id] — Part A3 detach-on-edit/delete', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('PATCH on a materialized occurrence tombstones its original date and clears recurring_item_id', async () => {
    const supabase = seedSupabase([
      {
        id: 'tx-1', household_id: HOUSEHOLD, account_id: 'chq-1', amount: 60, type: 'expense',
        date: '2026-08-05', description: 'Phone bill', is_bridge: false, recurring_item_id: 'ri-phone',
      },
    ]);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    const { PATCH } = await import('../route');
    const res = await PATCH(
      new Request('http://localhost/api/expenses/tx-1', { method: 'PATCH', body: JSON.stringify({ amount: 70 }) }),
      { params: Promise.resolve({ id: 'tx-1' }) }
    );
    expect(res.status).toBe(200);

    const tombstones = supabase.currentTombstones();
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0]).toMatchObject({ household_id: HOUSEHOLD, recurring_item_id: 'ri-phone', date: '2026-08-05' });

    const tx = supabase.currentTransactions().find((r) => r.id === 'tx-1')!;
    expect(tx.amount).toBe(70);
    expect(tx.recurring_item_id).toBeNull();
    // The edit itself moves the row, but the tombstone stays pinned to the
    // ORIGINAL scheduled date — the slot the rule's own cadence would still
    // try to fill, not wherever the user relocated this edited copy to.
    expect(tx.date).toBe('2026-08-05');
  });

  it('editing this month\'s $60 phone bill to $70 leaves the rule\'s own row shape untouched — only the occurrence detaches', async () => {
    const supabase = seedSupabase([
      {
        id: 'tx-1', household_id: HOUSEHOLD, account_id: 'chq-1', amount: 60, type: 'expense',
        date: '2026-08-05', description: 'Phone bill', is_bridge: false, recurring_item_id: 'ri-phone',
      },
    ]);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    const { PATCH } = await import('../route');
    await PATCH(
      new Request('http://localhost/api/expenses/tx-1', {
        method: 'PATCH',
        body: JSON.stringify({ amount: 70, date: '2026-08-06' }),
      }),
      { params: Promise.resolve({ id: 'tx-1' }) }
    );

    // Tombstone pinned to the 5th (original schedule), even though the
    // edited row itself is now dated the 6th.
    expect(supabase.currentTombstones()[0]).toMatchObject({ recurring_item_id: 'ri-phone', date: '2026-08-05' });
    const tx = supabase.currentTransactions().find((r) => r.id === 'tx-1')!;
    expect(tx.date).toBe('2026-08-06');
    expect(tx.amount).toBe(70);
  });

  it('DELETE on a materialized occurrence tombstones its date before removing the row', async () => {
    const supabase = seedSupabase([
      {
        id: 'tx-1', household_id: HOUSEHOLD, account_id: 'chq-1', amount: 60, type: 'expense',
        date: '2026-08-05', description: 'Phone bill', is_bridge: false, recurring_item_id: 'ri-phone',
      },
    ]);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    const { DELETE } = await import('../route');
    const res = await DELETE(
      new Request('http://localhost/api/expenses/tx-1', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'tx-1' }) }
    );
    expect(res.status).toBe(200);

    expect(supabase.currentTombstones()).toHaveLength(1);
    expect(supabase.currentTombstones()[0]).toMatchObject({ recurring_item_id: 'ri-phone', date: '2026-08-05' });
    expect(supabase.currentTransactions()).toHaveLength(0);
  });

  it('a plain manual entry (no recurring_item_id) never writes a tombstone on edit or delete', async () => {
    const supabase = seedSupabase([
      {
        id: 'tx-1', household_id: HOUSEHOLD, account_id: 'chq-1', amount: 25, type: 'expense',
        date: '2026-08-05', description: 'Groceries', is_bridge: false, recurring_item_id: null,
      },
      {
        id: 'tx-2', household_id: HOUSEHOLD, account_id: 'chq-1', amount: 40, type: 'expense',
        date: '2026-08-06', description: 'Gas', is_bridge: false, recurring_item_id: null,
      },
    ]);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    const { PATCH, DELETE } = await import('../route');
    await PATCH(
      new Request('http://localhost/api/expenses/tx-1', { method: 'PATCH', body: JSON.stringify({ amount: 30 }) }),
      { params: Promise.resolve({ id: 'tx-1' }) }
    );
    await DELETE(
      new Request('http://localhost/api/expenses/tx-2', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'tx-2' }) }
    );

    expect(supabase.currentTombstones()).toHaveLength(0);
    expect(supabase.currentTransactions()).toHaveLength(1);
    expect(supabase.currentTransactions()[0].amount).toBe(30);
  });

  it('switching an entry from expense to income clears its category unless a new one is sent explicitly', async () => {
    const supabase = seedSupabase([
      {
        id: 'tx-1', household_id: HOUSEHOLD, account_id: 'chq-1', amount: 60, type: 'expense',
        date: '2026-08-05', description: 'Refund', is_bridge: false, recurring_item_id: null, category_id: 'cat-groceries',
      },
    ]);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    const { PATCH } = await import('../route');
    await PATCH(
      new Request('http://localhost/api/expenses/tx-1', { method: 'PATCH', body: JSON.stringify({ type: 'income' }) }),
      { params: Promise.resolve({ id: 'tx-1' }) }
    );

    const tx = supabase.currentTransactions().find((r) => r.id === 'tx-1')!;
    expect(tx.type).toBe('income');
    expect(tx.category_id).toBeNull();
  });
});
