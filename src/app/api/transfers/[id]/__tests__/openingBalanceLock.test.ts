/**
 * The opening-balance row is not editable as a ledger line.
 *
 * It is changed through PATCH /api/accounts/[id], which upserts the single
 * flagged row. Letting the generic transfer editor at it would (a) allow a
 * second one to appear, defeating the one-per-account index, and (b) on
 * delete, write a recurring tombstone for a date that never had a recurring
 * occurrence.
 *
 * Mutation testing found this refusal was asserted nowhere: replacing the
 * check with `const isOpeningBalance = false` left the suite green. This
 * file is that missing assertion, and it covers BOTH verbs — the earlier gap
 * was that neither was exercised.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = Record<string, unknown> & { id: string };

const HH = 'hh-1';
let store: Row[] = [];

function makeClient() {
  const match = (r: Row, filters: { field: string; value: unknown }[]) =>
    filters.every((f) => r[f.field] === f.value);

  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from(table: string) {
      if (table === 'users') {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: { household_id: HH } }) }) }),
        };
      }
      const filters: { field: string; value: unknown }[] = [];
      const api = {
        select: () => api,
        eq(field: string, value: unknown) { filters.push({ field, value }); return api; },
        in(field: string, value: unknown[]) { filters.push({ field, value: value as unknown }); return api; },
        maybeSingle: async () => {
          const found = store.filter((r) => match(r, filters));
          return { data: found[0] ? { ...found[0] } : null, error: null };
        },
        update: () => api,
        delete: () => api,
        then: undefined,
      };
      // Bare awaits (the reverse-peer lookup) resolve to all matching rows.
      return Object.assign(api, {
        [Symbol.toPrimitive]: undefined,
        catch: undefined,
      }) as never;
    },
  };
}

vi.mock('@/lib/supabase-server', () => ({ createClient: async () => makeClient() }));

const OPENING_ROW: Row = {
  id: 'ob-1',
  household_id: HH,
  account_id: 'acct-goal',
  amount: 500,
  date: '2026-07-01',
  type: 'transfer',
  transfer_peer_id: null,
  recurring_item_id: null,
  is_opening_balance: true,
};

const ORDINARY_ROW: Row = { ...OPENING_ROW, id: 'tx-1', is_opening_balance: false };

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (body: unknown) =>
  new Request('http://localhost/api/transfers/x', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('PATCH /api/transfers/[id]', () => {
  beforeEach(() => { vi.resetModules(); });

  it('REFUSES an opening-balance row', async () => {
    store = [OPENING_ROW];
    const { PATCH } = await import('../route');
    const res = await PATCH(req({ amount: 999 }), params('ob-1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/opening balance/i);
    // And it must say where to change it instead, not just refuse.
    expect(body.error).toMatch(/settings/i);
  });

  it('still accepts an ordinary transfer row', async () => {
    store = [ORDINARY_ROW];
    const { PATCH } = await import('../route');
    const res = await PATCH(req({ amount: 999 }), params('tx-1'));
    expect(res.status).not.toBe(400);
  });
});

describe('DELETE /api/transfers/[id]', () => {
  beforeEach(() => { vi.resetModules(); });

  it('REFUSES an opening-balance row', async () => {
    store = [OPENING_ROW];
    const { DELETE } = await import('../route');
    const res = await DELETE(new Request('http://localhost/x', { method: 'DELETE' }), params('ob-1'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/opening balance/i);
  });

  it('still accepts an ordinary transfer row', async () => {
    store = [ORDINARY_ROW];
    const { DELETE } = await import('../route');
    const res = await DELETE(new Request('http://localhost/x', { method: 'DELETE' }), params('tx-1'));
    expect(res.status).not.toBe(400);
  });
});
