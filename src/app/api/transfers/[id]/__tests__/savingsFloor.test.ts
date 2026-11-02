import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * THE SAVINGS FLOOR ON EDIT AND DELETE (2026-11-02). POST refuses a withdrawal
 * above the balance; editing or deleting must not go around it. After the
 * change, a savings-type account never reaches below zero — or below the
 * lowest it already reaches. A debt account has no floor.
 *
 * Runs the real PATCH/DELETE against an in-memory store, so "nothing changed"
 * is read back from the rows themselves.
 */

type Row = Record<string, unknown> & { id: string };

function makeStore(seed: Record<string, Row[]>) {
  const store: Record<string, Row[]> = { ...seed };
  type Filter = (r: Row) => boolean;
  function rows(table: string) { return (store[table] ??= []); }

  function query(table: string, mode: 'select' | 'update' | 'delete', patch?: Record<string, unknown>) {
    const filters: Filter[] = [];
    const run = () => {
      const hit = rows(table).filter((r) => filters.every((f) => f(r)));
      if (mode === 'update') hit.forEach((r) => Object.assign(r, patch));
      if (mode === 'delete') store[table] = rows(table).filter((r) => !hit.includes(r));
      return hit.map((r) => ({ ...r }));
    };
    const api = {
      eq(f: string, v: unknown) { filters.push((r) => r[f] === v); return api; },
      in(f: string, vs: unknown[]) { filters.push((r) => vs.includes(r[f])); return api; },
      select() { return api; },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => { const d = run()[0]; return d ? { data: d, error: null } : { data: null, error: { message: 'none' } }; },
      then(resolve: (v: { data: Row[]; error: null }) => unknown) { return Promise.resolve({ data: run(), error: null }).then(resolve); },
    };
    return api;
  }

  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: (table: string) => ({
      select: () => query(table, 'select'),
      update: (patch: Record<string, unknown>) => query(table, 'update', patch),
      delete: () => query(table, 'delete'),
      insert: async () => ({ data: null, error: null }),
    }),
  };
  return { client, store };
}

vi.mock('@/lib/supabase-server', () => ({ createClient: vi.fn() }));

const HH = 'hh-1';
const tx = (id: string, account_id: string, amount: number, date: string, peer: string): Row => ({
  id, household_id: HH, account_id, amount, date, type: 'transfer', transfer_peer_id: peer,
  recurring_item_id: null, is_opening_balance: false,
});

/** Savings: +500 on Oct 1, −300 withdrawal on Oct 10. Lowest balance: 0 before Oct 1. */
function seed(goalType = 'savings'): Record<string, Row[]> {
  return {
    users: [{ id: 'user-1', household_id: HH }],
    accounts: [
      { id: 'chq', household_id: HH, name: 'Chequing', type: 'chequing' },
      { id: 'sav', household_id: HH, name: 'Trip', type: goalType },
    ],
    transactions: [
      tx('in-sav', 'sav', 500, '2026-10-01', 'in-chq'), tx('in-chq', 'chq', 500, '2026-10-01', 'in-sav'),
      tx('out-sav', 'sav', -300, '2026-10-10', 'out-chq'), tx('out-chq', 'chq', -300, '2026-10-10', 'out-sav'),
    ],
  };
}

async function route(client: unknown) {
  const { createClient } = await import('@/lib/supabase-server');
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return import('../route');
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patchReq = (id: string, body: unknown) =>
  new Request(`http://localhost/api/transfers/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
const delReq = (id: string) => new Request(`http://localhost/api/transfers/${id}`, { method: 'DELETE' });

describe('transfers edit/delete — the savings floor', () => {
  beforeEach(() => { vi.resetModules(); });

  it('deleting the contribution under a withdrawal is refused, and nothing is deleted', async () => {
    const { client, store } = makeStore(seed());
    const { DELETE } = await route(client);
    const res = await DELETE(delReq('in-chq'), ctx('in-chq'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toMatchObject({ code: 'BALANCE_WOULD_GO_NEGATIVE', account: 'Trip', date: '2026-10-10', balance: -300 });
    expect(store.transactions).toHaveLength(4);
  });

  it('a withdrawal edited larger than the balance is refused, and the amount is unchanged', async () => {
    const { client, store } = makeStore(seed());
    const { PATCH } = await route(client);
    const res = await PATCH(patchReq('out-sav', { amount: 600 }), ctx('out-sav'));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('BALANCE_WOULD_GO_NEGATIVE');
    expect(store.transactions.find((r) => r.id === 'out-sav')?.amount).toBe(-300);
  });

  it('a contribution moved after the withdrawal it covered is refused', async () => {
    const { client } = makeStore(seed());
    const { PATCH } = await route(client);
    const res = await PATCH(patchReq('in-sav', { amount: 500, date: '2026-10-20' }), ctx('in-sav'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'BALANCE_WOULD_GO_NEGATIVE', date: '2026-10-10' });
  });

  it('an edit that keeps the account at or above zero goes through', async () => {
    const { client, store } = makeStore(seed());
    const { PATCH } = await route(client);
    const res = await PATCH(patchReq('out-sav', { amount: 500 }), ctx('out-sav'));
    expect(res.status).toBe(200);
    expect(store.transactions.find((r) => r.id === 'out-sav')?.amount).toBe(-500);
  });

  it('deleting the withdrawal itself is always allowed', async () => {
    const { client, store } = makeStore(seed());
    const { DELETE } = await route(client);
    const res = await DELETE(delReq('out-sav'), ctx('out-sav'));
    expect(res.status).toBe(200);
    expect(store.transactions.map((r) => r.id).sort()).toEqual(['in-chq', 'in-sav']);
  });

  it('a debt account has no floor: deleting a payment under a draw goes through', async () => {
    const { client } = makeStore(seed('debt'));
    const { DELETE } = await route(client);
    const res = await DELETE(delReq('in-chq'), ctx('in-chq'));
    expect(res.status).toBe(200);
  });

  it('an account that already dips is not locked: a change that does not go lower passes', async () => {
    // A Reserve paid a $100 bill before it was funded: lowest is already −100.
    const data = seed();
    data.transactions.push({ id: 'bill', household_id: HH, account_id: 'sav', amount: 100, date: '2026-09-15', type: 'expense', transfer_peer_id: null, recurring_item_id: null, is_opening_balance: false });
    const { client } = makeStore(data);
    const { PATCH } = await route(client);
    // Withdrawal 300 → 350: Oct 10 balance 500 − 100 − 350 = 50, still above −100.
    const ok = await PATCH(patchReq('out-sav', { amount: 350 }), ctx('out-sav'));
    expect(ok.status).toBe(200);
    // ...but going below the existing −100 is refused.
    const worse = await PATCH(patchReq('out-sav', { amount: 600 }), ctx('out-sav'));
    expect(worse.status).toBe(400);
  });
});
