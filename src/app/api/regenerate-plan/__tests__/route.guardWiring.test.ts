import { describe, it, expect, vi, beforeEach } from 'vitest';

// STRUCTURAL (2026-07-29): the guard functions in coachingHelpers.ts and
// topRecommendationHelpers.ts are correct and well-tested in isolation — the
// three real bugs this file guards against (the two fixed just above in
// route.ts, plus the earlier Part C locale-omission bug) were never in the
// guard logic itself. All three were the ROUTE passing a guard the wrong
// arguments (missing locale, or an incomplete category-name list) — a class
// of bug ~800 unit tests on the guards themselves could never catch, because
// none of them assert what the route actually hands each guard.
//
// These tests spy on the guard functions at the module boundary (real
// implementation preserved via importOriginal — behavior is unchanged, only
// observable) and assert on the ARGUMENTS each one receives from a real
// route run. Keep these thin: they exist to fail loudly the moment someone
// adds a parameter (a new locale-aware list, a new data source) and forgets
// to update a call site — not to re-verify guard behavior, which is already
// covered exhaustively in coachingHelpers.test.ts / topRecommendationHelpers.test.ts.

const findUnsanctionedSourcingMentionMock = vi.fn();
const containsIllustrativeTokenLeakMock = vi.fn();
vi.mock('@/lib/coachingHelpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/coachingHelpers')>();
  findUnsanctionedSourcingMentionMock.mockImplementation(actual.findUnsanctionedSourcingMention);
  containsIllustrativeTokenLeakMock.mockImplementation(actual.containsIllustrativeTokenLeak);
  return {
    ...actual,
    findUnsanctionedSourcingMention: findUnsanctionedSourcingMentionMock,
    containsIllustrativeTokenLeak: containsIllustrativeTokenLeakMock,
  };
});

const enforceBorrowedCashFramingMock = vi.fn();
const enforceDebtFigureInTopRecommendationMock = vi.fn();
vi.mock('@/lib/topRecommendationHelpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/topRecommendationHelpers')>();
  enforceBorrowedCashFramingMock.mockImplementation(actual.enforceBorrowedCashFraming);
  enforceDebtFigureInTopRecommendationMock.mockImplementation(actual.enforceDebtFigureInTopRecommendation);
  return {
    ...actual,
    enforceBorrowedCashFraming: enforceBorrowedCashFramingMock,
    enforceDebtFigureInTopRecommendation: enforceDebtFigureInTopRecommendationMock,
  };
});

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

function makeSupabaseMock(script: Record<string, Resolution[]>) {
  const cursors: Record<string, number> = {};

  function entry(table: string) {
    const idx = cursors[table] ?? 0;
    cursors[table] = idx + 1;
    const list = script[table] ?? [];
    if (idx >= list.length) {
      if (table === 'events') return makeResultChain({ data: null, error: null, count: 0 });
      // conversations is read (active-claim check) then written (upsert) on
      // every request now. This suite is about guard argument wiring, so an
      // exhausted script falls back to a benign result rather than making every
      // fixture spell out persistence it does not assert on.
      if (table === 'conversations') return makeResultChain({ data: null, error: null });
      throw new Error(`No scripted response for table "${table}" call #${idx + 1}`);
    }
    return makeResultChain(list[idx]);
  }

  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: (table: string) => ({
      select: (..._args: unknown[]) => entry(table),
      insert: (..._args: unknown[]) => entry(table),
      upsert: (..._args: unknown[]) => entry(table),
    }),
  };

  return { client };
}

vi.mock('@/lib/supabase-server', () => ({
  createClient: vi.fn(),
}));

const createMock = vi.fn();
vi.mock('@/lib/anthropic', () => ({
  anthropic: { messages: { create: (...args: unknown[]) => createMock(...args) } },
}));

// One realistic household covering every guard: a real credit-line draw
// (totalBorrowed > 0, engages both borrowed-cash guards), a real debt account
// (engages enforceDebtFigureInTopRecommendation's substitution branch), a
// real sinking fund (populates realEntityNames), and a real expense line
// ("Museum Membership") whose label is NOT one of SEED_CATEGORIES — the
// retained category line label buildReviewPayload keeps and the exact class
// of value Bug 1 proved the guard never received.
function guardWiringFixture() {
  return {
    users: [{ data: { household_id: 'hh1' }, error: null }],
    households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
    transactions: [
      {
        data: [
          { amount: 2000, type: 'income', description: 'Salary', account_id: 'chq-1' },
          { amount: 1800, type: 'expense', description: 'Rent', account_id: 'chq-1' },
          { amount: 240, type: 'expense', description: 'Museum Membership', account_id: 'chq-1' },
          { amount: -1000, type: 'transfer', description: 'Line of credit draw', account_id: 'chq-1', transfer_peer_id: 'peer-1', id: 'tx-1' },
        ],
        error: null,
      },
      { data: [], error: null }, // Coaching Layer history window
      { data: [{ amount: -6000, type: 'transfer', account_id: 'debt-1', date: '2026-01-01' }], error: null }, // all-time debt balance
    ],
    accounts: [{
      data: [
        { id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null },
        { id: 'debt-1', name: 'Credit Line', type: 'debt', goal_target: 0, goal_target_date: '2027-01-17' },
      ],
      error: null,
    }],
    sinking_funds: [{ data: [{ name: 'Vacation fund', annual_amount: 1200, monthly_provision: 100, due_month: 6, linked_account_id: null }], error: null }],
    recurring_items: [{ data: [], error: null }, { data: [], error: null }],
    conversations: [{ error: null }],
  };
}

async function runGuardWiringFixture(locale: 'en' | 'fr') {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-17T12:00:00'));

  createMock
    .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({
      lineClassifications: [
        { label: 'Rent', category: 'Housing', isFixed: true },
        { label: 'Museum Membership', category: 'Unexpected', isFixed: false },
      ],
      topRecommendation: locale === 'fr' ? 'Continuez.' : 'Keep going.',
    }) }] })
    .mockResolvedValueOnce({ content: [{ type: 'text', text: locale === 'fr' ? 'Un mois clair et simple.' : 'A fine month overall.' }] });

  const { client } = makeSupabaseMock(guardWiringFixture());
  const { createClient } = await import('@/lib/supabase-server');
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

  const { POST } = await import('../route');
  const res = await POST(new Request('http://localhost/api/regenerate-plan', {
    method: 'POST',
    body: JSON.stringify({ locale }),
  }));
  vi.useRealTimers();
  return res;
}

describe('POST /api/regenerate-plan — guard call-site argument wiring (structural, 2026-07-29)', () => {
  beforeEach(() => {
    vi.resetModules();
    createMock.mockReset();
    findUnsanctionedSourcingMentionMock.mockClear();
    containsIllustrativeTokenLeakMock.mockClear();
    enforceBorrowedCashFramingMock.mockClear();
    enforceDebtFigureInTopRecommendationMock.mockClear();
  });

  it('findUnsanctionedSourcingMention receives the locale, SEED_CATEGORIES, and the retained category line labels', async () => {
    const res = await runGuardWiringFixture('fr');
    expect(res.status).toBe(200);

    expect(findUnsanctionedSourcingMentionMock).toHaveBeenCalled();
    const [, allCategoryNames, , locale] = findUnsanctionedSourcingMentionMock.mock.calls[0];
    expect(locale).toBe('fr');
    // SEED_CATEGORIES present...
    expect(allCategoryNames).toEqual(expect.arrayContaining(['Housing', 'Shopping']));
    // ...AND the retained line label Bug 1 proved was missing.
    expect(allCategoryNames).toEqual(expect.arrayContaining(['Museum Membership']));
  });

  it('containsIllustrativeTokenLeak receives a realEntityNames list containing the sinking fund, debt account, and retained line labels', async () => {
    const res = await runGuardWiringFixture('en');
    expect(res.status).toBe(200);

    expect(containsIllustrativeTokenLeakMock).toHaveBeenCalled();
    const [, , realEntityNames] = containsIllustrativeTokenLeakMock.mock.calls[0];
    expect(realEntityNames).toEqual(expect.arrayContaining([
      'Vacation fund',  // sinking fund
      'Credit Line',    // debt account
      'Museum Membership', // retained category line label (Bug 2)
    ]));
  });

  it('enforceBorrowedCashFraming receives the locale and the real computed totalBorrowed', async () => {
    const res = await runGuardWiringFixture('fr');
    expect(res.status).toBe(200);

    expect(enforceBorrowedCashFramingMock).toHaveBeenCalled();
    // Every call (topRecommendation's, and reviewText's inside checkReviewGuards)
    // must agree on the same real locale and totalBorrowed figure.
    for (const call of enforceBorrowedCashFramingMock.mock.calls) {
      const [, totalBorrowed, locale] = call;
      expect(totalBorrowed).toBe(1000);
      expect(locale).toBe('fr');
    }
  });

  it('enforceDebtFigureInTopRecommendation receives the locale', async () => {
    const res = await runGuardWiringFixture('fr');
    expect(res.status).toBe(200);

    expect(enforceDebtFigureInTopRecommendationMock).toHaveBeenCalledTimes(1);
    const [, , locale] = enforceDebtFigureInTopRecommendationMock.mock.calls[0];
    expect(locale).toBe('fr');
  });
});
