import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// The two things this route must never get wrong: sending a free household the
// full text of a letter, and reporting a figure that did not come from the
// ledger.
// ---------------------------------------------------------------------------

type Resolution = { data?: unknown; error?: unknown; count?: number | null };

let userRow: Resolution;
let conversations: Resolution;
let accounts: Resolution;
let transactions: Resolution;
let household: Resolution;
let authUser: { id: string } | null;
let txQuery: { gte?: string; lt?: string };

function chain(resolution: Resolution, table: string): unknown {
  return new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') {
        return (r: (v: Resolution) => unknown) => Promise.resolve(resolution).then(r);
      }
      return (...args: unknown[]) => {
        if (table === 'transactions' && prop === 'gte') txQuery.gte = String(args[1]);
        if (table === 'transactions' && prop === 'lt') txQuery.lt = String(args[1]);
        return chain(resolution, table);
      };
    },
  });
}

vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: authUser }, error: null }) },
    from: (table: string) => ({
      select: () => {
        if (table === 'users') return chain(userRow, table);
        if (table === 'conversations') return chain(conversations, table);
        if (table === 'accounts') return chain(accounts, table);
        if (table === 'transactions') return chain(transactions, table);
        if (table === 'households') return chain(household, table);
        return chain({ data: [], error: null }, table);
      },
    }),
  }),
}));

const LONG = 'The month closed ahead. '.repeat(40);

async function get() {
  const { GET } = await import('../route');
  return GET();
}

/** A household whose billing columns make entitlementFor return isPro. */
const PRO_HOUSEHOLD = {
  subscription_status: 'active',
  subscription_current_period_end: '2099-01-01T00:00:00Z',
  subscription_cancel_at_period_end: false,
  comp_until: null,
};
const FREE_HOUSEHOLD = {
  subscription_status: null,
  subscription_current_period_end: null,
  subscription_cancel_at_period_end: false,
  comp_until: null,
};

describe('GET /api/reviews', () => {
  beforeEach(() => {
    vi.resetModules();
    txQuery = {};
    authUser = { id: 'user-1' };
    userRow = { data: { household_id: 'hh1' }, error: null };
    household = { data: FREE_HOUSEHOLD, error: null };
    accounts = { data: [{ id: 'chq', type: 'chequing' }], error: null };
    transactions = { data: [], error: null };
    conversations = {
      data: [
        {
          id: 'jul',
          type: 'monthly_review',
          review_month: '2026-07',
          created_at: '2026-08-01T07:00:00Z',
          messages: [
            { type: 'top_recommendation', content: 'Move $200 to the buffer.' },
            { type: 'monthly_review', content: LONG },
          ],
        },
      ],
      error: null,
    };
  });

  it('refuses an unauthenticated caller', async () => {
    authUser = null;
    expect((await get()).status).toBe(401);
  });

  it('a free household never receives the full letter text', async () => {
    const json = await (await get()).json();
    const letter = json.months[0].latest;

    expect(letter.reviewLocked).toBe(true);
    expect(letter.review.length).toBeLessThan(LONG.length);
    // The decisive check: the withheld text is ABSENT from the payload, not
    // merely flagged. A CSS lock over a full string is defeated from the
    // network tab.
    expect(JSON.stringify(json)).not.toContain(LONG.trim());
  });

  it('the top recommendation is never withheld — it is the free tier’s value', async () => {
    const json = await (await get()).json();
    expect(json.months[0].latest.topRecommendation).toBe('Move $200 to the buffer.');
  });

  it('a Pro household receives the whole letter', async () => {
    household = { data: PRO_HOUSEHOLD, error: null };
    const json = await (await get()).json();

    expect(json.isPro).toBe(true);
    expect(json.months[0].latest.reviewLocked).toBe(false);
    expect(json.months[0].latest.review).toBe(LONG);
  });

  it('computes the month figure from the ledger, not from the prose', async () => {
    household = { data: PRO_HOUSEHOLD, error: null };
    transactions = {
      data: [
        { id: 't1', amount: 5000, type: 'income', account_id: 'chq', date: '2026-07-03' },
        { id: 't2', amount: 1800, type: 'expense', account_id: 'chq', date: '2026-07-15' },
      ],
      error: null,
    };

    const json = await (await get()).json();
    expect(json.months[0].netCashFlow).toBe(3200);
  });

  it('reports null — not zero — for a month with no transactions', async () => {
    // $0 is a real figure meaning "it broke even". An empty month has no
    // figure at all, and the two must not look the same.
    const json = await (await get()).json();
    expect(json.months[0].netCashFlow).toBeNull();
  });

  it('scopes the ledger query to the months it actually needs', async () => {
    conversations = {
      data: [
        { id: 'jun', type: 'monthly_review', review_month: '2026-06', created_at: '2026-07-01T07:00:00Z', messages: [{ type: 'monthly_review', content: 'x' }] },
        { id: 'dec', type: 'monthly_review', review_month: '2026-12', created_at: '2027-01-01T07:00:00Z', messages: [{ type: 'monthly_review', content: 'x' }] },
      ],
      error: null,
    };

    await get();
    expect(txQuery.gte).toBe('2026-06-01');
    // December must roll the YEAR, not produce a month 13.
    expect(txQuery.lt).toBe('2027-01-01');
  });

  it('returns an empty archive rather than failing for a household with no letters', async () => {
    conversations = { data: [], error: null };
    const res = await get();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.months).toEqual([]);
    expect(json.earlier).toEqual([]);
    expect(json.startingPlan).toBeNull();
  });

  it('surfaces a conversations read failure instead of pretending the archive is empty', async () => {
    conversations = { data: null, error: { message: 'db down' } };
    expect((await get()).status).toBe(503);
  });
});
