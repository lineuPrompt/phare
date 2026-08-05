import { describe, it, expect, vi, beforeEach } from 'vitest';

// The guard here is stripe_customer_id, NOT isPro — and both directions of that
// distinction are load-bearing:
//   comped  → fully Pro, NO customer  → nothing to manage, must not call Stripe
//   lapsed  → not Pro, HAS a customer → must still reach invoices/resubscribe

type Resolution = { data?: unknown; error?: unknown };

let userRow: Resolution;
let householdRow: Resolution;
let portalCalls: Record<string, unknown>[] = [];
let configured = true;

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
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: () => ({ select: () => chain(userRow) }),
  }),
}));

vi.mock('@/lib/supabase-admin', () => ({
  createAdminClient: () => ({ from: () => ({ select: () => chain(householdRow) }) }),
}));

vi.mock('@/lib/stripe', () => ({
  stripeConfigured: () => configured,
  getStripe: () => ({
    billingPortal: {
      sessions: {
        create: async (args: Record<string, unknown>) => {
          portalCalls.push(args);
          return { url: 'https://billing.stripe.com/session/test' };
        },
      },
    },
  }),
}));

async function post(url = 'http://localhost/api/stripe/portal') {
  const { POST } = await import('../route');
  return POST(new Request(url, { method: 'POST' }));
}

describe('POST /api/stripe/portal', () => {
  beforeEach(() => {
    vi.resetModules();
    portalCalls = [];
    configured = true;
    userRow = { data: { household_id: 'hh1', role: 'owner' }, error: null };
    householdRow = { data: { stripe_customer_id: 'cus_123' }, error: null };
  });

  it('returns a portal url for an owner with a Stripe customer', async () => {
    const res = await post();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.url).toContain('billing.stripe.com');
    expect(portalCalls[0].customer).toBe('cus_123');
  });

  it('a LAPSED household still reaches the portal — it has a customer', async () => {
    // Not Pro any more, but invoice history and resubscribing must still work.
    const res = await post();
    expect(res.status).toBe(200);
  });

  it('a COMPED household is refused BEFORE Stripe is called', async () => {
    // comp_until grants Pro with no Stripe objects at all. Calling
    // sessions.create({ customer: null }) would throw; this returns a sentence.
    householdRow = { data: { stripe_customer_id: null }, error: null };

    const res = await post();
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('no_billing_account');
    expect(portalCalls).toEqual([]);
  });

  it('refuses a non-owner', async () => {
    userRow = { data: { household_id: 'hh1', role: 'member' }, error: null };
    const res = await post();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('owner_only');
    expect(portalCalls).toEqual([]);
  });

  it('requires authentication', async () => {
    userRow = { data: null, error: null };
    const res = await post();
    expect(res.status).toBe(400);
    expect(portalCalls).toEqual([]);
  });

  it('refuses cleanly when Stripe is not configured', async () => {
    configured = false;
    const res = await post();
    expect(res.status).toBe(503);
    expect(portalCalls).toEqual([]);
  });

  it('returns to the household page in the caller’s locale', async () => {
    await post('http://localhost/api/stripe/portal?locale=fr');
    expect(portalCalls[0].return_url).toContain('/fr/household');
    expect(portalCalls[0].return_url).toContain('portal=1');
  });

  it('defaults to English for an unknown locale', async () => {
    await post('http://localhost/api/stripe/portal?locale=de');
    expect(portalCalls[0].return_url).toContain('/en/household');
  });
});
