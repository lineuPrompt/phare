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

// ---------------------------------------------------------------------------
// Member attribution — expenses are household-level, never the creator
// ---------------------------------------------------------------------------
//
// Founder-reported bug: adding a recurring EXPENSE via the Recurring page
// stamped the creating user's own member_id on the row, which RecurringList
// then rendered as "Canadian Tire — Lineu Prompt Graeff" — expenses have no
// per-expense member concept (same rule save-plan's onboarding path already
// follows for fixed expenses: member_id null). Income keeps the creator's
// own member attribution, unchanged.
describe('POST /api/recurring — member attribution', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a manually-added recurring EXPENSE gets member_id: null, never the creating user', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T12:00:00'));

    const { client, calls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      household_members: [{ data: { id: 'mem-creator' }, error: null }],
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      accounts: [{ data: { id: 'chq-1' }, error: null }],
      recurring_items: [{ data: { id: 'ri-1' }, error: null }],
      transactions: [{ error: null }, { error: null }],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/recurring', {
      method: 'POST',
      body: JSON.stringify({
        description: 'Canadian Tire', amount: 89, type: 'expense', cadence: 'monthly',
        anchorDate: '2026-08-01', categoryId: 'cat-shopping', accountId: 'chq-1',
      }),
    }));
    expect(res.status).toBe(200);

    const insert = calls.find((c) => c.table === 'recurring_items' && c.method === 'insert');
    expect((insert!.args[0] as { member_id: unknown }).member_id).toBeNull();

    // ...and so does every row it materializes — they used to carry the
    // creator (docs/tickets/recurring-post-expense-rows-attributed-to-creator.md).
    const rows = calls.find((c) => c.table === 'transactions' && c.method === 'insert')!.args[0] as { member_id: unknown }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.member_id === null)).toBe(true);
  });

  it('a manually-added recurring INCOME still carries the creating user\'s member_id, unchanged', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T12:00:00'));

    const { client, calls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      household_members: [{ data: { id: 'mem-creator' }, error: null }],
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      accounts: [{ data: { id: 'chq-1' }, error: null }],
      recurring_items: [{ data: { id: 'ri-2' }, error: null }],
      transactions: [{ error: null }, { error: null }],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/recurring', {
      method: 'POST',
      body: JSON.stringify({
        description: 'Paycheque', amount: 2000, type: 'income', cadence: 'monthly',
        anchorDate: '2026-08-01', accountId: 'chq-1',
      }),
    }));
    expect(res.status).toBe(200);

    const insert = calls.find((c) => c.table === 'recurring_items' && c.method === 'insert');
    expect((insert!.args[0] as { member_id: unknown }).member_id).toBe('mem-creator');

    const rows = calls.find((c) => c.table === 'transactions' && c.method === 'insert')!.args[0] as { member_id: unknown }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.member_id === 'mem-creator')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET never answers "no recurring lines" over a failed read.
// ---------------------------------------------------------------------------

describe('GET /api/recurring — failed reads are errors, not empty lists', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function getWith(script: Record<string, Resolution[]>) {
    const { client } = makeSupabaseMock(script);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const { GET } = await import('../route');
    return GET();
  }

  const CTX = {
    users: [{ data: { household_id: 'hh1' }, error: null }],
    household_members: [{ data: { id: 'mem-1' }, error: null }],
  };

  it.each([
    ['recurring_items', { recurring_items: [{ data: null, error: { message: 'canceling statement due to statement timeout' } }], accounts: [{ data: [], error: null }], categories: [{ data: [], error: null }] }],
    ['accounts', { recurring_items: [{ data: [], error: null }], accounts: [{ data: null, error: { message: 'canceling statement due to statement timeout' } }], categories: [{ data: [], error: null }] }],
    ['categories', { recurring_items: [{ data: [], error: null }], accounts: [{ data: [], error: null }], categories: [{ data: null, error: { message: 'canceling statement due to statement timeout' } }] }],
  ])('a failed %s read is a 500 with the reason', async (_table, script) => {
    const res = await getWith({ ...CTX, ...script });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to load recurring items: canceling statement due to statement timeout');
    expect(json.items).toBeUndefined();
  });

  it('a successful read lists the rules, spending accounts, goal accounts and categories', async () => {
    const res = await getWith({
      ...CTX,
      recurring_items: [{ data: [{ id: 'ri-1', description: 'Rent' }], error: null }],
      accounts: [{ data: [{ id: 'chq', name: 'Chequing', type: 'chequing' }, { id: 'sav', name: 'Trip', type: 'savings' }], error: null }],
      categories: [{ data: [{ id: 'cat-1', name: 'Housing' }], error: null }],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: [{ id: 'ri-1', description: 'Rent' }],
      accounts: [{ id: 'chq', name: 'Chequing', type: 'chequing' }],
      goalAccounts: [{ id: 'sav', name: 'Trip', type: 'savings' }],
      categories: [{ id: 'cat-1', name: 'Housing' }],
    });
  });
});
