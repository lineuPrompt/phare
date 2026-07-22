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
      update: () => entry(table),
    }),
  };

  return { client };
}

vi.mock('@/lib/supabase-server', () => ({
  createClient: vi.fn(),
}));

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/sinking-funds/sf-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/sinking-funds/[id]', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('401s when not authenticated', async () => {
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });

    const { PATCH } = await import('../route');
    const res = await PATCH(makeRequest({ monthlyProvision: 100 }), { params: Promise.resolve({ id: 'sf-1' }) });
    expect(res.status).toBe(401);
  });

  it('404s when the fund does not belong to this household', async () => {
    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      sinking_funds: [{ data: null, error: null }],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { PATCH } = await import('../route');
    const res = await PATCH(makeRequest({ monthlyProvision: 100 }), { params: Promise.resolve({ id: 'sf-1' }) });
    expect(res.status).toBe(404);
  });

  it('400s with nothing to update when the body has no editable fields', async () => {
    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      sinking_funds: [{ data: { id: 'sf-1' }, error: null }],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { PATCH } = await import('../route');
    const res = await PATCH(makeRequest({}), { params: Promise.resolve({ id: 'sf-1' }) });
    expect(res.status).toBe(400);
  });

  it('400s on a non-positive monthlyProvision', async () => {
    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      sinking_funds: [{ data: { id: 'sf-1' }, error: null }],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { PATCH } = await import('../route');
    const res = await PATCH(makeRequest({ monthlyProvision: 0 }), { params: Promise.resolve({ id: 'sf-1' }) });
    expect(res.status).toBe(400);
  });

  it('edits the amount and returns the recalculated total across active allocations only', async () => {
    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      sinking_funds: [
        { data: { id: 'sf-1' }, error: null }, // load-current
        { data: null, error: null },           // update
        {
          data: [
            { monthly_provision: 280, active: true },  // just-edited Property tax
            { monthly_provision: 258, active: true },   // Christmas
            { monthly_provision: 150, active: false },  // excluded Car registration
          ],
          error: null,
        },
      ],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { PATCH } = await import('../route');
    const res = await PATCH(
      makeRequest({ annualAmount: 3360, monthlyProvision: 280 }),
      { params: Promise.resolve({ id: 'sf-1' }) }
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.updated).toBe(true);
    expect(json.totalMonthlyProvision).toBe(538); // 280 + 258, car registration excluded
  });

  it('excluding an allocation drops it from the recalculated total', async () => {
    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      sinking_funds: [
        { data: { id: 'sf-2' }, error: null },
        { data: null, error: null },
        {
          data: [
            { monthly_provision: 300, active: true },
            { monthly_provision: 258, active: false }, // just-excluded Christmas
          ],
          error: null,
        },
      ],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { PATCH } = await import('../route');
    const res = await PATCH(makeRequest({ active: false }), { params: Promise.resolve({ id: 'sf-2' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.totalMonthlyProvision).toBe(300);
  });

  it('re-including a previously excluded allocation restores it to the total', async () => {
    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      sinking_funds: [
        { data: { id: 'sf-2' }, error: null },
        { data: null, error: null },
        {
          data: [
            { monthly_provision: 300, active: true },
            { monthly_provision: 258, active: true }, // just-re-included Christmas
          ],
          error: null,
        },
      ],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { PATCH } = await import('../route');
    const res = await PATCH(makeRequest({ active: true }), { params: Promise.resolve({ id: 'sf-2' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.totalMonthlyProvision).toBe(558);
  });
});
