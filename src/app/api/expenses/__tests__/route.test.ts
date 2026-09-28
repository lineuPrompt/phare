import { describe, it, expect, vi, beforeEach } from 'vitest';

// Founder-reported bug: adding an expense stamped the creating user's own
// member_id on the row, later rendered as a personal attribution
// ("Canadian Tire — Lineu Prompt Graeff") even though expenses are
// household-level, not personal — same rule save-plan's onboarding path
// already follows for fixed expenses (member_id null). Income keeps member
// attribution, unchanged.

type Resolution = { data?: unknown; error?: unknown; count?: number };
type Call = { table: string; method: string; args: unknown[]; chain: [string, unknown[]][] };

// `chain` records every method called after .select()/.insert() — .eq(),
// .maybeSingle() and so on — so a test can prove a lookup was scoped by
// household_id rather than only that it happened.
function makeResultChain(resolution: Resolution, chain: [string, unknown[]][] = []) {
  const handler: ProxyHandler<object> = {
    get(_, prop) {
      if (prop === 'then') {
        return (resolve: (v: Resolution) => unknown, reject?: (v: unknown) => unknown) =>
          Promise.resolve(resolution).then(resolve, reject);
      }
      if (prop === 'catch') {
        return (reject: (v: unknown) => unknown) => Promise.resolve(resolution).catch(reject);
      }
      return (...args: unknown[]) => {
        chain.push([String(prop), args]);
        return makeResultChain(resolution, chain);
      };
    },
  };
  return new Proxy({}, handler);
}

function makeSupabaseMock(script: Record<string, Resolution[]>) {
  const cursors: Record<string, number> = {};
  const calls: Call[] = [];

  function entry(table: string, method: string, args: unknown[]) {
    const call: Call = { table, method, args, chain: [] };
    calls.push(call);
    const idx = cursors[table] ?? 0;
    cursors[table] = idx + 1;
    const list = script[table] ?? [];
    if (idx >= list.length) {
      // events (created_first_expense) is fire-and-forget and shields its
      // own errors — safe to leave unscripted.
      if (table === 'events') return makeResultChain({ data: null, error: null, count: 0 }, call.chain);
      throw new Error(`No scripted response for table "${table}" call #${idx + 1} (method: ${method})`);
    }
    return makeResultChain(list[idx], call.chain);
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

// Real UUIDs: the route refuses a malformed id before it reaches the database.
const CHQ = 'c0000000-0000-4000-8000-000000000001';
const CAT_SHOPPING = 'ca000000-0000-4000-8000-000000000001';
const CAT_HEALTH = 'ca000000-0000-4000-8000-000000000002';

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
      accounts: [{ data: { id: CHQ }, error: null }],
      categories: [{ data: { id: 'x' }, error: null }],
      transactions: [{ error: null }],
      events: [{ count: 0, error: null }],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/expenses', {
      method: 'POST',
      body: JSON.stringify({
        date: '2026-07-20', description: 'Canadian Tire', categoryId: CAT_SHOPPING,
        amount: 89, accountId: CHQ, type: 'expense',
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
      accounts: [{ data: { id: CHQ }, error: null }],
      transactions: [{ error: null }],
      events: [{ count: 0, error: null }],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/expenses', {
      method: 'POST',
      body: JSON.stringify({
        date: '2026-07-20', description: 'Freelance gig', amount: 400, accountId: CHQ, type: 'income',
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
      accounts: [{ data: { id: CHQ }, error: null }],
      categories: [{ data: { id: 'x' }, error: null }],
      transactions: [{ error: null }],
      events: [{ count: 0, error: null }],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/expenses', {
      method: 'POST',
      body: JSON.stringify({
        date: '2026-07-20', description: 'Gym membership', categoryId: CAT_HEALTH,
        amount: 40, accountId: CHQ, type: 'expense', repeat: 'monthly',
      }),
    }));
    expect(res.status).toBe(200);

    const insert = calls.find((c) => c.table === 'transactions' && c.method === 'insert');
    const rows = insert!.args[0] as { member_id: unknown }[];
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every((r) => r.member_id === null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Validation and ownership (2026-09-27). The route used to trust its body;
// these run the real route over the recording mock, so each guard is shown
// refusing AND shown writing nothing.
// ---------------------------------------------------------------------------

const VALID_BODY = {
  date: '2026-09-27', description: 'Groceries', categoryId: CAT_SHOPPING,
  amount: 42.1, accountId: CHQ, type: 'expense',
};

async function post(script: Record<string, Resolution[]>, body: unknown, rawBody?: string) {
  const { client, calls } = makeSupabaseMock(script);
  const { createClient } = await import('@/lib/supabase-server');
  (createClient as ReturnType<typeof vi.fn>).mockReset();
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  const { POST } = await import('../route');
  const res = await POST(new Request('http://localhost/api/expenses', {
    method: 'POST',
    body: rawBody ?? JSON.stringify(body),
  }));
  const json = await res.json();
  return { res, json, calls, createClient: createClient as ReturnType<typeof vi.fn> };
}

const SIGNED_IN = {
  users: [{ data: { household_id: 'hh1' }, error: null }],
  household_members: [{ data: { id: 'mem-creator' }, error: null }],
};

function inserted(calls: Call[]) {
  return calls.filter((c) => c.table === 'transactions' && c.method === 'insert');
}

describe('POST /api/expenses — the body is refused before the database is touched', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it.each([
    ['a negative amount', { ...VALID_BODY, amount: -42.1 }, 'INVALID_AMOUNT'],
    ['a zero amount', { ...VALID_BODY, amount: 0 }, 'INVALID_AMOUNT'],
    ['an impossible date', { ...VALID_BODY, date: '2026-02-31' }, 'INVALID_DATE'],
    ['an oversized description', { ...VALID_BODY, description: 'x'.repeat(201) }, 'DESCRIPTION_TOO_LONG'],
    ['100,000 installments', { ...VALID_BODY, repeat: 'installments', installments: 100000 }, 'INVALID_INSTALLMENTS'],
    ['a malformed account id', { ...VALID_BODY, accountId: 'chq-1' }, 'ACCOUNT_NOT_FOUND'],
  ])('%s → 400 %s, and no client is even created', async (_label, body, code) => {
    const { res, json, calls, createClient } = await post({}, body);
    expect(res.status).toBe(400);
    expect(json).toEqual({ code, error: expect.any(String) });
    expect(createClient).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('refuses invalid JSON with a code', async () => {
    const { res, json } = await post({}, null, '{not json');
    expect(res.status).toBe(400);
    expect(json.code).toBe('INVALID_JSON');
  });
});

describe('POST /api/expenses — ownership of the account and the category', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("refuses an account that is not in the caller's household, and writes nothing", async () => {
    const { res, json, calls } = await post(
      { ...SIGNED_IN, accounts: [{ data: null, error: null }] },
      VALID_BODY
    );
    expect(res.status).toBe(400);
    expect(json.code).toBe('ACCOUNT_NOT_FOUND');
    expect(inserted(calls)).toEqual([]);
  });

  it("looks the account up by id AND by the caller's household", async () => {
    const { calls } = await post(
      { ...SIGNED_IN, accounts: [{ data: null, error: null }] },
      VALID_BODY
    );
    const lookup = calls.find((c) => c.table === 'accounts');
    expect(lookup!.chain).toContainEqual(['eq', ['id', CHQ]]);
    expect(lookup!.chain).toContainEqual(['eq', ['household_id', 'hh1']]);
  });

  it("refuses a category that is not in the caller's household, and writes nothing", async () => {
    const { res, json, calls } = await post(
      { ...SIGNED_IN, accounts: [{ data: { id: CHQ }, error: null }], categories: [{ data: null, error: null }] },
      VALID_BODY
    );
    expect(res.status).toBe(400);
    expect(json.code).toBe('CATEGORY_NOT_FOUND');
    expect(inserted(calls)).toEqual([]);
  });

  it("looks the category up by id AND by the caller's household", async () => {
    const { calls } = await post(
      { ...SIGNED_IN, accounts: [{ data: { id: CHQ }, error: null }], categories: [{ data: null, error: null }] },
      VALID_BODY
    );
    const lookup = calls.find((c) => c.table === 'categories');
    expect(lookup!.chain).toContainEqual(['eq', ['id', CAT_SHOPPING]]);
    expect(lookup!.chain).toContainEqual(['eq', ['household_id', 'hh1']]);
  });

  it('reports a failed account lookup as a failure, not as "not found"', async () => {
    const { res, json, calls } = await post(
      { ...SIGNED_IN, accounts: [{ data: null, error: { message: 'connection reset' } }] },
      VALID_BODY
    );
    expect(res.status).toBe(500);
    expect(json.code).toBe('LOOKUP_FAILED');
    expect(inserted(calls)).toEqual([]);
  });

  it('reports a failed category lookup as a failure, not as "not found"', async () => {
    const { res, json, calls } = await post(
      {
        ...SIGNED_IN,
        accounts: [{ data: { id: CHQ }, error: null }],
        categories: [{ data: null, error: { message: 'connection reset' } }],
      },
      VALID_BODY
    );
    expect(res.status).toBe(500);
    expect(json.code).toBe('LOOKUP_FAILED');
    expect(inserted(calls)).toEqual([]);
  });

  it('writes the owned account and category onto the row', async () => {
    const { res, calls } = await post(
      {
        ...SIGNED_IN,
        accounts: [{ data: { id: CHQ }, error: null }],
        categories: [{ data: { id: CAT_SHOPPING }, error: null }],
        transactions: [{ error: null }],
      },
      VALID_BODY
    );
    expect(res.status).toBe(200);
    const rows = inserted(calls)[0].args[0] as Record<string, unknown>[];
    expect(rows).toEqual([expect.objectContaining({
      household_id: 'hh1', account_id: CHQ, category_id: CAT_SHOPPING,
      amount: 42.1, description: 'Groceries', date: '2026-09-27', type: 'expense',
      source: 'manual', member_id: null,
    })]);
  });

  it("with no account sent, falls back to the household's chequing and checks no other account", async () => {
    const { accountId: _omit, ...noAccount } = VALID_BODY;
    const { res, calls } = await post(
      {
        ...SIGNED_IN,
        categories: [{ data: { id: CAT_SHOPPING }, error: null }],
        accounts: [{ data: { id: CHQ }, error: null }],
        transactions: [{ error: null }],
      },
      noAccount
    );
    expect(res.status).toBe(200);
    const accountCalls = calls.filter((c) => c.table === 'accounts');
    expect(accountCalls).toHaveLength(1);
    expect(accountCalls[0].chain).toContainEqual(['eq', ['type', 'chequing']]);
    expect(accountCalls[0].chain).toContainEqual(['eq', ['household_id', 'hh1']]);
    const rows = inserted(calls)[0].args[0] as { account_id: string }[];
    expect(rows[0].account_id).toBe(CHQ);
  });
});

describe('POST /api/expenses — installments and failures', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('three installments are three labelled rows', async () => {
    const { res, calls } = await post(
      {
        ...SIGNED_IN,
        accounts: [{ data: { id: CHQ }, error: null }],
        categories: [{ data: { id: CAT_SHOPPING }, error: null }],
        transactions: [{ error: null }],
      },
      { ...VALID_BODY, repeat: 'installments', installments: 3 }
    );
    expect(res.status).toBe(200);
    const rows = inserted(calls)[0].args[0] as { installment_label: string; date: string }[];
    expect(rows.map((r) => r.installment_label)).toEqual(['1/3', '2/3', '3/3']);
    expect(rows.map((r) => r.date)).toEqual(['2026-09-27', '2026-10-27', '2026-11-27']);
  });

  it('a signed-out caller gets 401 with a code', async () => {
    const { client } = makeSupabaseMock({});
    (client.auth as { getUser: () => Promise<unknown> }).getUser = async () => ({ data: { user: null }, error: null });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/expenses', {
      method: 'POST', body: JSON.stringify(VALID_BODY),
    }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: 'NOT_AUTHENTICATED', error: expect.any(String) });
  });

  it('an insert failure is a 500 with a code, not a success', async () => {
    const { res, json } = await post(
      {
        ...SIGNED_IN,
        accounts: [{ data: { id: CHQ }, error: null }],
        categories: [{ data: { id: CAT_SHOPPING }, error: null }],
        transactions: [{ error: { message: 'violates check constraint' } }],
      },
      VALID_BODY
    );
    expect(res.status).toBe(500);
    expect(json).toEqual({ code: 'SAVE_FAILED', error: expect.any(String) });
  });
});
