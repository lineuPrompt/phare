import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tier 2 (2026-07-22, Codex adversarial review) — POST /api/card-envelope
 * used to swallow a failed accounts.update (statement_close_day/payment_day)
 * behind a plain `{saved: true}`, treated as a "non-fatal" partial write.
 * That's a real bug, not just a log line: a stale statement_close_day
 * silently misdates the next card bridge ensureBridgesForWindow computes.
 * Drives the real exported POST handler against a fake Supabase client whose
 * accounts.update() call fails on demand, and asserts the response makes
 * the partial failure explicit (`daysUpdateFailed: true`) rather than a
 * bare, indistinguishable `{saved: true}`.
 */

type Row = Record<string, unknown> & { id: string };

function makeFakeSupabase(opts: { failAccountUpdate?: boolean } = {}) {
  const store = {
    users: [{ id: 'user-1', household_id: 'hh-1' }] as Row[],
    accounts: [{ id: 'card-1', household_id: 'hh-1', name: 'Visa', type: 'credit_card' }] as Row[],
    monthly_goals: [] as Row[],
    card_envelope_items: [] as Row[],
  };

  function selectChain(rows: Row[]) {
    let result = rows;
    const api = {
      eq(field: string, value: unknown) { result = result.filter((r) => r[field] === value); return api; },
      single() {
        return Promise.resolve(result[0] ? { data: { ...result[0] }, error: null } : { data: null, error: { message: 'not found' } });
      },
      then(resolve: (v: { data: Row[]; error: null }) => unknown) {
        return Promise.resolve({ data: result.map((r) => ({ ...r })), error: null }).then(resolve);
      },
    };
    return api;
  }

  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from(table: keyof typeof store) {
      if (!(table in store)) throw new Error(`fake supabase: unknown table "${table}"`);
      return {
        select() { return selectChain(store[table]); },
        upsert() { return Promise.resolve({ data: null, error: null }); },
        delete() {
          return {
            eq() { return this; },
            then(resolve: (v: { data: null; error: null }) => unknown) {
              return Promise.resolve({ data: null, error: null }).then(resolve);
            },
          };
        },
        insert() { return Promise.resolve({ data: null, error: null }); },
        update() {
          return {
            eq() { return this; },
            then(resolve: (v: { data: null; error: { message: string } | null }) => unknown) {
              if (opts.failAccountUpdate) {
                return Promise.resolve({ data: null, error: { message: 'simulated accounts.update failure' } }).then(resolve);
              }
              return Promise.resolve({ data: null, error: null }).then(resolve);
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

describe('POST /api/card-envelope — partial statement-day write failure', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('goal + categories save, statement-day update fails: response marks it explicitly, not a bare saved:true', async () => {
    const supabase = makeFakeSupabase({ failAccountUpdate: true });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/card-envelope', {
      method: 'POST',
      body: JSON.stringify({
        cardId: 'card-1',
        month: '2026-07',
        totalGoal: 500,
        items: [],
        statementCloseDay: 15,
        paymentDay: 5,
      }),
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toBe(true);
    expect(body.daysUpdateFailed).toBe(true); // must NOT be a bare {saved: true}
  });

  it('everything succeeds: daysUpdateFailed is false', async () => {
    const supabase = makeFakeSupabase({ failAccountUpdate: false });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/card-envelope', {
      method: 'POST',
      body: JSON.stringify({
        cardId: 'card-1',
        month: '2026-07',
        totalGoal: 500,
        items: [],
        statementCloseDay: 15,
        paymentDay: 5,
      }),
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toBe(true);
    expect(body.daysUpdateFailed).toBe(false);
  });
});
