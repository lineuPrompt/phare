import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tier 3 (2026-07-22, Codex adversarial review) — PATCH/DELETE
 * /api/expenses/[id] read the target row once (loadEditableTransaction) and
 * then unconditionally reported success on the subsequent update/delete.
 * transactions.update/.delete matching ZERO rows is not a Postgres error —
 * so a lost race (the row is deleted by another tab, or by a concurrent
 * bridge recompute, between the read and the write) used to still return
 * {saved:true}/{deleted:true} for a write that touched nothing.
 *
 * This drives the real exported PATCH/DELETE handlers against a fake
 * Supabase client where the initial read finds the row (so the handler
 * proceeds past loadEditableTransaction) but the write itself is scripted to
 * match zero rows — simulating exactly that race window — and asserts the
 * route now reports 409, not a false 200.
 */

function makeFakeSupabase(opts: { writeMatchesZeroRows: boolean }) {
  const txRow = { id: 'tx-1', is_bridge: false };

  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from(table: string) {
      if (table === 'users') {
        return {
          select() {
            return { eq() { return this; }, single: () => Promise.resolve({ data: { household_id: 'hh-1' }, error: null }) };
          },
        };
      }
      if (table !== 'transactions') throw new Error(`fake supabase: unexpected table "${table}"`);
      return {
        select() {
          return {
            eq() { return this; },
            single: () => Promise.resolve({ data: { ...txRow }, error: null }),
          };
        },
        update() {
          return {
            eq() { return this; },
            select() {
              return Promise.resolve(
                opts.writeMatchesZeroRows
                  ? { data: [], error: null }
                  : { data: [{ id: 'tx-1' }], error: null }
              );
            },
          };
        },
        delete() {
          return {
            eq() { return this; },
            select() {
              return Promise.resolve(
                opts.writeMatchesZeroRows
                  ? { data: [], error: null }
                  : { data: [{ id: 'tx-1' }], error: null }
              );
            },
          };
        },
      };
    },
  };
}

vi.mock('@/lib/supabase-server', () => ({
  createClient: vi.fn(),
}));

describe('PATCH/DELETE /api/expenses/[id] — lost-race safety', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('PATCH: row existed at read time but the update matches zero rows → 409, not a false saved:true', async () => {
    const supabase = makeFakeSupabase({ writeMatchesZeroRows: true });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    const { PATCH } = await import('../route');
    const res = await PATCH(
      new Request('http://localhost/api/expenses/tx-1', { method: 'PATCH', body: JSON.stringify({ amount: 50 }) }),
      { params: Promise.resolve({ id: 'tx-1' }) }
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it('PATCH: normal case still succeeds', async () => {
    const supabase = makeFakeSupabase({ writeMatchesZeroRows: false });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    const { PATCH } = await import('../route');
    const res = await PATCH(
      new Request('http://localhost/api/expenses/tx-1', { method: 'PATCH', body: JSON.stringify({ amount: 50 }) }),
      { params: Promise.resolve({ id: 'tx-1' }) }
    );
    expect(res.status).toBe(200);
  });

  it('DELETE: row existed at read time but the delete matches zero rows → 409, not a false deleted:true', async () => {
    const supabase = makeFakeSupabase({ writeMatchesZeroRows: true });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    const { DELETE } = await import('../route');
    const res = await DELETE(
      new Request('http://localhost/api/expenses/tx-1', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'tx-1' }) }
    );
    expect(res.status).toBe(409);
  });

  it('DELETE: normal case still succeeds', async () => {
    const supabase = makeFakeSupabase({ writeMatchesZeroRows: false });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    const { DELETE } = await import('../route');
    const res = await DELETE(
      new Request('http://localhost/api/expenses/tx-1', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'tx-1' }) }
    );
    expect(res.status).toBe(200);
  });
});
