import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// GET /api/dashboard — the review paywall.
//
// The rule this pins: a free household's RESPONSE does not contain the rest of
// the review. Not hidden, not blurred, not flagged — absent. Anything weaker is
// a CSS effect that anyone can defeat from the network tab, and it would be
// selling something already given away.
//
// The truncation itself is exhaustively unit-tested in reviewPreview.test.ts.
// What is pinned HERE is the wiring: that the route consults entitlement at
// all, that it fails closed, and that `review` and `reviewLocked` cannot
// disagree with each other.
// ---------------------------------------------------------------------------

type Resolution = { data?: unknown; error?: unknown; count?: number };

function makeResultChain(resolution: Resolution) {
  const handler: ProxyHandler<object> = {
    get(_, prop) {
      if (prop === 'then') {
        return (resolve: (v: Resolution) => unknown, reject?: (v: unknown) => unknown) =>
          Promise.resolve(resolution).then(resolve, reject);
      }
      if (prop === 'catch') return (reject: (v: unknown) => unknown) => Promise.resolve(resolution).catch(reject);
      return () => makeResultChain(resolution);
    },
  };
  return new Proxy({}, handler);
}

function makeSupabaseMock(script: Record<string, Resolution[]>) {
  const cursors: Record<string, number> = {};
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: (table: string) => {
      const run = () => {
        const idx = cursors[table] ?? 0;
        cursors[table] = idx + 1;
        const list = script[table] ?? [];
        // Falling off the end returns empty rather than throwing: this suite
        // only cares about the review path, and the dashboard runs many other
        // queries whose exact order is not the subject here.
        return makeResultChain(list[idx] ?? { data: null, error: null });
      };
      return { select: run, insert: run, update: run, delete: run };
    },
  };
  return client;
}

vi.mock('@/lib/supabase-server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/bridgeHelpers', () => ({ ensureBridgesForWindow: async () => {} }));

// Comfortably past REVIEW_PREVIEW_CHARS (320), with the marker sentence well
// beyond the cut. An earlier version of this constant was 303 characters and so
// was never truncated at all — the test passed vacuously and proved nothing.
const LONG_REVIEW =
  'June was a solid month overall. ' +
  'You stayed within budget in four of five categories and your reserve fund grew by $250. ' +
  'The one to watch is Restaurants, which ran $180 over plan for the third month running. ' +
  'Your income landed on schedule in both pay periods and nothing bounced. ' +
  'The car registration provision is now three quarters funded ahead of its March due date. ' +
  'SECRET_TAIL this sentence must never reach a free household because it is past the preview budget.';

/** Script with the review present and a given entitlement row. */
function scriptWith(entitlement: Resolution) {
  return {
    users: [{ data: { household_id: 'hh1', full_name: 'Lineu' }, error: null }],
    households: [
      { data: { timezone: 'America/Toronto' }, error: null }, // getHouseholdTimezone
      entitlement,                                            // loadEntitlement
    ],
    file_imports: [{ data: { id: 'imp-1' }, error: null }],
    budgets: [{ data: null, error: null }, { data: [], error: null }],
    transactions: [{ data: [], error: null }],
    accounts: [{ data: [{ id: 'chq-1', name: 'Chequing', type: 'chequing' }], error: null }],
    account_balance_anchors: [{ data: { anchor_date: '2026-01-01' }, error: null }],
    sinking_funds: [{ data: [], error: null }],
    conversations: [{
      data: {
        messages: [
          { role: 'assistant', type: 'monthly_review', content: LONG_REVIEW },
          { role: 'assistant', type: 'top_recommendation', content: 'Move $100 into your property tax fund.' },
        ],
        created_at: '2026-08-01T00:00:00Z',
      },
      error: null,
    }],
    recurring_items: [{ count: 0, error: null }, { count: 0, error: null }],
  };
}

const PRO = { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null };
const FREE = { data: { subscription_status: null, subscription_current_period_end: null, comp_until: null }, error: null };
const COMPED = { data: { subscription_status: null, subscription_current_period_end: null, comp_until: '2099-11-01' }, error: null };
const UNREADABLE = { data: null, error: { message: 'boom' } };

async function getDashboard() {
  const { GET } = await import('../route');
  return GET(new Request('http://localhost/api/dashboard'));
}

async function runWith(entitlement: Resolution) {
  const client = makeSupabaseMock(scriptWith(entitlement));
  const { createClient } = await import('@/lib/supabase-server');
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  const res = await getDashboard();
  return { res, json: await res.json() };
}

describe('dashboard review gating', () => {
  beforeEach(() => { vi.resetModules(); });

  it('a PRO household gets the full review, unlocked', async () => {
    const { res, json } = await runWith(PRO);
    expect(res.status).toBe(200);
    expect(json.review).toBe(LONG_REVIEW);
    expect(json.reviewLocked).toBe(false);
    expect(json.isPro).toBe(true);
  });

  it('a COMPED household gets the full review — comps are entitlement, not a discount', async () => {
    const { json } = await runWith(COMPED);
    expect(json.review).toBe(LONG_REVIEW);
    expect(json.reviewLocked).toBe(false);
  });

  it('a FREE household gets a preview, and the tail is ABSENT from the payload', async () => {
    const { json } = await runWith(FREE);

    expect(json.reviewLocked).toBe(true);
    expect(json.isPro).toBe(false);
    expect(json.review.length).toBeLessThan(LONG_REVIEW.length);
    // The assertion that matters. Not "hidden" — not present at all.
    expect(json.review).not.toContain('SECRET_TAIL');
    expect(JSON.stringify(json)).not.toContain('SECRET_TAIL');
  });

  it('the free preview still ends on a sentence boundary', async () => {
    const { json } = await runWith(FREE);
    expect(json.review).toMatch(/[.!?…]$/);
  });

  it('topRecommendation is NOT gated — it is the free tier’s daily value', async () => {
    const { json } = await runWith(FREE);
    expect(json.topRecommendation).toBe('Move $100 into your property tax fund.');
  });

  it('an unreadable household row fails CLOSED — preview, not full text', async () => {
    // Defaulting to Pro on a database error would give the product away on
    // exactly the failures nobody notices.
    const { json } = await runWith(UNREADABLE);
    expect(json.reviewLocked).toBe(true);
    expect(JSON.stringify(json)).not.toContain('SECRET_TAIL');
  });
});
