import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatLocalMonth } from '@/lib/dateHelpers';

// ---------------------------------------------------------------------------
// Regression test for the reset-then-onboard defect: a household with ZERO
// accounts (e.g. right after scripts/reset-household.sql, or — before that
// script preserved chequing — any household that lost its chequing account)
// must still be able to save a plan. save-plan self-heals a missing
// chequing account via ensureChequingAccount instead of hard-failing.
//
// This mocks the Supabase client save-plan/route.ts receives from
// createClient(). Each table gets a scripted queue of responses, consumed
// in call order — the sequence below mirrors route.ts's actual call order
// for this exact scenario (traced by reading the route top to bottom).
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
      // Any chained call (eq, single, maybeSingle, limit, order, gte, in, not, ...)
      // returns the same resolved chain — the mock doesn't model real filtering,
      // only "which call number is this for this table".
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

const SEED_CATEGORY_NAMES = [
  'Housing', 'Transportation', 'Restaurants', 'Groceries & Pharmacy',
  'Utilities & Subscriptions', 'Childcare', 'Shopping',
  'Health & Personal', 'Installments', 'Unexpected',
];

describe('POST /api/save-plan — reset-then-onboard regression', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('a household with zero accounts saves successfully; chequing is created exactly once and used on every materialized transaction', async () => {
    const currentMonth = formatLocalMonth(new Date());
    const anchorDate = `${currentMonth}-01`;

    const { client, calls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      household_members: [
        { data: { id: 'mem-1' }, error: null }, // the onboarding user's own member row
        { data: [], error: null },              // allMembers
      ],
      accounts: [
        { data: [], error: null },              // zero accounts on this household
        { data: null, error: null },            // ensureChequingAccount: no existing chequing
        { data: { id: 'chq-new' }, error: null }, // ensureChequingAccount: created
      ],
      recurring_items: [
        { count: 0, error: null },              // prior-data guard count
        { data: [], error: null },              // prior provenanced recurring_items (none)
        {
          data: [{
            id: 'ri-1', description: 'Rent', amount: 1200, type: 'expense', cadence: 'monthly',
            anchor_date: anchorDate, second_day: null, category_id: 'cat-housing',
            account_id: 'chq-new', member_id: 'mem-1',
          }],
          error: null,
        },
      ],
      budgets: [
        { count: 0, error: null },
        { error: null }, // unconditional delete
      ],
      sinking_funds: [
        { count: 0, error: null },
        { error: null }, // unconditional delete
      ],
      file_imports: [{ data: { id: 'imp-1' }, error: null }],
      categories: [
        { data: SEED_CATEGORY_NAMES.map((name) => ({ name })), error: null }, // already seeded (reset preserves categories)
        { data: SEED_CATEGORY_NAMES.map((name) => ({ id: `cat-${name.toLowerCase()}`, name })), error: null },
      ],
      transactions: [
        { error: null }, // materialize cleanup delete for ri-1
        { error: null }, // materialize insert
      ],
      conversations: [{ error: null }],
      events: [{ error: null }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');

    const body = {
      plan: {
        monthlyBudget: {
          categories: [
            { name: 'Rent', budgeted: 1200, type: 'expense', isFixed: true, seedCategory: 'Housing' },
          ],
        },
        sinkingFunds: [],
        goals: [],
        topRecommendation: 'Keep it up.',
      },
      reviewText: 'Looking good.',
      locale: 'en',
      cardNames: [],
      fileMeta: null,
    };

    const res = await POST(new Request('http://localhost/api/save-plan', {
      method: 'POST',
      body: JSON.stringify(body),
    }));
    const json = await res.json();

    // The core regression: this used to be a hard 400 ("A chequing account
    // is required before saving a plan"). It must now succeed.
    expect(res.status).toBe(200);
    expect(json.saved).toBe(true);

    // Chequing was created exactly once.
    const accountInserts = calls.filter((c) => c.table === 'accounts' && c.method === 'insert');
    expect(accountInserts).toHaveLength(1);
    expect(accountInserts[0].args[0]).toEqual({ household_id: 'hh1', name: 'Chequing', type: 'chequing' });

    // Every materialized transaction is attributed to the newly created
    // chequing account — not left null, not attributed to some other id.
    const transactionInserts = calls.filter((c) => c.table === 'transactions' && c.method === 'insert');
    expect(transactionInserts).toHaveLength(1);
    const txnRows = transactionInserts[0].args[0] as { account_id: string }[];
    expect(txnRows.length).toBeGreaterThan(0);
    expect(txnRows.every((r) => r.account_id === 'chq-new')).toBe(true);
  });
});

describe('POST /api/save-plan — expense member attribution', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('an imported expense with no member column defaults to household-level (member_id null) and never counts as unmatched, while an unresolved income name still warns', async () => {
    const currentMonth = formatLocalMonth(new Date());
    const anchorDate = `${currentMonth}-01`;

    const { client, calls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      household_members: [
        { data: { id: 'mem-1' }, error: null }, // onboarding user's own member row
        { data: [{ id: 'mem-1', name: 'Lineu Prompt Graeff' }], error: null }, // allMembers — no "Marc"
      ],
      accounts: [
        { data: [{ id: 'chq-1', type: 'chequing', name: 'Chequing', file_import_id: null }], error: null },
      ],
      recurring_items: [
        { count: 0, error: null },
        { data: [], error: null },
        {
          data: [
            {
              id: 'ri-inc', description: 'Salary', amount: 2500, type: 'income', cadence: 'biweekly',
              anchor_date: null, second_day: null, category_id: null, account_id: 'chq-1', member_id: 'mem-1',
            },
            {
              id: 'ri-exp', description: 'Mortgage', amount: 1500, type: 'expense', cadence: 'monthly',
              anchor_date: anchorDate, second_day: null, category_id: 'cat-housing', account_id: 'chq-1', member_id: null,
            },
          ],
          error: null,
        },
      ],
      budgets: [
        { count: 0, error: null },
        { error: null },
      ],
      sinking_funds: [
        { count: 0, error: null },
        { error: null },
      ],
      file_imports: [{ data: { id: 'imp-1' }, error: null }],
      categories: [
        { data: SEED_CATEGORY_NAMES.map((name) => ({ name })), error: null },
        { data: SEED_CATEGORY_NAMES.map((name) => ({ id: `cat-${name.toLowerCase()}`, name })), error: null },
      ],
      transactions: [
        { error: null }, // materialize cleanup for ri-exp (the only anchored item)
        { error: null }, // materialize insert for ri-exp
      ],
      conversations: [{ error: null }],
      events: [{ error: null }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');

    const body = {
      plan: {
        monthlyBudget: {
          categories: [
            { name: 'Salary', budgeted: 5416.67, type: 'income', rawAmount: 2500, frequency: 'biweekly', member: 'Marc' },
            { name: 'Mortgage', budgeted: 1500, type: 'expense', isFixed: true, seedCategory: 'Housing' },
          ],
        },
        sinkingFunds: [],
        goals: [],
        topRecommendation: 'Keep it up.',
      },
      reviewText: 'Looking good.',
      locale: 'en',
      cardNames: [],
      fileMeta: null,
    };

    const res = await POST(new Request('http://localhost/api/save-plan', {
      method: 'POST',
      body: JSON.stringify(body),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);

    // The actual INSERT payload sent to recurring_items — not the mocked
    // return value — is what proves the real behaviour.
    const recurringInserts = calls.filter((c) => c.table === 'recurring_items' && c.method === 'insert');
    expect(recurringInserts).toHaveLength(1);
    const insertedRows = recurringInserts[0].args[0] as { description: string; member_id: string | null }[];
    const mortgageRow = insertedRows.find((r) => r.description === 'Mortgage')!;
    const salaryRow = insertedRows.find((r) => r.description === 'Salary')!;

    // The expense defaults to household-level — a default, not a failed match.
    expect(mortgageRow.member_id).toBeNull();
    // Income's unresolved name still falls back to the uploader...
    expect(salaryRow.member_id).toBe('mem-1');

    // ...and is the ONLY thing that shows up as unmatched. The expense,
    // despite also having no member_id, must not appear here at all.
    expect(json.unmatchedMembers).toEqual([{ label: 'Salary', attemptedMember: 'Marc' }]);
  });
});
