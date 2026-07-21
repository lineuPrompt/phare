import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Regression test for the timezone-spine bug: recurring/route.ts used to
// derive "today" (and therefore the materialization month-start) from the
// server process's clock — UTC in production. Late in the evening Eastern
// time, UTC has already rolled to the next calendar day/month, so a rule
// created on the last day of a month would silently materialize starting
// the WRONG (next) month, permanently losing that month's real occurrence.
// getHouseholdTimezone + businessToday fixes this.

type Resolution = { data?: unknown; error?: unknown };

function makeResultChain(resolution: Resolution) {
  const handler: ProxyHandler<object> = {
    get(_, prop) {
      if (prop === 'then') {
        return (resolve: (v: Resolution) => unknown, reject?: (v: unknown) => unknown) =>
          Promise.resolve(resolution).then(resolve, reject);
      }
      return (..._args: unknown[]) => makeResultChain(resolution);
    },
  };
  return new Proxy({}, handler);
}

type Call = { table: string; method: string; args: unknown[] };

function makeSupabaseMock(script: Record<string, Resolution[]>) {
  const cursors: Record<string, number> = {};
  const calls: Call[] = [];

  function entry(table: string, method: string, args: unknown[]) {
    calls.push({ table, method, args });
    const idx = cursors[table] ?? 0;
    cursors[table] = idx + 1;
    const list = script[table] ?? [];
    if (idx >= list.length) {
      throw new Error(`No scripted response for table "${table}" call #${idx + 1} (method: ${method})`);
    }
    return makeResultChain(list[idx]);
  }

  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: (table: string) => ({
      select: (...args: unknown[]) => entry(table, 'select', args),
      insert: (...args: unknown[]) => entry(table, 'insert', args),
      delete: (...args: unknown[]) => entry(table, 'delete', args),
    }),
  };

  return { client, calls };
}

vi.mock('@/lib/supabase-server', () => ({
  createClient: vi.fn(),
}));

describe('POST /api/recurring — materialization month-start uses the household timezone', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a rule created at 8:30pm EDT on July 31 materializes starting July, not August', async () => {
    vi.useFakeTimers();
    // 2026-07-31 20:30 EDT == 2026-08-01 00:30 UTC.
    vi.setSystemTime(new Date('2026-08-01T00:30:00Z'));

    const { client, calls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      household_members: [{ data: { id: 'mem-1' }, error: null }],
      accounts: [{ data: { id: 'chq-1' }, error: null }],
      recurring_items: [{ data: { id: 'ri-1' }, error: null }],
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      transactions: [
        { error: null }, // cleanup delete
        { error: null }, // insert
      ],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/recurring', {
      method: 'POST',
      body: JSON.stringify({
        description: 'Rent', amount: 1500, type: 'expense', cadence: 'monthly',
        anchorDate: '2026-07-31', categoryId: 'cat-housing', accountId: 'chq-1',
      }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);

    const insert = calls.find((c) => c.table === 'transactions' && c.method === 'insert');
    expect(insert).toBeDefined();
    const rows = insert!.args[0] as { date: string }[];
    // The first materialized occurrence must be July 31 itself — proof the
    // materialization window started at July, not August. The old
    // UTC-derived "today" (2026-08-01) would have started the window a
    // full month late, silently dropping this occurrence forever.
    expect(rows[0].date).toBe('2026-07-31');
    expect(rows.some((r) => r.date.startsWith('2026-08'))).toBe(true);
    expect(rows.every((r) => r.date >= '2026-07-31')).toBe(true);
  });
});
