import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Regression test for the timezone-spine bug: anchors/route.ts's "anchorDate
// must not be in the future" guard used to derive "today" from the server
// process's clock (UTC in production), so in the evening — after UTC has
// already rolled to the next calendar day but it's still "today" in Eastern
// time — a real today-dated anchor was wrongly rejected as a future date.
// businessToday(householdTimezone) fixes this; these tests drive the actual
// POST handler against a household whose timezone is America/Toronto.

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

  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: (table: string) => ({
      select: () => entry(table),
      upsert: () => entry(table),
    }),
  };
}

vi.mock('@/lib/supabase-server', () => ({
  createClient: vi.fn(),
}));

describe('POST /api/anchors — future-date guard uses the household timezone, not the server clock', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts an anchor dated "today" in Eastern time even though UTC has already rolled to tomorrow', async () => {
    vi.useFakeTimers();
    // 2026-01-20 20:00 EST == 2026-01-21 01:00 UTC — evening in Montreal,
    // already the next calendar day in UTC.
    vi.setSystemTime(new Date('2026-01-21T01:00:00Z'));

    const client = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      accounts: [{ data: { id: 'chq-1', type: 'chequing' }, error: null }],
      account_balance_anchors: [{ data: { id: 'anc-1', anchor_date: '2026-01-20', balance: 1000 }, error: null }],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/anchors', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'chq-1', anchorDate: '2026-01-20', balance: 1000 }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.anchor.anchor_date).toBe('2026-01-20');
  });

  it('still rejects an anchor dated the actual Eastern tomorrow at that same instant', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-21T01:00:00Z'));

    const client = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/anchors', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'chq-1', anchorDate: '2026-01-21', balance: 1000 }),
    }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/future/);
  });
});
