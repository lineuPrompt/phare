import { describe, it, expect, vi, beforeEach } from 'vitest';
import { categoriesWriterTables } from '../../../../test/categoriesWriterDouble';

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
const calls: Call[] = [];

function makeSupabaseMock(script: Record<string, Resolution[]>, userId: string | null) {
  const cursors: Record<string, number> = {};
  function entry(table: string, method: string, args: unknown[]) {
    calls.push({ table, method, args });
    const idx = cursors[table] ?? 0;
    cursors[table] = idx + 1;
    const list = script[table] ?? [];
    if (idx >= list.length) throw new Error(`No scripted response for table "${table}" call #${idx + 1}`);
    return makeResultChain(list[idx]);
  }
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }) },
    from: (table: string) => ({
      select: (...args: unknown[]) => entry(table, 'select', args),
      insert: (...args: unknown[]) => entry(table, 'insert', args),
    }),
  };
}

vi.mock('@/lib/supabase-server', () => ({ createClient: vi.fn() }));

// The Pro gate itself is tested in proGate's own suite; here it is a switch.
let proAllowed = true;
vi.mock('@/lib/proGate', async () => {
  const { NextResponse } = await import('next/server');
  return {
    requirePro: async () => proAllowed
      ? { allowed: true }
      : { allowed: false, response: NextResponse.json({ code: 'pro_required' }, { status: 403 }) },
  };
});

async function getCategories() {
  const { GET } = await import('../route');
  return GET();
}

describe('GET /api/categories', () => {
  beforeEach(() => { vi.resetModules(); });

  it('401s when not authenticated', async () => {
    const client = makeSupabaseMock({}, null);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await getCategories();
    expect(res.status).toBe(401);
  });

  it('returns the household expense categories, household-scoped', async () => {
    const client = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' } }],
      categories: [{ data: [{ id: 'c1', name: 'Groceries' }, { id: 'c2', name: 'Housing' }] }],
    }, 'user-1');
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await getCategories();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ categories: [{ id: 'c1', name: 'Groceries' }, { id: 'c2', name: 'Housing' }] });
  });

  it('returns an empty array rather than erroring when a household has no categories', async () => {
    const client = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' } }],
      categories: [{ data: [] }],
    }, 'user-1');
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await getCategories();
    const json = await res.json();
    expect(json).toEqual({ categories: [] });
  });
});

// ---------------------------------------------------------------------------
// POST — creating a category is Pro, and the write goes through the service
// role (launch plan 1.6): members can only read categories, so the gate is the
// only way in.
// ---------------------------------------------------------------------------

async function postCategory(body: unknown) {
  const { POST } = await import('../route');
  return POST(new Request('http://localhost/api/categories', { method: 'POST', body: JSON.stringify(body) }));
}

describe('POST /api/categories', () => {
  beforeEach(() => {
    vi.resetModules();
    calls.length = 0;
    proAllowed = true;
  });

  it('a Pro household: the category is written through the service role, in its own household', async () => {
    const client = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' } }],
      categories: [{ data: { id: 'c9', name: 'Pets', type: 'expense' } }],
    }, 'user-1');
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await postCategory({ name: '  Pets ' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ category: { id: 'c9', name: 'Pets', type: 'expense' } });

    expect(categoriesWriterTables).toEqual(['categories']);
    const inserts = calls.filter((c) => c.table === 'categories' && c.method === 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].args[0]).toEqual({ household_id: 'hh1', name: 'Pets', type: 'expense' });
  });

  it('a free household: 403 pro_required, and nothing is written', async () => {
    proAllowed = false;
    const client = makeSupabaseMock({ users: [{ data: { household_id: 'hh1' } }] }, 'user-1');
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await postCategory({ name: 'Pets' });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('pro_required');
    expect(categoriesWriterTables).toEqual([]);
    expect(calls.some((c) => c.table === 'categories')).toBe(false);
  });
});
