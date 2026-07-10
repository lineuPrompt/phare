import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Same mock-Supabase approach as src/app/api/save-plan/__tests__/route.test.ts.
// ---------------------------------------------------------------------------

type Resolution = { data?: unknown; error?: unknown; count?: number };

function makeResultChain(resolution: Resolution) {
  const handler: ProxyHandler<object> = {
    get(_, prop) {
      if (prop === 'then') {
        return (resolve: (v: Resolution) => unknown, reject?: (v: unknown) => unknown) =>
          Promise.resolve(resolution).then(resolve, reject);
      }
      if (prop === 'catch') {
        return (reject: (v: unknown) => unknown) => Promise.resolve(resolution).catch(reject);
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
      update: (...args: unknown[]) => entry(table, 'update', args),
    }),
  };

  return { client, calls };
}

vi.mock('@/lib/supabase-server', () => ({
  createClient: vi.fn(),
}));

describe('POST /api/household/members/quick-add', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('creates a name-only member row — no user_id, no email, no invite fields', async () => {
    const { client, calls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1', role: 'member' }, error: null }],
      household_members: [{ data: { id: 'mem-julia', name: 'Julia' }, error: null }],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/household/members/quick-add', {
      method: 'POST',
      body: JSON.stringify({ name: 'Julia' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.member).toEqual({ id: 'mem-julia', name: 'Julia' });

    const inserts = calls.filter((c) => c.table === 'household_members' && c.method === 'insert');
    expect(inserts).toHaveLength(1);
    // Exactly household_id + name — no email, no user_id, nothing invite-shaped.
    expect(inserts[0].args[0]).toEqual({ household_id: 'hh1', name: 'Julia' });
  });

  it('rejects a blank name', async () => {
    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1', role: 'member' }, error: null }],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/household/members/quick-add', {
      method: 'POST',
      body: JSON.stringify({ name: '   ' }),
    }));
    expect(res.status).toBe(400);
  });

  it('a non-owner member role can still quick-add — no owner gate, unlike provisioning', async () => {
    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1', role: 'member' }, error: null }],
      household_members: [{ data: { id: 'mem-sam', name: 'Sam' }, error: null }],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/household/members/quick-add', {
      method: 'POST',
      body: JSON.stringify({ name: 'Sam' }),
    }));
    expect(res.status).toBe(200);
  });
});
