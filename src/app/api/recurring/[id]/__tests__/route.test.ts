import { describe, it, expect, vi, beforeEach } from 'vitest';
import { businessToday, materializeFromMonthStart } from '@/lib/dateHelpers';

// ---------------------------------------------------------------------------
// Verifies the existing PATCH memberId path — already generic across income
// and expense recurring items — actually works for an expense item. Same
// mock-Supabase approach as src/app/api/save-plan/__tests__/route.test.ts:
// each table gets a scripted queue of responses consumed in call order,
// matching the route's real call sequence (traced top to bottom).
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

describe('PATCH /api/recurring/[id] — member reassignment works for expenses', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('assigns a specific household member to an expense item, and the new member_id flows into re-materialized transactions', async () => {
    const { client, calls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      recurring_items: [
        {
          // current row — household-level expense (member_id null), monthly, already anchored
          data: {
            id: 'ri-1', household_id: 'hh1', member_id: null, description: 'Mortgage', amount: 1500,
            type: 'expense', cadence: 'monthly', anchor_date: '2026-07-01', second_day: null,
            category_id: 'cat-housing', account_id: 'chq-1',
          },
          error: null,
        },
        {
          // post-update row
          data: { id: 'ri-1', member_id: 'mem-julia', type: 'expense' },
          error: null,
        },
      ],
      accounts: [
        { data: { id: 'chq-1' }, error: null },
      ],
      household_members: [
        { data: { id: 'mem-julia' }, error: null }, // the reassigned member belongs to this household
      ],
      transactions: [
        { error: null }, // delete this-month-onward rows
        { error: null }, // insert re-materialized rows
      ],
      recurring_skipped_dates: [
        { data: [], error: null }, // no detached occurrences for this rule
      ],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { PATCH } = await import('../route');

    const res = await PATCH(
      new Request('http://localhost/api/recurring/ri-1', {
        method: 'PATCH',
        body: JSON.stringify({ memberId: 'mem-julia' }),
      }),
      { params: Promise.resolve({ id: 'ri-1' }) }
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.updated).toBe(true);

    // The rule update itself carries the new member_id.
    const ruleUpdates = calls.filter((c) => c.table === 'recurring_items' && c.method === 'update');
    expect(ruleUpdates).toHaveLength(1);
    expect((ruleUpdates[0].args[0] as { member_id: string }).member_id).toBe('mem-julia');

    // Re-materialized transactions carry the new member, not null and not
    // some other id — this is what makes the name show up in the ledger.
    const txnInserts = calls.filter((c) => c.table === 'transactions' && c.method === 'insert');
    expect(txnInserts).toHaveLength(1);
    const rows = txnInserts[0].args[0] as { member_id: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.member_id === 'mem-julia')).toBe(true);
  });
});

describe('PATCH /api/recurring/[id] — Part A3 re-materialization respects detached-occurrence tombstones', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does not regenerate a date the household already detached from this rule (no revert, no duplicate)', async () => {
    // Mirrors the route's own computation exactly, so this test stays
    // correct regardless of what "today" is when it runs.
    const todayStr = businessToday('America/Toronto');
    const anchorDate = '2020-01-01';
    const rawDates = materializeFromMonthStart({ cadence: 'monthly', anchorDate, secondDay: null }, todayStr, 12);
    const tombstonedDate = rawDates[0];
    const remainingDates = rawDates.slice(1);
    expect(remainingDates.length).toBeGreaterThan(0); // sanity: the fixture actually exercises the filter

    const { client, calls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      recurring_items: [
        {
          data: {
            id: 'ri-phone', household_id: 'hh1', member_id: null, description: 'Phone bill', amount: 60,
            type: 'expense', cadence: 'monthly', anchor_date: anchorDate, second_day: null,
            category_id: 'cat-utilities', account_id: 'chq-1',
          },
          error: null,
        },
        { data: { id: 'ri-phone', member_id: null, type: 'expense' }, error: null },
      ],
      accounts: [{ data: { id: 'chq-1' }, error: null }],
      transactions: [
        { error: null }, // delete this-month-onward rows
        { error: null }, // insert re-materialized rows
      ],
      recurring_skipped_dates: [
        // The household edited/deleted the occurrence originally scheduled
        // for rawDates[0] — this rule must never regenerate it.
        { data: [{ date: tombstonedDate }], error: null },
      ],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { PATCH } = await import('../route');
    const res = await PATCH(
      new Request('http://localhost/api/recurring/ri-phone', { method: 'PATCH', body: JSON.stringify({}) }),
      { params: Promise.resolve({ id: 'ri-phone' }) }
    );
    expect(res.status).toBe(200);

    const txnInserts = calls.filter((c) => c.table === 'transactions' && c.method === 'insert');
    expect(txnInserts).toHaveLength(1);
    const insertedDates = (txnInserts[0].args[0] as { date: string }[]).map((r) => r.date);

    // The tombstoned date never comes back...
    expect(insertedDates).not.toContain(tombstonedDate);
    // ...and every other real occurrence still materializes, exactly once —
    // this is the "no revert, no duplicate" guarantee.
    expect(insertedDates).toEqual(remainingDates);
  });

  it('a rule with no detached occurrences materializes every date, unaffected', async () => {
    const todayStr = businessToday('America/Toronto');
    const anchorDate = '2020-01-01';
    const rawDates = materializeFromMonthStart({ cadence: 'monthly', anchorDate, secondDay: null }, todayStr, 12);

    const { client, calls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      recurring_items: [
        {
          data: {
            id: 'ri-rent', household_id: 'hh1', member_id: null, description: 'Rent', amount: 2000,
            type: 'expense', cadence: 'monthly', anchor_date: anchorDate, second_day: null,
            category_id: 'cat-housing', account_id: 'chq-1',
          },
          error: null,
        },
        { data: { id: 'ri-rent', member_id: null, type: 'expense' }, error: null },
      ],
      accounts: [{ data: { id: 'chq-1' }, error: null }],
      transactions: [{ error: null }, { error: null }],
      recurring_skipped_dates: [{ data: [], error: null }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { PATCH } = await import('../route');
    await PATCH(
      new Request('http://localhost/api/recurring/ri-rent', { method: 'PATCH', body: JSON.stringify({}) }),
      { params: Promise.resolve({ id: 'ri-rent' }) }
    );

    const txnInserts = calls.filter((c) => c.table === 'transactions' && c.method === 'insert');
    const insertedDates = (txnInserts[0].args[0] as { date: string }[]).map((r) => r.date);
    expect(insertedDates).toEqual(rawDates);
  });
});
