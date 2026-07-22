import { describe, it, expect, vi, beforeEach } from 'vitest';

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

function makeSupabaseMock(script: Record<string, Resolution[]>) {
  const cursors: Record<string, number> = {};

  function entry(table: string) {
    const idx = cursors[table] ?? 0;
    cursors[table] = idx + 1;
    const list = script[table] ?? [];
    if (idx >= list.length) {
      throw new Error(`No scripted response for table "${table}" call #${idx + 1}`);
    }
    return makeResultChain(list[idx]);
  }

  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: (table: string) => ({
      select: () => entry(table),
    }),
  };

  return { client };
}

vi.mock('@/lib/supabase-server', () => ({
  createClient: vi.fn(),
}));

describe('GET /api/sinking-funds', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('an unstarted buffer returns zeroed buffer fields and no fetches beyond sinking_funds', async () => {
    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      sinking_funds: [{
        data: [
          { id: 'sf-1', name: 'Property tax', annual_amount: 3600, monthly_provision: 300, due_month: 3, linked_account_id: null },
          { id: 'sf-2', name: 'Christmas', annual_amount: 3096, monthly_provision: 258, due_month: 12, linked_account_id: null },
        ],
        error: null,
      }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { GET } = await import('../route');
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.funds).toHaveLength(2);
    expect(json.buffer).toEqual({
      linkedAccountId: null, balance: 0, fundedAlready: false, totalMonthlyProvision: 558,
      contributionAmount: null, recurringItemId: null, nextContributionDate: null, contributions: [], upcomingContributions: [], billsPaid: [],
    });
  });

  it('a started buffer returns real balance, contribution history split past/future, bills paid, and the next contribution date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T12:00:00'));

    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      sinking_funds: [{
        data: [{ id: 'sf-1', name: 'Property tax', annual_amount: 3600, monthly_provision: 300, due_month: 3, linked_account_id: 'buffer-1' }],
        error: null,
      }],
      transactions: [{
        data: [
          { id: 't1', amount: 708, type: 'transfer', account_id: 'buffer-1', date: '2026-06-01', description: 'Sinking funds' },
          { id: 't2', amount: 300, type: 'expense', account_id: 'buffer-1', date: '2026-06-15', description: 'Property tax' },
          { id: 't3', amount: 708, type: 'transfer', account_id: 'buffer-1', date: '2026-08-01', description: 'Sinking funds' }, // future
        ],
        error: null,
      }],
      recurring_items: [{ data: { id: 'ri-1', amount: 708, cadence: 'monthly', anchor_date: '2026-07-01', second_day: null }, error: null }],
    });

    try {
      const { createClient } = await import('@/lib/supabase-server');
      (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

      const { GET } = await import('../route');
      const res = await GET();
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.buffer.linkedAccountId).toBe('buffer-1');
      expect(json.buffer.balance).toBe(408); // 708 − 300
      expect(json.buffer.fundedAlready).toBe(true);
      expect(json.buffer.recurringItemId).toBe('ri-1');
      expect(json.buffer.contributionAmount).toBe(708);
      expect(json.buffer.nextContributionDate).toBe('2026-08-01');
      expect(json.buffer.contributions).toEqual([{ id: 't1', date: '2026-06-01', description: 'Sinking funds', amount: 708 }]);
      expect(json.buffer.upcomingContributions).toEqual([{ id: 't3', date: '2026-08-01', description: 'Sinking funds', amount: 708 }]);
      expect(json.buffer.billsPaid).toEqual([{ id: 't2', date: '2026-06-15', description: 'Property tax', amount: 300 }]);
    } finally {
      vi.useRealTimers();
    }
  });
});
