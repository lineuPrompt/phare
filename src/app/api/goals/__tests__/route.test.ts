import { describe, it, expect, vi, beforeEach } from 'vitest';

// A sinking fund reuses the 'savings' account type (Build 4 Part 2,
// 2026-07-21) — without an explicit exclusion, it would qualify for
// GOAL_ACCOUNT_TYPES and render as a generic goal card, duplicating the
// dashboard's own sinkingFunds display of the exact same account. This test
// proves the exclusion.

type Resolution = { data?: unknown; error?: unknown };

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
    }),
  };

  return { client };
}

vi.mock('@/lib/supabase-server', () => ({
  createClient: vi.fn(),
}));

describe('GET /api/goals — sinking fund accounts never appear as a goal', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('excludes an is_sinking_fund account from the goals list, keeping a real savings goal', async () => {
    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      accounts: [{
        data: [
          { id: 'sav-1',  name: 'Disney trip',        type: 'savings', goal_target: 6000, goal_target_date: '2028-01-01', is_sinking_fund: false },
          { id: 'fund-1', name: 'Property tax fund',  type: 'savings', goal_target: null, goal_target_date: null,          is_sinking_fund: true },
        ],
        error: null,
      }],
      transactions: [{ data: [], error: null }],
      recurring_items: [{ data: [], error: null }],
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { GET } = await import('../route');
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.goals).toHaveLength(1);
    expect(json.goals[0].name).toBe('Disney trip');
  });
});
