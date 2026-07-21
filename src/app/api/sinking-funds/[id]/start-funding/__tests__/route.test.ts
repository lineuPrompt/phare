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

vi.mock('@/lib/supabase-server', () => ({
  createClient: vi.fn(),
}));

describe('POST /api/sinking-funds/[id]/start-funding', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a flagged fund account, links the provision row, and materializes 12 months of transfers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T12:00:00'));

    const { client, calls, rpcCalls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      household_members: [{ data: { id: 'mem-1' }, error: null }],
      sinking_funds: [
        { data: { id: 'sf-1', name: 'Property tax', monthly_provision: 300, linked_account_id: null }, error: null }, // lookup
        { error: null }, // link update
      ],
      accounts: [
        { data: { id: 'chq-1' }, error: null }, // chequing lookup
        { data: [{ sort_order: 2 }], error: null }, // existing accounts for sort_order
        { data: { id: 'fund-acct-1', name: 'Property tax', type: 'savings' }, error: null }, // new account insert
      ],
      recurring_items: [{ data: { id: 'ri-1' }, error: null }],
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(
      new Request('http://localhost/api/sinking-funds/sf-1/start-funding', { method: 'POST' }),
      { params: Promise.resolve({ id: 'sf-1' }) }
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ created: true, accountId: 'fund-acct-1', recurringItemId: 'ri-1', materialized: 12 });

    const accountInsert = calls.find((c) => c.table === 'accounts' && c.method === 'insert');
    expect(accountInsert!.args[0]).toMatchObject({
      household_id: 'hh1', name: 'Property tax', type: 'savings', is_sinking_fund: true, sort_order: 3,
    });

    const linkUpdate = calls.find((c) => c.table === 'sinking_funds' && c.method === 'update');
    expect(linkUpdate!.args[0]).toEqual({ linked_account_id: 'fund-acct-1' });

    const recurringInsert = calls.find((c) => c.table === 'recurring_items' && c.method === 'insert');
    expect(recurringInsert!.args[0]).toMatchObject({
      destination_account_id: 'fund-acct-1', account_id: 'chq-1', amount: 300, type: 'transfer', cadence: 'monthly',
    });

    expect(rpcCalls).toHaveLength(12);
    expect(rpcCalls[0][1]).toMatchObject({ p_chequing_id: 'chq-1', p_goal_id: 'fund-acct-1', p_amount: 300 });
  });

  it('rejects a fund that is already linked (already being funded)', async () => {
    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      household_members: [{ data: { id: 'mem-1' }, error: null }],
      sinking_funds: [
        { data: { id: 'sf-1', name: 'Property tax', monthly_provision: 300, linked_account_id: 'already-linked' }, error: null },
      ],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(
      new Request('http://localhost/api/sinking-funds/sf-1/start-funding', { method: 'POST' }),
      { params: Promise.resolve({ id: 'sf-1' }) }
    );
    expect(res.status).toBe(400);
  });

  it('404s for a fund that does not belong to the caller\'s household', async () => {
    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      household_members: [{ data: { id: 'mem-1' }, error: null }],
      sinking_funds: [{ data: null, error: null }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(
      new Request('http://localhost/api/sinking-funds/sf-1/start-funding', { method: 'POST' }),
      { params: Promise.resolve({ id: 'sf-1' }) }
    );
    expect(res.status).toBe(404);
  });

  it('a fund with no stated monthly provision still creates + links the account, with no recurring rule', async () => {
    const { client, calls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      household_members: [{ data: { id: 'mem-1' }, error: null }],
      sinking_funds: [
        { data: { id: 'sf-1', name: 'Christmas', monthly_provision: null, linked_account_id: null }, error: null },
        { error: null },
      ],
      accounts: [
        { data: { id: 'chq-1' }, error: null },
        { data: [], error: null },
        { data: { id: 'fund-acct-1', name: 'Christmas', type: 'savings' }, error: null },
      ],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(
      new Request('http://localhost/api/sinking-funds/sf-1/start-funding', { method: 'POST' }),
      { params: Promise.resolve({ id: 'sf-1' }) }
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ created: true, accountId: 'fund-acct-1', recurringItemId: null, materialized: 0 });
    expect(calls.find((c) => c.table === 'recurring_items')).toBeUndefined();
  });
});
