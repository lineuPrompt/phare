import { describe, it, expect, vi, beforeEach } from 'vitest';
import { conversationsClientTables } from '../../../../test/conversationsClientDouble';
import { categoriesWriterTables } from '../../../../test/categoriesWriterDouble';
import { businessMonth } from '@phare/core';

// getHouseholdTimezone's fallback (and every test household's scripted
// `households` row below) is 'America/Toronto' — matching it here keeps
// these tests decoupled from the test-runner's own local timezone.
const TEST_TIMEZONE = 'America/Toronto';

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
    const currentMonth = businessMonth(TEST_TIMEZONE);
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
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
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

describe('POST /api/save-plan — manual entry produces the same shape as a template row', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('a manual bi-weekly expense (isFixed, rawAmount, frequency — what the "calculated" source now produces) gets a real cadence and lands in needsPayDate, same as a template row would', async () => {
    const { client, calls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      household_members: [
        { data: { id: 'mem-1' }, error: null },
        { data: [], error: null },
      ],
      accounts: [
        { data: [{ id: 'chq-1', type: 'chequing', name: 'Chequing', file_import_id: null }], error: null },
      ],
      recurring_items: [
        { count: 0, error: null },
        { data: [], error: null },
        {
          data: [{
            id: 'ri-1', description: 'Mortgage', amount: 1500, type: 'expense', cadence: 'biweekly',
            anchor_date: null, second_day: null, category_id: 'cat-housing',
            account_id: 'chq-1', member_id: null,
          }],
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
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      file_imports: [{ data: { id: 'imp-1' }, error: null }],
      categories: [
        { data: SEED_CATEGORY_NAMES.map((name) => ({ name })), error: null },
        { data: SEED_CATEGORY_NAMES.map((name) => ({ id: `cat-${name.toLowerCase()}`, name })), error: null },
      ],
      conversations: [{ error: null }],
      events: [{ error: null }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');

    // This is exactly what assembleCalculatedBudget + AI classification now
    // produce for a manual form line marked bi-weekly — no "source" field
    // reaches save-plan at all, so there is nothing here that could
    // distinguish it from a template-parsed row.
    const body = {
      plan: {
        monthlyBudget: {
          categories: [
            { name: 'Mortgage', budgeted: 3250, type: 'expense', isFixed: true, rawAmount: 1500, frequency: 'biweekly', seedCategory: 'Housing' },
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

    // The actual INSERT payload — real cadence and per-payment amount, not
    // the monthly-equivalent, and no fabricated anchor date.
    const recurringInserts = calls.filter((c) => c.table === 'recurring_items' && c.method === 'insert');
    expect(recurringInserts).toHaveLength(1);
    const row = (recurringInserts[0].args[0] as Record<string, unknown>[])[0];
    expect(row.cadence).toBe('biweekly');
    expect(row.amount).toBe(1500);
    expect(row.anchor_date).toBeNull();

    // No anchor yet → surfaced in needsPayDate, same mechanism a template
    // upload's non-monthly expense already uses.
    expect(json.needsPayDate).toHaveLength(1);
    expect(json.needsPayDate[0]).toMatchObject({
      description: 'Mortgage', cadence: 'biweekly', amount: 1500, type: 'expense',
    });
  });
});

describe('POST /api/save-plan — expense member attribution', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('an imported expense with no member column defaults to household-level (member_id null) and never counts as unmatched, while an unresolved income name still warns', async () => {
    const currentMonth = businessMonth(TEST_TIMEZONE);
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
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
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

describe('POST /api/save-plan — no-fabrication contract: a manual plan with empty structured sections persists zero', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('a two-line manual plan (goals: [], sinkingFunds: []) creates no goal accounts and inserts no sinking funds', async () => {
    const currentMonth = businessMonth(TEST_TIMEZONE);
    const anchorDate = `${currentMonth}-01`;

    const { client, calls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      household_members: [
        { data: { id: 'mem-1' }, error: null },
        { data: [], error: null },
      ],
      accounts: [
        { data: [{ id: 'chq-1', type: 'chequing', name: 'Chequing', file_import_id: null }], error: null },
      ],
      recurring_items: [
        { count: 0, error: null },              // prior-data guard count
        { data: [], error: null },              // prior provenanced recurring_items
        {
          data: [{
            id: 'ri-1', description: 'Mortgage', amount: 3000, type: 'expense', cadence: 'monthly',
            anchor_date: anchorDate, second_day: null, category_id: 'cat-housing',
            account_id: 'chq-1', member_id: null,
          }],
          error: null,
        },
      ],
      budgets: [
        { count: 0, error: null },
        { error: null },
      ],
      sinking_funds: [
        { count: 0, error: null },
        { error: null }, // unconditional delete — but NO insert must follow
      ],
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      file_imports: [{ data: { id: 'imp-1' }, error: null }],
      categories: [
        { data: SEED_CATEGORY_NAMES.map((name) => ({ name })), error: null },
        { data: SEED_CATEGORY_NAMES.map((name) => ({ id: `cat-${name.toLowerCase()}`, name })), error: null },
      ],
      transactions: [
        { error: null }, // materialize cleanup delete
        { error: null }, // materialize insert
      ],
      conversations: [{ error: null }],
      events: [{ error: null }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');

    // Exactly what api/plan now returns for the manual two-line input: user's
    // income + expense lines, and empty goals / sinking funds.
    const body = {
      plan: {
        monthlyBudget: {
          categories: [
            { name: 'Salary', budgeted: 5000, type: 'income' },
            { name: 'Mortgage', budgeted: 3000, type: 'expense', isFixed: true, seedCategory: 'Housing' },
          ],
        },
        sinkingFunds: [],
        goals: [],
        topRecommendation: 'Consider a property-tax fund — Quebec bills land in March and June.',
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
    expect(json.saved).toBe(true);

    // No goal account created — the only account touched is the pre-existing chequing.
    const accountInserts = calls.filter((c) => c.table === 'accounts' && c.method === 'insert');
    expect(accountInserts).toHaveLength(0);

    // No sinking funds persisted (the delete is fine; there must be no insert).
    const sinkingInserts = calls.filter((c) => c.table === 'sinking_funds' && c.method === 'insert');
    expect(sinkingInserts).toHaveLength(0);
  });
});

describe('POST /api/save-plan — calculated-source end-to-end persistence (manual-entry blocker)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // The founder's live-tested manual-entry shape: a salary, a monthly rent
  // (fixed), and a groceries budget (variable) — nothing template-specific
  // anywhere in this payload. Proves recurring items, their materialized
  // transactions, the variable-expense budget row, and the conversation
  // (plan artifact) all persist for the "calculated" source exactly as they
  // do for "template" — the same save path, indistinguishable ledgers.
  it('a realistic calculated-source plan persists recurring items, materialized transactions, budgets, and the review conversation', async () => {
    const currentMonth = businessMonth(TEST_TIMEZONE);
    const anchorDate = `${currentMonth}-01`;

    const { client, calls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      household_members: [
        { data: { id: 'mem-1' }, error: null },
        { data: [], error: null },
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
              id: 'ri-salary', description: 'Salary', amount: 5000, type: 'income', cadence: 'monthly',
              anchor_date: anchorDate, second_day: null, category_id: null, account_id: 'chq-1', member_id: 'mem-1',
            },
            {
              id: 'ri-rent', description: 'Rent', amount: 2000, type: 'expense', cadence: 'monthly',
              anchor_date: anchorDate, second_day: null, category_id: 'cat-housing', account_id: 'chq-1', member_id: null,
            },
          ],
          error: null,
        },
      ],
      budgets: [
        { count: 0, error: null },
        { error: null }, // unconditional delete
        { error: null }, // the Groceries budget insert
      ],
      sinking_funds: [
        { count: 0, error: null },
        { error: null },
      ],
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      file_imports: [{ data: { id: 'imp-1' }, error: null }],
      categories: [
        { data: SEED_CATEGORY_NAMES.map((name) => ({ name })), error: null },
        { data: SEED_CATEGORY_NAMES.map((name) => ({ id: `cat-${name.toLowerCase().replace(/ & /g, '-').replace(/ /g, '-')}`, name })), error: null },
      ],
      transactions: [
        { error: null }, // materialize cleanup for ri-salary
        { error: null }, // materialize cleanup for ri-rent
        { error: null }, // materialize insert (both items' occurrences)
      ],
      conversations: [{ error: null }],
      events: [{ error: null }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');

    // Exactly the shape assembleCalculatedBudget + AI classification produce
    // for manual entry — no "source" field reaches save-plan at all.
    const body = {
      plan: {
        monthlyBudget: {
          categories: [
            { name: 'Salary', budgeted: 5000, type: 'income' },
            { name: 'Rent', budgeted: 2000, type: 'expense', isFixed: true, seedCategory: 'Housing' },
            { name: 'Groceries', budgeted: 400, type: 'expense', isFixed: false, seedCategory: 'Groceries & Pharmacy' },
          ],
        },
        sinkingFunds: [],
        goals: [],
        topRecommendation: 'Keep it up.',
      },
      reviewText: 'Looking good this month.',
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
    expect(json.saved).toBe(true);

    // Recurring items: both the income and the fixed expense.
    const recurringInserts = calls.filter((c) => c.table === 'recurring_items' && c.method === 'insert');
    expect(recurringInserts).toHaveLength(1);
    const recurringRows = recurringInserts[0].args[0] as { description: string; type: string }[];
    expect(recurringRows.map((r) => r.description).sort()).toEqual(['Rent', 'Salary']);

    // Materialized transactions for both (both are monthly, anchored immediately).
    const transactionInserts = calls.filter((c) => c.table === 'transactions' && c.method === 'insert');
    expect(transactionInserts).toHaveLength(1);
    expect((transactionInserts[0].args[0] as unknown[]).length).toBeGreaterThan(0);

    // The variable expense lands as a budget row, not a recurring item.
    const budgetInserts = calls.filter((c) => c.table === 'budgets' && c.method === 'insert');
    expect(budgetInserts).toHaveLength(1);
    expect(budgetInserts[0].args[0]).toEqual([
      expect.objectContaining({ amount: 400 }),
    ]);

    // The plan artifact (top recommendation + review) is recorded.
    const conversationInserts = calls.filter((c) => c.table === 'conversations' && c.method === 'insert');
    // Written through the service role (launch plan 1.3), not the session.
    expect(conversationsClientTables).toEqual(['conversations']);
    expect(conversationInserts).toHaveLength(1);

    // No anchor step needed — everything was monthly and anchored immediately.
    expect(json.needsPayDate).toEqual([]);
  });
});

describe('POST /api/save-plan — goal accounts (Bug 2: target date persistence + starting-balance seeding)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('persists goal_target_date and seeds exactly one "Starting balance" transfer transaction for savedSoFar', async () => {
    const currentMonth = businessMonth(TEST_TIMEZONE);
    const monthDate = `${currentMonth}-01`;

    const { client, calls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      household_members: [
        { data: { id: 'mem-1' }, error: null },
        { data: [], error: null },
      ],
      accounts: [
        { data: [{ id: 'chq-1', type: 'chequing', name: 'Chequing', file_import_id: null }], error: null },
        { data: [{ id: 'goal-1', name: 'Emergency Fund', type: 'savings' }], error: null }, // insert().select() for the new goal account
      ],
      recurring_items: [
        { count: 0, error: null },
        { data: [], error: null },
      ],
      budgets: [
        { count: 0, error: null },
        { error: null },
      ],
      sinking_funds: [
        { count: 0, error: null },
        { error: null },
      ],
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      file_imports: [{ data: { id: 'imp-1' }, error: null }],
      categories: [
        { data: SEED_CATEGORY_NAMES.map((name) => ({ name })), error: null },
        { data: SEED_CATEGORY_NAMES.map((name) => ({ id: `cat-${name.toLowerCase()}`, name })), error: null },
      ],
      transactions: [
        { error: null }, // the starting-balance insert
      ],
      conversations: [{ error: null }],
      events: [{ error: null }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');

    // No income/expense categories at all — this test is scoped to goal
    // account creation and starting-balance seeding, not the ledger routing
    // already covered by the other describe blocks in this file.
    const body = {
      plan: {
        monthlyBudget: { categories: [] },
        sinkingFunds: [],
        goals: [{ name: 'Emergency Fund', targetAmount: 5000, targetDate: '2027-01-01', savedSoFar: 2000 }],
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
    expect(json.saved).toBe(true);

    const accountInserts = calls.filter((c) => c.table === 'accounts' && c.method === 'insert');
    expect(accountInserts).toHaveLength(1);
    const accountRow = (accountInserts[0].args[0] as Record<string, unknown>[])[0];
    expect(accountRow).toMatchObject({
      name: 'Emergency Fund', type: 'savings', goal_target: 5000, goal_target_date: '2027-01-01',
    });

    // A real ledger row, not a balance mutation — one transaction, on the
    // new goal account, dated at onboarding.
    const transactionInserts = calls.filter((c) => c.table === 'transactions' && c.method === 'insert');
    expect(transactionInserts).toHaveLength(1);
    const seededRows = transactionInserts[0].args[0] as Record<string, unknown>[];
    expect(seededRows).toHaveLength(1);
    expect(seededRows[0]).toMatchObject({
      account_id: 'goal-1',
      amount: 2000,
      type: 'transfer',
      description: 'Starting balance / Solde initial',
      date: monthDate,
    });
  });

  it('does not seed a starting-balance transaction when savedSoFar is zero or absent', async () => {
    const { client, calls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      household_members: [
        { data: { id: 'mem-1' }, error: null },
        { data: [], error: null },
      ],
      accounts: [
        { data: [{ id: 'chq-1', type: 'chequing', name: 'Chequing', file_import_id: null }], error: null },
        { data: [{ id: 'goal-1', name: 'New Car', type: 'savings' }], error: null },
      ],
      recurring_items: [
        { count: 0, error: null },
        { data: [], error: null },
      ],
      budgets: [
        { count: 0, error: null },
        { error: null },
      ],
      sinking_funds: [
        { count: 0, error: null },
        { error: null },
      ],
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      file_imports: [{ data: { id: 'imp-1' }, error: null }],
      categories: [
        { data: SEED_CATEGORY_NAMES.map((name) => ({ name })), error: null },
        { data: SEED_CATEGORY_NAMES.map((name) => ({ id: `cat-${name.toLowerCase()}`, name })), error: null },
      ],
      conversations: [{ error: null }],
      events: [{ error: null }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');

    const body = {
      plan: {
        monthlyBudget: { categories: [] },
        sinkingFunds: [],
        goals: [{ name: 'New Car', targetAmount: 8000, targetDate: null, savedSoFar: 0 }],
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

    expect(res.status).toBe(200);
    const transactionInserts = calls.filter((c) => c.table === 'transactions' && c.method === 'insert');
    expect(transactionInserts).toHaveLength(0);
  });
});

describe('POST /api/save-plan — category seeding never fails silently', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // A household with no categories yet (a first onboarding). The category
  // script is the variable; every other table is the zero-accounts scenario
  // above, truncated to what runs before the category block.
  async function runWithCategories(categories: Resolution[], extraPlan: Record<string, unknown> = {}) {
    const { client, calls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      household_members: [
        { data: { id: 'mem-1' }, error: null },
        { data: [], error: null },
      ],
      accounts: [
        { data: [], error: null },
        { data: null, error: null },
        { data: { id: 'chq-new' }, error: null },
      ],
      recurring_items: [
        { count: 0, error: null },
        { data: [], error: null },
      ],
      budgets: [
        { count: 0, error: null },
        { error: null },
      ],
      sinking_funds: [
        { count: 0, error: null },
        { error: null },
      ],
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      file_imports: [{ data: { id: 'imp-1' }, error: null }],
      categories,
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const { POST } = await import('../route');

    const res = await POST(new Request('http://localhost/api/save-plan', {
      method: 'POST',
      body: JSON.stringify({
        plan: {
          monthlyBudget: {
            categories: [
              { name: 'Rent', budgeted: 1200, type: 'expense', isFixed: true, seedCategory: 'Housing' },
            ],
          },
          sinkingFunds: [],
          goals: [],
          topRecommendation: 'Keep it up.',
          ...extraPlan,
        },
        reviewText: 'Looking good.',
        locale: 'en',
        cardNames: [],
        fileMeta: null,
      }),
    }));
    return { res, json: await res.json(), calls };
  }

  // Nothing after the category block may run: no recurring items, no
  // transactions, no review, no completed_onboarding event.
  function expectStoppedAtCategories(calls: Call[]) {
    const after = calls.filter((c) =>
      (c.table === 'recurring_items' && c.method === 'insert') ||
      c.table === 'transactions' || c.table === 'conversations' || c.table === 'events');
    expect(after).toEqual([]);
  }

  it('a failed seed insert returns 500 carrying the database reason, and saves nothing after it', async () => {
    const { res, json, calls } = await runWithCategories([
      { data: [], error: null },                                          // existing: none
      { error: { message: 'new row violates row-level security policy' } }, // seed insert fails
    ]);

    expect(res.status).toBe(500);
    expect(json.saved).toBeUndefined();
    expect(json.error).toBe('Failed to create categories: new row violates row-level security policy');

    const seedInserts = calls.filter((c) => c.table === 'categories' && c.method === 'insert');
    expect(seedInserts).toHaveLength(1);
    expect((seedInserts[0].args[0] as { name: string }[]).map((r) => r.name)).toEqual(SEED_CATEGORY_NAMES);
    // The seed is written by the service role (launch plan 1.6); the read of
    // existing categories stays on the member's session.
    expect(categoriesWriterTables).toEqual(['categories']);
    expectStoppedAtCategories(calls);
  });

  it('a category list in the request body is ignored: the fixed set is seeded, nothing else', async () => {
    // seedCategories in the body used to be inserted as-is — a way to add
    // custom categories past the Pro gate. The insert result is a failure so
    // the route stops right after the seed and nothing more needs scripting.
    const { calls } = await runWithCategories([
      { data: [], error: null },
      { error: { message: 'stop here' } },
    ], { seedCategories: ['Yachts', 'Housing'] });

    const seedInserts = calls.filter((c) => c.table === 'categories' && c.method === 'insert');
    expect(seedInserts).toHaveLength(1);
    const names = (seedInserts[0].args[0] as { name: string; household_id: string }[]).map((r) => r.name);
    expect(names).toEqual(SEED_CATEGORY_NAMES);
    expect(names).not.toContain('Yachts');
    expect((seedInserts[0].args[0] as { household_id: string }[]).every((r) => r.household_id === 'hh1')).toBe(true);
  });

  it('a failed read of existing categories returns 500 instead of seeding blind', async () => {
    const { res, json, calls } = await runWithCategories([
      { data: null, error: { message: 'permission denied for table categories' } },
    ]);

    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to read categories: permission denied for table categories');
    expect(calls.filter((c) => c.table === 'categories' && c.method === 'insert')).toEqual([]);
    expectStoppedAtCategories(calls);
  });

  it('a failed re-read after seeding returns 500 instead of saving every line with no category', async () => {
    const { res, json, calls } = await runWithCategories([
      { data: [], error: null },                                   // existing: none
      { error: null },                                             // seed insert ok
      { data: null, error: { message: 'canceling statement due to statement timeout' } },
    ]);

    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to read categories: canceling statement due to statement timeout');
    expectStoppedAtCategories(calls);
  });
});

// ---------------------------------------------------------------------------
// Every replace/insert write is checked (docs/tickets/save-plan-unchecked-
// writes.md). Each failure answers 500 with the database's reason and runs
// nothing after it — never `200 { saved: true }` over a write that did not
// happen. The onboarding letter is the one exception: by then the plan IS
// saved, so its failure is reported as `letterError`, not a 500.
// ---------------------------------------------------------------------------

describe('POST /api/save-plan — no write fails silently', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  const FAIL = (message: string) => ({ error: { message } });

  // A household re-onboarding: one provenanced recurring item from the last
  // plan, a fixed Rent line, a variable Groceries line (a category budget)
  // and one sinking fund. Mirrors the route's call order.
  function fullScript(): Record<string, Resolution[]> {
    const currentMonth = businessMonth(TEST_TIMEZONE);
    return {
      users: [{ data: { household_id: 'hh1' }, error: null }],
      household_members: [{ data: { id: 'mem-1' }, error: null }, { data: [], error: null }],
      accounts: [
        { data: [{ id: 'chq-1', type: 'chequing', name: 'Chequing', file_import_id: null }], error: null },
        { data: { id: 'chq-1' }, error: null },
      ],
      recurring_items: [
        { count: 0, error: null },                       // prior-data guard
        { data: [{ id: 'old-ri' }], error: null },       // the previous plan's recurring items
        { error: null },                                  // delete them
        {
          data: [{
            id: 'ri-1', description: 'Rent', amount: 1200, type: 'expense', cadence: 'monthly',
            anchor_date: `${currentMonth}-01`, second_day: null, category_id: 'cat-housing',
            account_id: 'chq-1', member_id: 'mem-1',
          }],
          error: null,
        },
      ],
      budgets: [{ count: 0, error: null }, { error: null }, { error: null }],
      sinking_funds: [{ count: 0, error: null }, { error: null }, { error: null }],
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      file_imports: [{ data: { id: 'imp-1' }, error: null }],
      categories: [
        { data: SEED_CATEGORY_NAMES.map((name) => ({ name })), error: null },
        { data: SEED_CATEGORY_NAMES.map((name) => ({ id: `cat-${name.toLowerCase()}`, name })), error: null },
      ],
      transactions: [
        { error: null }, // delete the previous plan's recurring transactions
        { error: null }, // materialize cleanup for ri-1
        { error: null }, // materialize insert
      ],
      conversations: [{ error: null }],
    };
  }

  async function run(script: Record<string, Resolution[]>) {
    const { client, calls } = makeSupabaseMock(script);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/save-plan', {
      method: 'POST',
      body: JSON.stringify({
        plan: {
          monthlyBudget: {
            categories: [
              { name: 'Rent', budgeted: 1200, type: 'expense', isFixed: true, seedCategory: 'Housing' },
              { name: 'Groceries', budgeted: 600, type: 'expense', isFixed: false, seedCategory: 'Groceries & Pharmacy' },
            ],
          },
          sinkingFunds: [{ name: 'Car insurance', annualAmount: 1200, monthlyProvision: 100, dueMonth: 'March' }],
          goals: [],
          topRecommendation: 'Keep it up.',
        },
        reviewText: 'Looking good.',
        locale: 'en',
        cardNames: [],
        fileMeta: null,
        confirmReplace: true,
      }),
    }));
    return { res, json: await res.json(), calls };
  }

  const wrote = (calls: Call[], table: string, method: string) =>
    calls.some((c) => c.table === table && c.method === method);

  it('the full run succeeds and writes every piece (the baseline the failures below break)', async () => {
    const { res, json, calls } = await run(fullScript());
    expect(res.status).toBe(200);
    expect(json.saved).toBe(true);
    expect(json.letterError).toBeNull();
    expect(wrote(calls, 'budgets', 'insert')).toBe(true);
    expect(wrote(calls, 'sinking_funds', 'insert')).toBe(true);
    expect(wrote(calls, 'conversations', 'insert')).toBe(true);
  });

  it("a failed read of the previous plan's recurring items: 500, nothing replaced", async () => {
    const s = fullScript();
    s.recurring_items[1] = { data: null, ...FAIL('canceling statement due to statement timeout') };
    const { res, json, calls } = await run(s);
    expect(res.status).toBe(500);
    expect(json.error).toBe("Failed to read the previous plan's recurring items: canceling statement due to statement timeout");
    expect(wrote(calls, 'recurring_items', 'delete')).toBe(false);
    expect(wrote(calls, 'budgets', 'delete')).toBe(false);
  });

  it("a failed delete of the previous plan's transactions: 500, its rules kept, nothing after", async () => {
    const s = fullScript();
    s.transactions[0] = FAIL('permission denied for table transactions');
    const { res, json, calls } = await run(s);
    expect(res.status).toBe(500);
    expect(json.error).toBe("Failed to remove the previous plan's recurring transactions: permission denied for table transactions");
    expect(wrote(calls, 'recurring_items', 'delete')).toBe(false);
    expect(wrote(calls, 'budgets', 'delete')).toBe(false);
  });

  it("a failed delete of the previous plan's recurring items: 500, nothing after", async () => {
    const s = fullScript();
    s.recurring_items[2] = FAIL('update or delete on table "recurring_items" violates foreign key constraint');
    const { res, json, calls } = await run(s);
    expect(res.status).toBe(500);
    expect(json.error).toBe(
      "Failed to remove the previous plan's recurring items: update or delete on table \"recurring_items\" violates foreign key constraint"
    );
    expect(wrote(calls, 'budgets', 'delete')).toBe(false);
  });

  it('a failed delete of the old budgets: 500, nothing after', async () => {
    const s = fullScript();
    s.budgets[1] = FAIL('connection reset');
    const { res, json, calls } = await run(s);
    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to replace the previous budgets: connection reset');
    expect(wrote(calls, 'sinking_funds', 'delete')).toBe(false);
  });

  it('a failed delete of the old sinking funds: 500, nothing after', async () => {
    const s = fullScript();
    s.sinking_funds[1] = FAIL('connection reset');
    const { res, json, calls } = await run(s);
    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to replace the previous sinking funds: connection reset');
    expect(wrote(calls, 'categories', 'insert')).toBe(false);
    expect(wrote(calls, 'budgets', 'insert')).toBe(false);
  });

  it('a failed budgets insert: 500, no sinking funds, no letter', async () => {
    const s = fullScript();
    s.budgets[2] = FAIL('value too long for type numeric(10,2)');
    const { res, json, calls } = await run(s);
    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to save category budgets: value too long for type numeric(10,2)');
    expect(wrote(calls, 'sinking_funds', 'insert')).toBe(false);
    expect(wrote(calls, 'conversations', 'insert')).toBe(false);
  });

  it('a failed sinking funds insert: 500, no letter', async () => {
    const s = fullScript();
    s.sinking_funds[2] = FAIL('null value in column "due_month" violates not-null constraint');
    const { res, json, calls } = await run(s);
    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to save sinking funds: null value in column "due_month" violates not-null constraint');
    expect(wrote(calls, 'conversations', 'insert')).toBe(false);
  });

  it('a failed letter: the plan IS saved (200), and the reason comes back as letterError', async () => {
    const s = fullScript();
    s.conversations[0] = FAIL('permission denied for table conversations');
    const { res, json } = await run(s);
    expect(res.status).toBe(200);
    expect(json.saved).toBe(true);
    expect(json.letterError).toBe('permission denied for table conversations');
  });
});
