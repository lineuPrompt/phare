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

function makeSupabaseMock(script: Record<string, Resolution[]>, userId: string | null) {
  const cursors: Record<string, number> = {};
  function entry(table: string, args: unknown[]) {
    void args;
    const idx = cursors[table] ?? 0;
    cursors[table] = idx + 1;
    const list = script[table] ?? [];
    if (idx >= list.length) throw new Error(`No scripted response for table "${table}" call #${idx + 1}`);
    return makeResultChain(list[idx]);
  }
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }) },
    from: (table: string) => ({ select: (...args: unknown[]) => entry(table, args) }),
  };
}

vi.mock('@/lib/supabase-server', () => ({ createClient: vi.fn() }));

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
