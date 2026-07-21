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
