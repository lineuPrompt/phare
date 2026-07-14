import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression test for the manual-entry-onboards-but-dashboard-is-empty bug:
// hasPlan used to be gated on the `budgets` table having a row, which is
// only populated when the plan has at least one VARIABLE-expense category.
// A minimal manual entry (income + a fixed bill, no day-to-day spending
// categories) legitimately has zero budget rows despite being a fully
// saved, valid plan — confirmed live against a real household (2
// recurring_items, 24 transactions, 1 account, 0 budgets). file_imports is
// the correct signal: every completed save-plan run inserts exactly one row
// there, unconditionally, via the same call regardless of source.

type Resolution = { data?: unknown; error?: unknown; count?: number };

function makeResultChain(resolution: Resolution) {
  const handler: ProxyHandler<object> = {
    get(_, prop) {
      if (prop === 'then') {
        return (resolve: (v: Resolution) => unknown, reject?: (v: unknown) => unknown) =>
          Promise.resolve(resolution).then(resolve, reject);
      }
      if (prop === 'catch') {
        return (reject: (v: unknown) => unknown) => Promise.resolve(resolution).catch(reject);
      }
      return (..._args: unknown[]) => makeResultChain(resolution);
    },
  };
  return new Proxy({}, handler);
}

function makeSupabaseMock(script: Record<string, Resolution[]>) {
  const cursors: Record<string, number> = {};

  function entry(table: string, resolutionOverride?: Resolution) {
    const idx = cursors[table] ?? 0;
    cursors[table] = idx + 1;
    const list = script[table] ?? [];
    if (idx >= list.length) {
      // events/isFirstReturnToday is fire-and-forget and shields its own
      // errors — safe to leave unscripted, same as every other test in
      // this codebase using this harness pattern.
      if (table === 'events') return makeResultChain({ data: null, error: null, count: 0 });
      throw new Error(`No scripted response for table "${table}" call #${idx + 1}`);
    }
    return makeResultChain(resolutionOverride ?? list[idx]);
  }

  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: (table: string) => ({
      select: () => entry(table),
      insert: () => entry(table),
    }),
  };

  return { client };
}

vi.mock('@/lib/supabase-server', () => ({
  createClient: vi.fn(),
}));

describe('GET /api/dashboard — plan existence gate', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('a household with zero budget rows but a completed onboarding (file_imports) still has a plan', async () => {
    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1', full_name: 'Lineu Prompt' }, error: null }],
      file_imports: [{ data: { id: 'imp-1' }, error: null }], // the plan-existence check
      budgets: [
        { data: null, error: null }, // planMonth lookup — none exist, falls back to actuals month
        { data: [], error: null },   // budget-vs-actual comparison rows
      ],
      transactions: [
        {
          data: [
            { amount: 2000, type: 'income', account_id: 'chq-1' },
            { amount: 800, type: 'expense', account_id: 'chq-1' },
          ],
          error: null,
        },
      ],
      accounts: [{ data: [{ id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null }], error: null }],
      sinking_funds: [{ data: [], error: null }],
      conversations: [{ data: null, error: null }],
      recurring_items: [
        { count: 0, error: null }, // unanchored income
        { count: 0, error: null }, // unanchored expense
      ],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { GET } = await import('../route');
    const res = await GET(new Request('http://localhost/api/dashboard'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.hasPlan).toBe(true);
    expect(json.summary.totalIncome).toBe(2000);
    expect(json.summary.totalExpenses).toBe(800);
  });

  it('a household with no completed onboarding at all (no file_imports) has no plan', async () => {
    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh2', full_name: 'Nobody' }, error: null }],
      file_imports: [{ data: null, error: null }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { GET } = await import('../route');
    const res = await GET(new Request('http://localhost/api/dashboard'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ hasPlan: false });
  });
});
