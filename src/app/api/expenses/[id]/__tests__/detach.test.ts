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

function makeFakeSupabase(
  seed: { users: Row[]; transactions: Row[]; categories?: Row[]; recurring_skipped_dates?: Row[] },
  opts: { tombstoneError?: { message: string; code?: string } } = {}
) {
  const store: Record<string, Row[]> = {
    users: [...seed.users],
    transactions: [...seed.transactions],
    categories: [...(seed.categories ?? [])],
    recurring_skipped_dates: [...(seed.recurring_skipped_dates ?? [])],
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
      maybeSingle() {
        return Promise.resolve({ data: result[0] ? { ...result[0] } : null, error: null });
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
          if (table === 'recurring_skipped_dates') {
            if (opts.tombstoneError) return Promise.resolve({ data: null, error: opts.tombstoneError });
            // UNIQUE (recurring_item_id, date), as live.
            if (store[table].some((t) => t.recurring_item_id === row.recurring_item_id && t.date === row.date)) {
              return Promise.resolve({
                data: null,
                error: { code: '23505', message: 'duplicate key value violates unique constraint "recurring_skipped_dates_recurring_item_id_date_key"' },
              });
            }
          }
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

// ---------------------------------------------------------------------------
// The edit gaps (docs/tickets/expenses-patch-route-gaps.md): an edit obeys
// the same rules as a create, an expense never keeps a member, and a lost
// tombstone is never silent.
// ---------------------------------------------------------------------------

const CAT_OWN = '11111111-1111-4111-8111-111111111111';
const CAT_FOREIGN = '22222222-2222-4222-8222-222222222222';

function editable(overrides: Partial<Row> = {}): Row {
  return {
    id: 'tx-1', household_id: HOUSEHOLD, account_id: 'chq-1', amount: 60, type: 'expense', member_id: null,
    date: '2026-08-05', description: 'Phone', is_bridge: false, recurring_item_id: null, category_id: CAT_OWN,
    ...overrides,
  };
}

async function patchWith(
  supabase: ReturnType<typeof makeFakeSupabase>,
  body: Record<string, unknown>
) {
  const { createClient } = await import('@/lib/supabase-server');
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);
  const { PATCH } = await import('../route');
  const res = await PATCH(
    new Request('http://localhost/api/expenses/tx-1', { method: 'PATCH', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: 'tx-1' }) }
  );
  return { res, json: await res.json() };
}

function fake(tx: Row, opts: Parameters<typeof makeFakeSupabase>[1] = {}, extra: { recurring_skipped_dates?: Row[] } = {}) {
  return makeFakeSupabase({
    users: [{ id: 'user-1', household_id: HOUSEHOLD }],
    transactions: [tx],
    categories: [
      { id: CAT_OWN, household_id: HOUSEHOLD },
      { id: CAT_FOREIGN, household_id: 'hh-other' },
    ],
    ...extra,
  }, opts);
}

describe('PATCH /api/expenses/[id] — an edit obeys the create rules', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('an income edited into an expense loses its member (expenses never carry one)', async () => {
    const supabase = fake(editable({ type: 'income', member_id: 'mem-1', category_id: null }));
    const { res } = await patchWith(supabase, { type: 'expense', categoryId: CAT_OWN });
    expect(res.status).toBe(200);
    const tx = supabase.currentTransactions()[0];
    expect(tx.type).toBe('expense');
    expect(tx.member_id).toBeNull();
  });

  it('an income edited but staying income keeps its member', async () => {
    const supabase = fake(editable({ type: 'income', member_id: 'mem-1', category_id: null }));
    await patchWith(supabase, { amount: 75 });
    expect(supabase.currentTransactions()[0].member_id).toBe('mem-1');
  });

  it('an income saved with type "income" sent again (as an edit form may) keeps its member', async () => {
    const supabase = fake(editable({ type: 'income', member_id: 'mem-1', category_id: null }));
    const { res } = await patchWith(supabase, { type: 'income', amount: 75 });
    expect(res.status).toBe(200);
    expect(supabase.currentTransactions()[0].member_id).toBe('mem-1');
  });

  it.each([
    ['a date that is not a calendar date', { date: '2026-02-31' }, 'INVALID_DATE'],
    ['a date in another format', { date: '05/08/2026' }, 'INVALID_DATE'],
    ['a description past 200 characters', { description: 'x'.repeat(201) }, 'DESCRIPTION_TOO_LONG'],
    ['an empty description', { description: '   ' }, 'DESCRIPTION_REQUIRED'],
    ['an amount past the ceiling', { amount: 1_000_000_000 }, 'INVALID_AMOUNT'],
    ['an amount with three decimals', { amount: 12.345 }, 'INVALID_AMOUNT'],
    ['an amount sent as text', { amount: '60' }, 'INVALID_AMOUNT'],
    ['a malformed category id', { categoryId: 'cat-groceries' }, 'CATEGORY_NOT_FOUND'],
  ])('%s is refused (400 %s) and nothing changes', async (_label, body, code) => {
    const supabase = fake(editable());
    const before = { ...supabase.currentTransactions()[0] };
    const { res, json } = await patchWith(supabase, body);
    expect(res.status).toBe(400);
    expect(json.code).toBe(code);
    expect(supabase.currentTransactions()[0]).toEqual(before);
  });

  it('another household\'s category is refused (400 CATEGORY_NOT_FOUND) and nothing changes', async () => {
    const supabase = fake(editable());
    const { res, json } = await patchWith(supabase, { categoryId: CAT_FOREIGN });
    expect(res.status).toBe(400);
    expect(json.code).toBe('CATEGORY_NOT_FOUND');
    expect(supabase.currentTransactions()[0].category_id).toBe(CAT_OWN);
  });

  it('the largest allowed amount and a 200-character description still save', async () => {
    const supabase = fake(editable());
    const { res } = await patchWith(supabase, { amount: 999_999_999.99, description: 'x'.repeat(200) });
    expect(res.status).toBe(200);
    expect(supabase.currentTransactions()[0].amount).toBe(999_999_999.99);
  });
});

describe('PATCH/DELETE /api/expenses/[id] — a lost tombstone is never silent', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  const occurrence = () => editable({ recurring_item_id: 'ri-phone' });

  it('PATCH: a failed tombstone answers 500 DETACH_FAILED with the reason, and the entry is unchanged', async () => {
    const supabase = fake(occurrence(), { tombstoneError: { message: 'permission denied for table recurring_skipped_dates' } });
    const { res, json } = await patchWith(supabase, { amount: 70 });
    expect(res.status).toBe(500);
    expect(json.code).toBe('DETACH_FAILED');
    expect(json.error).toContain('permission denied for table recurring_skipped_dates');
    const tx = supabase.currentTransactions()[0];
    expect(tx.amount).toBe(60);
    expect(tx.recurring_item_id).toBe('ri-phone');
  });

  it('DELETE: a failed tombstone answers 500 DETACH_FAILED, and the entry is still there', async () => {
    const supabase = fake(occurrence(), { tombstoneError: { message: 'connection reset' } });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);
    const { DELETE } = await import('../route');
    const res = await DELETE(new Request('http://localhost/api/expenses/tx-1', { method: 'DELETE' }), { params: Promise.resolve({ id: 'tx-1' }) });
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('DETACH_FAILED');
    expect(supabase.currentTransactions()).toHaveLength(1);
  });

  it('a tombstone that already exists (a retry) is success, not a failure', async () => {
    const supabase = fake(occurrence(), {}, {
      recurring_skipped_dates: [{ id: 'ts-1', household_id: HOUSEHOLD, recurring_item_id: 'ri-phone', date: '2026-08-05' }],
    });
    const { res } = await patchWith(supabase, { amount: 70 });
    expect(res.status).toBe(200);
    expect(supabase.currentTransactions()[0].amount).toBe(70);
    expect(supabase.currentTombstones()).toHaveLength(1);
  });
});
