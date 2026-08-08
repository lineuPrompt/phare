import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// EQUIVALENCE + TENANCY for the extracted generation service.
//
// The extraction moved 778 lines verbatim out of POST /api/regenerate-plan. The
// failure mode being guarded against is NOT a crash: it is a guard that still
// runs, still passes, and silently guards nothing because its inputs were
// dropped or reordered in the move. That produces a wrong figure in a letter a
// family reads, with no user watching to catch it.
//
// Two things are pinned here that the route's own suites cannot pin:
//
//   1. GOLDEN OUTPUT — for a fixed fixture and a fixed AI response, the service
//      returns exactly the bytes it returned before. Any diff is a regression.
//
//   2. TENANCY — every query filters household_id explicitly, which is the
//      ONLY reason an admin client is safe here. RLS was never doing the
//      scoping work in this code, so under a service-role client those filters
//      are load-bearing. If one is ever dropped as "redundant", this fails.
// ---------------------------------------------------------------------------

type Resolution = { data?: unknown; error?: unknown; count?: number };

/** Every (table, filter) pair the service issues, so tenancy is inspectable. */
let queries: { table: string; filters: [string, unknown][] }[] = [];

/**
 * One record per QUERY, not per chained call. The builder returns a new proxy
 * from every `.eq()`, so pushing a record inside the proxy would scatter a
 * single query's filters across several records and make the tenancy assertion
 * silently vacuous — the filters would exist, just not on the object being
 * inspected.
 */
function chain(resolution: Resolution, filters: [string, unknown][]): unknown {
  const handler: ProxyHandler<object> = {
    get(_, prop) {
      if (prop === 'then') {
        return (resolve: (v: Resolution) => unknown, reject?: (v: unknown) => unknown) =>
          Promise.resolve(resolution).then(resolve, reject);
      }
      if (prop === 'catch') return (r: (v: unknown) => unknown) => Promise.resolve(resolution).catch(r);
      return (...args: unknown[]) => {
        if (prop === 'eq' && args.length === 2) filters.push([String(args[0]), args[1]]);
        // Same filters array threaded through, so the whole chain accumulates
        // onto the one record created in entry().
        return chain(resolution, filters);
      };
    },
  };
  return new Proxy({}, handler);
}

function makeClient(script: Record<string, Resolution[]>) {
  const cursors: Record<string, number> = {};
  const entry = (table: string) => {
    const idx = cursors[table] ?? 0;
    cursors[table] = idx + 1;
    const list = script[table] ?? [];
    const filters: [string, unknown][] = [];
    queries.push({ table, filters });
    // Falling off the end returns empty rather than throwing: this suite is
    // about output bytes and filters, not about pinning call counts, which the
    // route's own suites already do.
    return chain(list[idx] ?? { data: [], error: null, count: 0 }, filters);
  };
  return {
    from: (table: string) => ({
      select: () => entry(table),
      insert: () => entry(table),
      update: () => entry(table),
    }),
  };
}

const createMock = vi.fn();
vi.mock('@/lib/anthropic', () => ({
  anthropic: { messages: { create: (...a: unknown[]) => createMock(...a) } },
}));

// A household with no transactions and no accounts is the smallest input that
// still exercises the whole path: both AI calls, all four guards, and the
// assembly between them.
const EMPTY_HOUSEHOLD: Record<string, Resolution[]> = {
  transactions: [{ data: [], error: null }],
  accounts: [{ data: [], error: null }],
  sinking_funds: [{ data: [], error: null }],
  recurring_items: [{ data: [], error: null, count: 0 }],
  card_envelope_items: [{ data: [], error: null }],
  events: [{ data: null, error: null, count: 0 }],
  households: [{ data: { timezone: 'America/Toronto' }, error: null }],
};

function aiReturns(text: string) {
  return { content: [{ type: 'text', text }] };
}

async function generate(overrides: Record<string, unknown> = {}) {
  const { generateMonthlyReview } = await import('@/lib/monthlyReviewService');
  const client = makeClient(EMPTY_HOUSEHOLD);
  return generateMonthlyReview({
    // The mock is a structural stand-in for SupabaseClient, not an instance.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: client as any,
    householdId: 'hh-A',
    locale: 'en',
    timezone: 'America/Toronto',
    userId: 'user-1',
    ...overrides,
  } as Parameters<typeof generateMonthlyReview>[0]);
}

describe('generateMonthlyReview — golden output', () => {
  beforeEach(() => {
    vi.resetModules();
    queries = [];
    createMock.mockReset();
    // Plan call returns JSON; review call returns prose. Both fixed, so the
    // output is a pure function of the fixture.
    createMock
      .mockResolvedValueOnce(aiReturns(JSON.stringify({
        lineClassifications: [],
        topRecommendation: 'Move $100 into your property tax fund this month.',
      })))
      .mockResolvedValueOnce(aiReturns('July was steady. Nothing needs your attention this month.'));
  });

  it('returns exactly the topRecommendation and reviewText it was given', async () => {
    const result = await generate();
    expect(result).toEqual({
      topRecommendation: 'Move $100 into your property tax fund this month.',
      reviewText: 'July was steady. Nothing needs your attention this month.',
    });
  });

  it('returns ONLY those two fields — the service never persists', async () => {
    // Each caller writes its own conversations row: the route as today, the
    // cron with review_month and a null user_id. A service that persisted
    // would force one shape on both.
    const result = await generate();
    expect(Object.keys(result).sort()).toEqual(['reviewText', 'topRecommendation']);
    expect(queries.some((q) => q.table === 'conversations')).toBe(false);
  });

  it('makes both AI calls — the plan and the review', async () => {
    await generate();
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it('accepts a null userId, as the cron will pass', async () => {
    // events.user_id is ON DELETE SET NULL against auth.users, so a null author
    // is a shape the schema already permits.
    await expect(generate({ userId: null })).resolves.toBeTruthy();
  });
});

describe('generateMonthlyReview — tenancy', () => {
  beforeEach(() => {
    vi.resetModules();
    queries = [];
    createMock.mockReset();
    createMock
      .mockResolvedValueOnce(aiReturns(JSON.stringify({ lineClassifications: [], topRecommendation: 'x' })))
      .mockResolvedValueOnce(aiReturns('y'));
  });

  it('every household-scoped read filters on the household it was given', async () => {
    await generate({ householdId: 'hh-A' });

    // These are the tables the service reads that carry household_id. If a
    // filter is ever dropped as "redundant because RLS", an admin client would
    // read every household's rows and build a review from another family's
    // numbers — the worst bug this product could have.
    const scoped = ['transactions', 'accounts', 'sinking_funds', 'recurring_items', 'card_envelope_items'];
    const touched = queries.filter((q) => scoped.includes(q.table));
    expect(touched.length).toBeGreaterThan(0);

    for (const q of touched) {
      const householdFilter = q.filters.find(([col]) => col === 'household_id');
      expect(householdFilter, `${q.table} has no household_id filter`).toBeTruthy();
      expect(householdFilter![1], `${q.table} filtered on the wrong household`).toBe('hh-A');
    }
  });

  it('NEVER filters on a household it was not given', async () => {
    await generate({ householdId: 'hh-A' });
    const wrong = queries.flatMap((q) =>
      q.filters.filter(([col, val]) => col === 'household_id' && val !== 'hh-A').map(() => q.table)
    );
    expect(wrong).toEqual([]);
  });

  it('the assertion has teeth — it would notice a different household', async () => {
    // Without this the two tests above could pass against an empty query list.
    await generate({ householdId: 'hh-B' });
    const ids = new Set(
      queries.flatMap((q) => q.filters.filter(([c]) => c === 'household_id').map(([, v]) => v))
    );
    expect(ids).toEqual(new Set(['hh-B']));
  });
});
