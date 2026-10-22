import { describe, it, expect, vi, beforeEach } from 'vitest';

// /api/accounts must never answer success over a failure
// (docs/tickets/accounts-route-silent-failures.md):
//   - GET over a failed read used to answer { accounts: [] } — "no accounts",
//     which offers Chequing as a type to add and shows "no chequing";
//   - POST over a failed opening balance used to answer 200 — every goal
//     figure then low by that amount, and nothing said so;
//   - POST over a failed read of the existing order silently put the new
//     account first.

type Resolution = { data?: unknown; error?: unknown };
type Call = { table: string; method: string; args: unknown[] };

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
  const calls: Call[] = [];
  function entry(table: string, method: string, args: unknown[]) {
    calls.push({ table, method, args });
    const idx = cursors[table] ?? 0;
    cursors[table] = idx + 1;
    const list = script[table] ?? [];
    if (idx >= list.length) throw new Error(`No scripted response for table "${table}" call #${idx + 1} (${method})`);
    return makeResultChain(list[idx]);
  }
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: (table: string) => ({
      select: (...a: unknown[]) => entry(table, 'select', a),
      insert: (...a: unknown[]) => entry(table, 'insert', a),
    }),
  };
  return { client, calls };
}

vi.mock('@/lib/supabase-server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/householdTimezone', () => ({ getHouseholdTimezone: async () => 'America/Toronto' }));

const setOpeningBalance = vi.fn();
vi.mock('@/lib/openingBalance', () => ({ setOpeningBalance: (...a: unknown[]) => setOpeningBalance(...a) }));

const logEvent = vi.fn();
vi.mock('@/lib/eventLogger', () => ({
  isFirstEvent: async () => true,
  logEvent: (...a: unknown[]) => logEvent(...a),
}));

async function route(client: unknown) {
  const { createClient } = await import('@/lib/supabase-server');
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return import('../route');
}

const USER = { data: { household_id: 'hh1' }, error: null };
const SAVINGS = { id: 'acc-new', name: 'Trip', type: 'savings', statement_close_day: null, payment_day: null, goal_target: 3000, goal_target_date: null };

function post(body: unknown) {
  return new Request('http://localhost/api/accounts', { method: 'POST', body: JSON.stringify(body) });
}

describe('GET /api/accounts', () => {
  beforeEach(() => { vi.resetModules(); });

  it('a failed read is a 500 carrying the database reason, not { accounts: [] }', async () => {
    const { client } = makeSupabaseMock({
      users: [USER],
      accounts: [{ data: null, error: { message: 'canceling statement due to statement timeout' } }],
    });
    const { GET } = await route(client);

    const res = await GET();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to load accounts: canceling statement due to statement timeout');
    expect(json.accounts).toBeUndefined();
  });

  it('a successful read returns the accounts', async () => {
    const { client } = makeSupabaseMock({ users: [USER], accounts: [{ data: [SAVINGS], error: null }] });
    const { GET } = await route(client);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accounts: [SAVINGS] });
  });
});

describe('POST /api/accounts', () => {
  beforeEach(() => {
    vi.resetModules();
    setOpeningBalance.mockReset();
    logEvent.mockReset();
  });

  it('a failed opening balance: 500 opening_balance_failed with the reason AND the created account', async () => {
    setOpeningBalance.mockResolvedValue('insert or update on table "transactions" violates foreign key constraint');
    const { client } = makeSupabaseMock({
      users: [USER],
      accounts: [{ data: [{ sort_order: 1 }], error: null }, { data: SAVINGS, error: null }],
    });
    const { POST } = await route(client);

    const res = await POST(post({ name: 'Trip', type: 'savings', goalTarget: 3000, openingBalance: 500 }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.code).toBe('opening_balance_failed');
    expect(json.error).toBe(
      'The account was created, but its starting balance was not saved: insert or update on table "transactions" violates foreign key constraint'
    );
    // The account exists: the caller gets it, so it refreshes rather than
    // creating it a second time.
    expect(json.account).toEqual(SAVINGS);
    expect(setOpeningBalance).toHaveBeenCalledWith(expect.anything(), 'hh1', 'acc-new', 500, expect.any(String));
    // The first-goal event still records: the account was created.
    expect(logEvent).toHaveBeenCalledWith('hh1', 'user-1', 'created_first_goal', { account_type: 'savings' });
  });

  it('a saved opening balance answers 200 with the account', async () => {
    setOpeningBalance.mockResolvedValue(null);
    const { client } = makeSupabaseMock({
      users: [USER],
      accounts: [{ data: [{ sort_order: 1 }], error: null }, { data: SAVINGS, error: null }],
    });
    const { POST } = await route(client);

    const res = await POST(post({ name: 'Trip', type: 'savings', openingBalance: 500 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ account: SAVINGS });
  });

  it('no opening balance sent: none is written, 200', async () => {
    const { client } = makeSupabaseMock({
      users: [USER],
      accounts: [{ data: [], error: null }, { data: SAVINGS, error: null }],
    });
    const { POST } = await route(client);

    const res = await POST(post({ name: 'Trip', type: 'savings' }));
    expect(res.status).toBe(200);
    expect(setOpeningBalance).not.toHaveBeenCalled();
  });

  it('a failed read of the existing order is a 500 before anything is written', async () => {
    const { client, calls } = makeSupabaseMock({
      users: [USER],
      accounts: [{ data: null, error: { message: 'connection reset' } }],
    });
    const { POST } = await route(client);

    const res = await POST(post({ name: 'Trip', type: 'savings', openingBalance: 500 }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to read accounts: connection reset');
    expect(calls.some((c) => c.method === 'insert')).toBe(false);
    expect(setOpeningBalance).not.toHaveBeenCalled();
  });

  it('the new account goes after the highest existing position', async () => {
    const { client, calls } = makeSupabaseMock({
      users: [USER],
      accounts: [{ data: [{ sort_order: 3 }, { sort_order: 7 }], error: null }, { data: SAVINGS, error: null }],
    });
    const { POST } = await route(client);

    await POST(post({ name: 'Trip', type: 'savings' }));
    const insert = calls.find((c) => c.method === 'insert');
    expect((insert?.args[0] as { sort_order: number }).sort_order).toBe(8);
  });
});
