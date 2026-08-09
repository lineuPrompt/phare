import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

function makeSupabaseMock(script: Record<string, Resolution[]>, rpcResolution: Resolution = { error: null }) {
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

  const rpcCalls: unknown[][] = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: (table: string) => ({
      select: (...args: unknown[]) => entry(table, 'select', args),
      insert: (...args: unknown[]) => entry(table, 'insert', args),
      update: (...args: unknown[]) => entry(table, 'update', args),
    }),
    rpc: (...args: unknown[]) => {
      rpcCalls.push(args);
      return Promise.resolve(rpcResolution);
    },
  };

  return { client, calls, rpcCalls };
}

// The route now reads an optional { anchorDay } body — a plain Request is
// all it needs. No body at all is the pre-2026-08-09 behaviour (anchor on
// today), which the existing cases below all exercise.
function req(body?: unknown): Request {
  return new Request('http://localhost/api/sinking-funds/start-funding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

vi.mock('@/lib/supabase-server', () => ({
  createClient: vi.fn(),
}));

describe('POST /api/sinking-funds/start-funding — collapses every provision into ONE buffer', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sums every fund\'s monthly_provision into one account + one recurring rule, and links every row to it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T12:00:00'));

    const { client, calls, rpcCalls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      household_members: [{ data: { id: 'mem-1' }, error: null }],
      sinking_funds: [
        {
          data: [
            { id: 'sf-1', monthly_provision: 300, linked_account_id: null }, // property tax
            { id: 'sf-2', monthly_provision: 258, linked_account_id: null }, // Christmas
            { id: 'sf-3', monthly_provision: 150, linked_account_id: null }, // car registration
          ],
          error: null,
        },
        { error: null }, // link update
      ],
      accounts: [
        { data: { id: 'chq-1' }, error: null },      // chequing lookup
        { data: [{ sort_order: 2 }], error: null },  // existing accounts for sort_order
        { data: { id: 'buffer-1' }, error: null },   // new account insert
      ],
      recurring_items: [{ data: { id: 'ri-1' }, error: null }],
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(req());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      created: true, accountId: 'buffer-1', recurringItemId: 'ri-1', materialized: 12, totalMonthlyProvision: 708,
    });

    const accountInsert = calls.find((c) => c.table === 'accounts' && c.method === 'insert');
    expect(accountInsert!.args[0]).toMatchObject({
      household_id: 'hh1', name: 'Sinking funds', type: 'savings', is_sinking_fund: true, sort_order: 3,
    });

    // Every row gets the SAME account — no per-fund .eq('id', ...) filter,
    // update targets the whole household's sinking_funds set at once.
    const linkUpdate = calls.find((c) => c.table === 'sinking_funds' && c.method === 'update');
    expect(linkUpdate!.args[0]).toEqual({ linked_account_id: 'buffer-1' });

    const recurringInsert = calls.find((c) => c.table === 'recurring_items' && c.method === 'insert');
    expect(recurringInsert!.args[0]).toMatchObject({
      destination_account_id: 'buffer-1', account_id: 'chq-1', amount: 708, type: 'transfer', cadence: 'monthly',
    });

    expect(rpcCalls).toHaveLength(12);
    expect(rpcCalls[0][1]).toMatchObject({ p_chequing_id: 'chq-1', p_goal_id: 'buffer-1', p_amount: 708 });
  });

  it('rejects when the buffer is already started (any row already linked)', async () => {
    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      household_members: [{ data: { id: 'mem-1' }, error: null }],
      sinking_funds: [{
        data: [
          { id: 'sf-1', monthly_provision: 300, linked_account_id: 'buffer-1' },
          { id: 'sf-2', monthly_provision: 258, linked_account_id: 'buffer-1' },
        ],
        error: null,
      }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(req());
    expect(res.status).toBe(400);
  });

  it('rejects when there are no sinking funds at all', async () => {
    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      household_members: [{ data: { id: 'mem-1' }, error: null }],
      sinking_funds: [{ data: [], error: null }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(req());
    expect(res.status).toBe(400);
  });

  it('rejects when every fund has a zero/null provision (nothing to sum)', async () => {
    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      household_members: [{ data: { id: 'mem-1' }, error: null }],
      sinking_funds: [{
        data: [{ id: 'sf-1', monthly_provision: null, linked_account_id: null }],
        error: null,
      }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(req());
    expect(res.status).toBe(400);
  });
  // ── Settable contribution day (2026-08-09) ────────────────────────────────
  // Was hardcoded to "today", so a household that set up on the 9th was
  // funded on the 9th forever regardless of when they are actually paid.

  function fundableMock() {
    return makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      household_members: [{ data: { id: 'mem-1' }, error: null }],
      sinking_funds: [
        { data: [{ id: 'sf-1', monthly_provision: 708, linked_account_id: null, active: true }], error: null },
        { error: null },
      ],
      accounts: [
        { data: { id: 'chq-1' }, error: null },
        { data: [{ sort_order: 2 }], error: null },
        { data: { id: 'buffer-1' }, error: null },
      ],
      recurring_items: [{ data: { id: 'ri-1' }, error: null }],
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
    });
  }

  async function runWith(body: unknown, systemTime: string) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(systemTime));
    const { client, calls, rpcCalls } = fundableMock();
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const { POST } = await import('../route');
    const res = await POST(req(body));
    const anchor = (calls.find((c) => c.table === 'recurring_items' && c.method === 'insert')!
      .args[0] as { anchor_date: string }).anchor_date;
    return { res, anchor, rpcCalls };
  }

  it('anchors on the chosen day, not the day they happened to set it up', async () => {
    const { res, anchor, rpcCalls } = await runWith({ anchorDay: 15 }, '2026-07-09T12:00:00');
    expect(res.status).toBe(200);
    expect(anchor).toBe('2026-07-15');
    // Set up on the 9th, chose the 15th: this month's 15th is still ahead,
    // so all 12 occurrences are real and every one lands on the 15th.
    expect(rpcCalls).toHaveLength(12);
    expect(rpcCalls.map((c) => (c[1] as { p_date: string }).p_date).slice(0, 3))
      .toEqual(['2026-07-15', '2026-08-15', '2026-09-15']);
  });

  it('never back-dates a contribution to a day already past this month', async () => {
    // Set up on the 9th, chose the 5th. Materializing from the month start
    // would write a contribution dated four days ago that never happened.
    const { res, anchor, rpcCalls } = await runWith({ anchorDay: 5 }, '2026-07-09T12:00:00');
    expect(res.status).toBe(200);
    expect(anchor).toBe('2026-07-05');
    expect(rpcCalls).toHaveLength(11);
    const dates = rpcCalls.map((c) => (c[1] as { p_date: string }).p_date);
    expect(dates[0]).toBe('2026-08-05');
    expect(dates.some((d) => d < '2026-07-09')).toBe(false);
  });

  it('keeps a chosen 31st as the 31st instead of clamping it away', async () => {
    // February has no 31st. Clamping would rewrite the household's choice to
    // the 28th permanently, since every later read takes the day off the
    // anchor. Rolling forward preserves it.
    const { res, anchor, rpcCalls } = await runWith({ anchorDay: 31 }, '2026-02-10T12:00:00');
    expect(res.status).toBe(200);
    expect(anchor).toBe('2026-03-31');
    const dates = rpcCalls.map((c) => (c[1] as { p_date: string }).p_date);
    // Read-time clamping still applies per month, which is the honest place
    // for it: month-end in short months, the 31st in long ones.
    expect(dates).toContain('2026-04-30');
    expect(dates).toContain('2026-05-31');
    expect(dates.some((d) => d < '2026-02-10')).toBe(false);
  });

  it('falls back to today when no day is given (unchanged behaviour)', async () => {
    const { res, anchor, rpcCalls } = await runWith(undefined, '2026-07-09T12:00:00');
    expect(res.status).toBe(200);
    expect(anchor).toBe('2026-07-09');
    expect(rpcCalls).toHaveLength(12);
  });

  it('rejects a day outside 1-31 without creating anything', async () => {
    for (const bad of [0, 32, 4.5, -1]) {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-09T12:00:00'));
      const { client, calls } = fundableMock();
      const { createClient } = await import('@/lib/supabase-server');
      (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
      const { POST } = await import('../route');
      const res = await POST(req({ anchorDay: bad }));
      expect(res.status).toBe(400);
      // Rejected before any write — no half-built buffer left behind.
      expect(calls.filter((c) => c.method === 'insert')).toHaveLength(0);
    }
  });
});
