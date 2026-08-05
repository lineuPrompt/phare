import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// POST /api/stripe/checkout
//
// The rule this suite exists to pin: THIS ROUTE WRITES NOTHING to our database.
// Stripe often fires checkout.session.completed before the browser redirects
// back, so a route that also wrote state would race the webhook. One writer,
// no race — and the test asserts the absence directly rather than trusting the
// comment.
// ---------------------------------------------------------------------------

type Resolution = { data?: unknown; error?: unknown };

let writes: { table: string; method: string }[] = [];
let userRow: Resolution;
let householdRow: Resolution;
let entitlementRow: Resolution;
let stripeIsConfigured: boolean;
let createdSessions: Record<string, unknown>[] = [];
let sessionUrl: string | null;
let createThrows: boolean;

function chain(resolution: Resolution): unknown {
  return new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (r: (v: Resolution) => unknown) => Promise.resolve(resolution).then(r);
      return () => chain(resolution);
    },
  });
}

vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: 'owner@example.com' } } }) },
    from: (table: string) => ({
      select: () => {
        // entitlementServer asks households for the billing columns; the route
        // asks users for role/household.
        if (table === 'households') return chain(entitlementRow);
        if (table === 'users') return chain(userRow);
        return chain({ data: null, error: null });
      },
      insert: () => { writes.push({ table, method: 'insert' }); return chain({ error: null }); },
      update: () => { writes.push({ table, method: 'update' }); return chain({ error: null }); },
    }),
  }),
}));

vi.mock('@/lib/supabase-admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => chain(householdRow),
      insert: () => { writes.push({ table, method: 'insert' }); return chain({ error: null }); },
      update: () => { writes.push({ table, method: 'update' }); return chain({ error: null }); },
    }),
  }),
}));

vi.mock('@/lib/stripe', () => ({
  stripeConfigured: () => stripeIsConfigured,
  getStripe: () => ({
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          if (createThrows) throw new Error('stripe down');
          createdSessions.push(params);
          return { id: 'cs_test_1', url: sessionUrl };
        },
      },
    },
  }),
}));

async function checkout(body: unknown = { plan: 'monthly' }) {
  const { POST } = await import('../route');
  return POST(new Request('http://localhost/api/stripe/checkout', {
    method: 'POST',
    body: JSON.stringify(body),
  }));
}

const FREE = { data: { subscription_status: null, subscription_current_period_end: null, comp_until: null }, error: null };
const PRO = { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null };
const COMPED = { data: { subscription_status: null, subscription_current_period_end: null, comp_until: '2099-11-01' }, error: null };

describe('POST /api/stripe/checkout', () => {
  beforeEach(() => {
    vi.resetModules();
    writes = [];
    createdSessions = [];
    userRow = { data: { household_id: 'hh1', role: 'owner', email: 'owner@example.com' }, error: null };
    householdRow = { data: { stripe_customer_id: null, name: 'The Test Household' }, error: null };
    entitlementRow = FREE;
    stripeIsConfigured = true;
    sessionUrl = 'https://checkout.stripe.com/c/pay/cs_test_1';
    createThrows = false;
    process.env.STRIPE_PRICE_MONTHLY = 'price_monthly';
    process.env.STRIPE_PRICE_ANNUAL = 'price_annual';
  });

  it('returns the Stripe-hosted session URL', async () => {
    const res = await checkout({ plan: 'monthly' });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.url).toBe('https://checkout.stripe.com/c/pay/cs_test_1');
  });

  it('WRITES NOTHING to our database', async () => {
    // The single rule that makes the checkout/webhook race disappear.
    await checkout({ plan: 'monthly' });
    expect(writes).toEqual([]);
  });

  it('carries the household id on BOTH the session and the subscription', async () => {
    // The webhook must identify the household from several event types, and
    // not all of them carry both fields.
    await checkout({ plan: 'monthly' });
    const s = createdSessions[0];
    expect(s.client_reference_id).toBe('hh1');
    expect(s.metadata).toEqual({ household_id: 'hh1' });
    expect((s.subscription_data as { metadata: unknown }).metadata).toEqual({ household_id: 'hh1' });
  });

  it('selects the right price for each plan', async () => {
    await checkout({ plan: 'monthly' });
    expect((createdSessions[0].line_items as { price: string }[])[0].price).toBe('price_monthly');

    createdSessions = [];
    vi.resetModules();
    await checkout({ plan: 'annual' });
    expect((createdSessions[0].line_items as { price: string }[])[0].price).toBe('price_annual');
  });

  it('reuses an existing Stripe customer when the webhook recorded one', async () => {
    householdRow = { data: { stripe_customer_id: 'cus_123', name: 'X' }, error: null };
    await checkout();
    expect(createdSessions[0].customer).toBe('cus_123');
    expect(createdSessions[0].customer_email).toBeUndefined();
  });

  it('passes an email instead when there is no customer yet', async () => {
    // We never create the customer ourselves — that would be this route writing
    // billing state.
    await checkout();
    expect(createdSessions[0].customer_email).toBe('owner@example.com');
    expect(createdSessions[0].customer).toBeUndefined();
  });

  it('refuses a household that is already Pro', async () => {
    entitlementRow = PRO;
    const res = await checkout();
    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.code).toBe('already_pro');
    expect(createdSessions).toEqual([]);
  });

  it('refuses a COMPED household — they must never be charged for a gift', async () => {
    entitlementRow = COMPED;
    const res = await checkout();
    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.code).toBe('already_pro');
    expect(json.reason).toBe('comp');
    expect(createdSessions).toEqual([]);
  });

  it('is owner-only', async () => {
    userRow = { data: { household_id: 'hh1', role: 'member', email: 'm@example.com' }, error: null };
    const res = await checkout();
    expect(res.status).toBe(403);
    expect(createdSessions).toEqual([]);
  });

  it('requires authentication is enforced before anything else', async () => {
    const res = await checkout({ plan: 'nonsense' });
    // Bad plan is rejected first and cheaply — no Stripe call, no DB read.
    expect(res.status).toBe(400);
    expect(createdSessions).toEqual([]);
  });

  it('503s clearly when Stripe is not configured', async () => {
    stripeIsConfigured = false;
    const res = await checkout();
    const json = await res.json();
    expect(res.status).toBe(503);
    expect(json.code).toBe('stripe_unavailable');
  });

  it('503s when a price id is missing, rather than failing after the redirect', async () => {
    // Otherwise this surfaces as an opaque error on Stripe's hosted page, where
    // it looks like a payment failure rather than a configuration one.
    delete process.env.STRIPE_PRICE_ANNUAL;
    const res = await checkout({ plan: 'annual' });
    const json = await res.json();
    expect(res.status).toBe(503);
    expect(json.code).toBe('price_not_configured');
  });

  it('does not pretend to succeed when Stripe throws', async () => {
    createThrows = true;
    const res = await checkout();
    expect(res.status).toBe(500);
  });

  it('502s if Stripe returns a session with no URL', async () => {
    sessionUrl = null;
    const res = await checkout();
    const json = await res.json();
    expect(res.status).toBe(502);
    expect(json.code).toBe('no_session_url');
  });
});

describe('promotion codes', () => {
  // Same fixture reset as the main suite — resetModules alone leaves the shared
  // mock state from whichever test ran last.
  beforeEach(() => {
    vi.resetModules();
    writes = [];
    createdSessions = [];
    userRow = { data: { household_id: 'hh1', role: 'owner', email: 'owner@example.com' }, error: null };
    householdRow = { data: { stripe_customer_id: null, name: 'The Test Household' }, error: null };
    entitlementRow = FREE;
    stripeIsConfigured = true;
    sessionUrl = 'https://checkout.stripe.com/c/pay/cs_test_1';
    createThrows = false;
    process.env.STRIPE_PRICE_MONTHLY = 'price_monthly';
    process.env.STRIPE_PRICE_ANNUAL = 'price_annual';
  });

  it('enables the promotion-code field on the session', async () => {
    // Stripe HIDES the field entirely without this flag, so dashboard coupons
    // are unreachable with no hint that a code was meant to work.
    await checkout({ plan: 'monthly' });
    expect(createdSessions[0].allow_promotion_codes).toBe(true);
  });

  it('does not demand a card when the total is zero for the life of the sub', async () => {
    // Default is 'always', which asked for payment details on a 100%-off code.
    await checkout({ plan: 'monthly' });
    expect(createdSessions[0].payment_method_collection).toBe('if_required');
  });

  it('enables it for the annual plan too', async () => {
    await checkout({ plan: 'annual' });
    expect(createdSessions[0].allow_promotion_codes).toBe(true);
  });
});
