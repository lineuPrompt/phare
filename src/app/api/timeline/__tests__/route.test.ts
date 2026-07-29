import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// These tests cover the additive Phase 3 surface only: the optional
// `windowStart` query param and the `unbalancedDays` response field.
// ensureBridgesForWindow is mocked out — its own behavior is covered by
// bridgeHelpers.test.ts, and scripting its internal supabase calls here
// would just duplicate that coverage for no benefit.

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

type Call = { table: string; args: unknown[] };

function makeSupabaseMock(script: Record<string, Resolution[]>) {
  const cursors: Record<string, number> = {};
  const calls: Call[] = [];

  function entry(table: string, args: unknown[]) {
    calls.push({ table, args });
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
      select: (...args: unknown[]) => entry(table, args),
      // Only 'events' inserts are exercised by these tests (logEvent) — a
      // plain resolved success is all any caller here needs.
      insert: (row: unknown) => {
        calls.push({ table, args: ['insert', row] });
        return Promise.resolve({ error: null });
      },
    }),
  };

  return { client, calls };
}

vi.mock('@/lib/supabase-server', () => ({
  createClient: vi.fn(),
}));

const ensureBridgesMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/bridgeHelpers', () => ({
  ensureBridgesForWindow: (...args: unknown[]) => ensureBridgesMock(...args),
}));

async function getTimeline(query: string) {
  const { GET } = await import('../route');
  return GET(new Request(`http://localhost/api/timeline?${query}`));
}

describe('GET /api/timeline — windowStart param and unbalancedDays', () => {
  beforeEach(() => {
    vi.resetModules();
    ensureBridgesMock.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects a malformed windowStart before touching the database', async () => {
    const res = await getTimeline('account=acc-1&windowStart=2026-07-15');
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/windowStart/);
  });

  it('default window (no windowStart) returns unbalancedDays: [] alongside the existing shape', async () => {
    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' } }],
      households: [{ data: { timezone: 'America/Toronto' } }],
      accounts: [
        { data: { id: 'acc-1', type: 'chequing' } }, // target account lookup
        { data: [] },                                 // card accounts (none)
      ],
      household_members: [{ data: { id: 'mem-1' } }],
      account_balance_anchors: [{ data: [{ anchor_date: '2026-07-01', balance: 1000 }] }],
      transactions: [{ data: [] }],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await getTimeline('account=acc-1');
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.balancesStartDate).toBe('2026-07-01');
    expect(json.unbalancedDays).toEqual([]);
    expect(ensureBridgesMock).toHaveBeenCalledTimes(1);
  });

  it('windowStart earlier than the first anchor surfaces pre-anchor entries as unbalancedDays, scoped to that range', async () => {
    const { client, calls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' } }],
      households: [{ data: { timezone: 'America/Toronto' } }],
      accounts: [
        { data: { id: 'acc-1', type: 'chequing' } },
        { data: [] },
      ],
      household_members: [{ data: { id: 'mem-1' } }],
      account_balance_anchors: [{ data: [{ anchor_date: '2026-07-15', balance: 500 }] }],
      transactions: [
        { data: [] }, // main fetch: from anchor date (07-15) through windowEnd — empty for this test
        {
          data: [
            {
              id: 'tx-1', date: '2026-07-03', description: 'Paycheque', amount: 200, type: 'income',
              recurring_item_id: null, recurrence_id: null, installment_label: null,
              transfer_peer_id: null, is_bridge: false, bridge_source_account: null,
            },
          ],
        }, // pre-anchor fetch: windowStart (07-01) through balancesStartDate (07-15)
      ],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await getTimeline('account=acc-1&windowStart=2026-07-01');
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.balancesStartDate).toBe('2026-07-15');
    expect(json.unbalancedDays).toEqual([
      { date: '2026-07-03', entries: [expect.objectContaining({ id: 'tx-1', type: 'income' })] },
    ]);

    // Two transactions calls were made: the buildCashTimeline fetch (from the
    // anchor date) and the separate pre-anchor fetch (from windowStart).
    const txCalls = calls.filter((c) => c.table === 'transactions');
    expect(txCalls).toHaveLength(2);
  });

  it('a windowStart later than the default is ignored (never extends the window forward)', async () => {
    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' } }],
      households: [{ data: { timezone: 'America/Toronto' } }],
      accounts: [
        { data: { id: 'acc-1', type: 'chequing' } },
        { data: [] },
      ],
      household_members: [{ data: { id: 'mem-1' } }],
      account_balance_anchors: [{ data: [{ anchor_date: '2026-06-01', balance: 1000 }] }],
      transactions: [{ data: [] }],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    // 2026-09-01 is after the default windowStart (2026-07-01) — must be clamped to default.
    const res = await getTimeline('account=acc-1&windowStart=2026-09-01');
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.balancesStartDate).toBe('2026-07-01'); // default windowStart, not clamped forward to Sept
  });
});

describe('GET /api/timeline — timeline_opened funnel event', () => {
  beforeEach(() => {
    vi.resetModules();
    ensureBridgesMock.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const baseScript = {
    users: [{ data: { household_id: 'hh1' } }],
    households: [{ data: { timezone: 'America/Toronto' } }],
    accounts: [
      { data: { id: 'acc-1', type: 'chequing' } },
      { data: [] },
    ],
    household_members: [{ data: { id: 'mem-1' } }],
    account_balance_anchors: [{ data: [{ anchor_date: '2026-07-01', balance: 1000 }] }],
    transactions: [{ data: [] }],
  };

  it('fires once on a genuine Timeline page load (pageView=1)', async () => {
    const { client, calls } = makeSupabaseMock(baseScript);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await getTimeline('account=acc-1&pageView=1');
    expect(res.status).toBe(200);

    const eventInserts = calls.filter((c) => c.table === 'events');
    expect(eventInserts).toHaveLength(1);
    expect((eventInserts[0].args[1] as { event_type: string }).event_type).toBe('timeline_opened');
  });

  it('does NOT fire when pageView is absent — the dashboard\'s dip-tile call to this same endpoint must never count as a Timeline open', async () => {
    const { client, calls } = makeSupabaseMock(baseScript);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await getTimeline('account=acc-1');
    expect(res.status).toBe(200);

    const eventInserts = calls.filter((c) => c.table === 'events');
    expect(eventInserts).toHaveLength(0);
  });

  it('fires on every real load, not gated to the first ever — a repeat visit still logs (frequency signal, not a one-time milestone)', async () => {
    const { client, calls } = makeSupabaseMock(baseScript);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    await getTimeline('account=acc-1&pageView=1');

    // A second, independent page load (fresh mock instance, same household)
    // must fire again — this is not an isFirstEvent-gated milestone.
    const { client: client2, calls: calls2 } = makeSupabaseMock(baseScript);
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client2);
    await getTimeline('account=acc-1&pageView=1');

    expect(calls.filter((c) => c.table === 'events')).toHaveLength(1);
    expect(calls2.filter((c) => c.table === 'events')).toHaveLength(1);
  });
});

describe('GET /api/timeline — includePlan (the chained 12-month plan)', () => {
  beforeEach(() => {
    vi.resetModules();
    ensureBridgesMock.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const baseScript = {
    users: [{ data: { household_id: 'hh1' } }],
    households: [{ data: { timezone: 'America/Toronto' } }],
    accounts: [
      { data: { id: 'acc-1', type: 'chequing' } },
      { data: [] }, // no credit cards — skips the monthly_goals/card-transactions queries
    ],
    household_members: [{ data: { id: 'mem-1' } }],
    account_balance_anchors: [{ data: [{ anchor_date: '2026-07-01', balance: 1000 }] }],
    transactions: [
      { data: [] }, // main real-walk fetch (also reused as the plan's dated basis)
    ],
    recurring_items: [
      { count: 0, data: [] }, // unanchored income count
      { count: 0, data: [] }, // unanchored expense count
    ],
  };

  it('omits `plan` entirely when includePlan is not passed (no extra queries run)', async () => {
    const { client, calls } = makeSupabaseMock({ ...baseScript, transactions: [{ data: [] }] });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await getTimeline('account=acc-1');
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.plan).toBeNull();
    expect(calls.filter((c) => c.table === 'recurring_items')).toHaveLength(0);
  });

  it('includePlan=1 returns a 12-month chain anchored at todayBalance', async () => {
    const { client } = makeSupabaseMock(baseScript);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await getTimeline('account=acc-1&includePlan=1');
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.todayBalance).toBe(1000);
    expect(json.plan).not.toBeNull();
    expect(json.plan.months).toHaveLength(12);
    expect(json.plan.months[0].month).toBe('2026-07');
    expect(json.plan.months[0].isPartialMonth).toBe(true);
    // No dated rows, no card cost → the anchor never moves.
    expect(json.plan.months.every((m: { balance: number }) => m.balance === 1000)).toBe(true);
  });

  // THE REAL SEAM: Supabase select → toTimelineTxs → the transactions.map
  // that builds datedTransactions → buildPlanChain. The pure-function tests
  // (planChainHelpers.test.ts) hand-build correctly-shaped fixtures and
  // never exercise this path — this is what actually caught nothing, twice,
  // while the underlying math was already fixed. A raw DB row shaped
  // exactly like the real household's — a recurring, dated TRANSFER
  // contribution in the remainder of the current month — must survive the
  // whole trip and land in the returned chain.
  it('a real DB row (recurring transfer contribution, dated in the remainder of the month) survives select -> toTimelineTxs -> datedTransactions -> buildPlanChain', async () => {
    const { client } = makeSupabaseMock({
      ...baseScript,
      transactions: [
        {
          data: [
            {
              id: 'tx-1', date: '2026-07-30', description: 'Savings Bigode', amount: 350, type: 'transfer',
              recurring_item_id: 'ri-savings', recurrence_id: null, installment_label: null,
              transfer_peer_id: 'peer-1', is_bridge: false, bridge_source_account: null, bridge_source_month: null,
            },
          ],
        },
      ],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await getTimeline('account=acc-1&includePlan=1');
    const json = await res.json();

    expect(res.status).toBe(200);
    // A transfer contribution is an outflow — same rule the real ledger
    // walk (todayBalance itself) already applies via signAmount.
    expect(json.plan.months[0].balance).toBe(650); // 1000 - 350, not 1000
  });
});
