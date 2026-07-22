import { describe, it, expect, vi, beforeEach } from 'vitest';

// Founder-reported bug: adding an expense stamped the creating user's own
// member_id on the row, later rendered as a personal attribution
// ("Canadian Tire — Lineu Prompt Graeff") even though expenses are
// household-level, not personal — same rule save-plan's onboarding path
// already follows for fixed expenses (member_id null). Income keeps member
// attribution, unchanged.

type Resolution = { data?: unknown; error?: unknown; count?: number };
type Call = { table: string; method: string; args: unknown[] };

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
  const calls: Call[] = [];

  function entry(table: string, method: string, args: unknown[]) {
    calls.push({ table, method, args });
    const idx = cursors[table] ?? 0;
    cursors[table] = idx + 1;
    const list = script[table] ?? [];
    if (idx >= list.length) {
      // events (created_first_expense) is fire-and-forget and shields its
      // own errors — safe to leave unscripted.
      if (table === 'events') return makeResultChain({ data: null, error: null, count: 0 });
      throw new Error(`No scripted response for table "${table}" call #${idx + 1} (method: ${method})`);
    }
    return makeResultChain(list[idx]);
  }

  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: (table: string) => ({
      select: (...args: unknown[]) => entry(table, 'select', args),
      insert: (...args: unknown[]) => entry(table, 'insert', args),
    }),
  };

  return { client, calls };
}

vi.mock('@/lib/supabase-server', () => ({
  createClient: vi.fn(),
}));

describe('POST /api/expenses — member attribution', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('a manually-added EXPENSE gets member_id: null, never the creating user', async () => {
    const { client, calls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      household_members: [{ data: { id: 'mem-creator' }, error: null }],
      transactions: [{ error: null }],
      events: [{ count: 0, error: null }],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/expenses', {
      method: 'POST',
      body: JSON.stringify({
        date: '2026-07-20', description: 'Canadian Tire', categoryId: 'cat-shopping',
        amount: 89, accountId: 'chq-1', type: 'expense',
      }),
    }));
    expect(res.status).toBe(200);

    const insert = calls.find((c) => c.table === 'transactions' && c.method === 'insert');
    const rows = insert!.args[0] as { member_id: unknown }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].member_id).toBeNull();
  });

  it('a manually-added INCOME still carries the creating user\'s member_id, unchanged', async () => {
    const { client, calls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      household_members: [{ data: { id: 'mem-creator' }, error: null }],
      transactions: [{ error: null }],
      events: [{ count: 0, error: null }],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/expenses', {
      method: 'POST',
      body: JSON.stringify({
        date: '2026-07-20', description: 'Freelance gig', amount: 400, accountId: 'chq-1', type: 'income',
      }),
    }));
    expect(res.status).toBe(200);

    const insert = calls.find((c) => c.table === 'transactions' && c.method === 'insert');
    const rows = insert!.args[0] as { member_id: unknown }[];
    expect(rows[0].member_id).toBe('mem-creator');
  });

  it('an expense with monthly repeat: every materialized row gets member_id: null', async () => {
    const { client, calls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      household_members: [{ data: { id: 'mem-creator' }, error: null }],
      transactions: [{ error: null }],
      events: [{ count: 0, error: null }],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/expenses', {
      method: 'POST',
      body: JSON.stringify({
        date: '2026-07-20', description: 'Gym membership', categoryId: 'cat-health',
        amount: 40, accountId: 'chq-1', type: 'expense', repeat: 'monthly',
      }),
    }));
    expect(res.status).toBe(200);

    const insert = calls.find((c) => c.table === 'transactions' && c.method === 'insert');
    const rows = insert!.args[0] as { member_id: unknown }[];
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every((r) => r.member_id === null)).toBe(true);
  });
});
