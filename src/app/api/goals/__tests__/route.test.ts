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
    // Named on its own, so the mobile app (no Reserve screen) can still move
    // money in and out of it (2026-10-27).
    expect(json.reserve).toEqual({ id: 'fund-1', name: 'Property tax fund' });
  });

  it('reserve is null when the household has not started a Reserve Fund', async () => {
    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      accounts: [{
        data: [{ id: 'sav-1', name: 'Disney trip', type: 'savings', goal_target: null, goal_target_date: null, is_sinking_fund: false }],
        error: null,
      }],
      transactions: [{ data: [], error: null }],
      recurring_items: [{ data: [], error: null }],
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const { GET } = await import('../route');
    const json = await (await GET()).json();
    expect(json.reserve).toBeNull();
  });
});

// docs/tickets/goals-get-ignores-read-errors.md — a failed read used to answer
// 200 with no goals ("you have no savings goals" in place of "Phare couldn't
// read your goals"). Each read now answers 500 with its own reason.
describe('GET /api/goals — a failed read is an error, never "no goals"', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  const ok = (data: unknown) => ({ data, error: null });
  const boom = { data: null, error: { message: 'connection reset' } };
  // One savings goal with an active recurring contribution, so every read
  // in the route runs: accounts, transactions, the rule, its tombstones.
  const healthy = () => ({
    users: [ok({ household_id: 'hh1' })],
    accounts: [ok([{ id: 'sav-1', name: 'Disney trip', type: 'savings', goal_target: null, goal_target_date: null, is_sinking_fund: false }])],
    transactions: [ok([])],
    recurring_items: [ok([{ id: 'rule-1', amount: 50, cadence: 'monthly', anchor_date: '2026-11-01', second_day: null, destination_account_id: 'sav-1', effective_from: '2026-11-01' }])],
    recurring_skipped_dates: [ok([])],
    households: [ok({ timezone: 'America/Toronto' })],
  });

  async function run(script: Record<string, Resolution[]>) {
    const { client } = makeSupabaseMock(script);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const { GET } = await import('../route');
    const res = await GET();
    return { status: res.status, json: await res.json() };
  }

  it('the healthy script answers 200 with the goal (control: every read below is reached)', async () => {
    const { status, json } = await run(healthy());
    expect(status).toBe(200);
    expect(json.goals.map((g: { id: string }) => g.id)).toEqual(['sav-1']);
    expect(json.goals[0].recurringContribution.recurringItemId).toBe('rule-1');
  });

  it.each([
    ['accounts', 'accounts'],
    ['transactions', 'transactions'],
    ['recurring_items', 'recurring contributions'],
    ['recurring_skipped_dates', 'skipped contribution dates'],
  ])('a failed %s read answers 500 with the real reason, not an empty list', async (table, what) => {
    const { status, json } = await run({ ...healthy(), [table]: [boom] });
    expect(status).toBe(500);
    expect(json.error).toBe(`Failed to load goals: could not read ${what}: connection reset`);
    expect(json.goals).toBeUndefined();
  });

  it('anything that throws keeps its own reason in the 500, not a bare "Failed to load goals"', async () => {
    // No scripted households row: the mock throws when the timezone is read.
    const { households: _omit, ...script } = healthy();
    void _omit;
    const { status, json } = await run(script);
    expect(status).toBe(500);
    expect(json.error).toBe('Failed to load goals: No scripted response for table "households" call #1');
  });
});
