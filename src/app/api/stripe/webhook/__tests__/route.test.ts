import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// POST /api/stripe/webhook — the only writer of subscription state.
//
// Four hazards, each with its own group below: forged requests, duplicate
// delivery, out-of-order delivery, and a household deleted mid-flight.
// ---------------------------------------------------------------------------

type Resolution = { data?: unknown; error?: unknown };

let inserted: Record<string, unknown>[] = [];
let eventUpdates: Record<string, unknown>[] = [];
let householdUpdates: Record<string, unknown>[] = [];
let householdRow: Resolution;
let insertResult: Resolution;
let cancelledSubs: string[] = [];
let cancelThrows = false;
let constructThrows = false;
let currentEvent: Record<string, unknown>;
let retrievedSub: Record<string, unknown> | null;

function chain(resolution: Resolution): unknown {
  return new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (r: (v: Resolution) => unknown) => Promise.resolve(resolution).then(r);
      return () => chain(resolution);
    },
  });
}

vi.mock('@/lib/supabase-admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      insert: (payload: Record<string, unknown>) => {
        if (table === 'stripe_webhook_events') inserted.push(payload);
        return chain(insertResult);
      },
      update: (payload: Record<string, unknown>) => {
        if (table === 'stripe_webhook_events') eventUpdates.push(payload);
        if (table === 'households') householdUpdates.push(payload);
        return chain({ error: null });
      },
      select: () => chain(householdRow),
    }),
  }),
}));

vi.mock('@/lib/stripe', () => ({
  stripeConfigured: () => true,
  cancelSubscription: async (id: string) => {
    if (cancelThrows) throw new Error('stripe down');
    cancelledSubs.push(id);
    return { cancelled: true, alreadyGone: false };
  },
  getStripe: () => ({
    webhooks: {
      constructEvent: () => {
        if (constructThrows) throw new Error('No signatures found matching the expected signature');
        return currentEvent;
      },
    },
    subscriptions: {
      retrieve: async () => retrievedSub,
    },
  }),
}));

const FUTURE = Math.floor(new Date('2099-01-01T00:00:00Z').getTime() / 1000);

function subObject(over: Record<string, unknown> = {}) {
  return {
    id: 'sub_123',
    status: 'active',
    cancel_at_period_end: false,
    customer: 'cus_123',
    metadata: { household_id: 'hh1' },
    items: { data: [{ current_period_end: FUTURE, price: { id: 'price_monthly' } }] },
    ...over,
  };
}

function makeEvent(type: string, object: Record<string, unknown>, createdIso = '2026-08-05T10:00:00Z') {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type,
    created: Math.floor(new Date(createdIso).getTime() / 1000),
    data: { object },
  };
}

async function post() {
  const { POST } = await import('../route');
  return POST(new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 't=1,v1=deadbeef' },
    body: '{"raw":"body"}',
  }));
}

describe('stripe webhook', () => {
  beforeEach(() => {
    vi.resetModules();
    inserted = [];
    eventUpdates = [];
    householdUpdates = [];
    cancelledSubs = [];
    cancelThrows = false;
    constructThrows = false;
    insertResult = { error: null };
    householdRow = { data: { id: 'hh1', subscription_updated_at: null }, error: null };
    retrievedSub = subObject();
    currentEvent = makeEvent('customer.subscription.updated', subObject());
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  });

  // --- 1. forged requests -------------------------------------------------

  it('rejects a bad signature with 400 and writes nothing', async () => {
    constructThrows = true;
    const res = await post();
    expect(res.status).toBe(400);
    expect(inserted).toEqual([]);
    expect(householdUpdates).toEqual([]);
  });

  it('rejects a missing signature header', async () => {
    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/stripe/webhook', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(400);
    expect(inserted).toEqual([]);
  });

  // --- 2. duplicate delivery ----------------------------------------------

  it('records the event id BEFORE processing', async () => {
    await post();
    expect(inserted[0].id).toBe(currentEvent.id);
    expect(inserted[0].type).toBe('customer.subscription.updated');
    expect(inserted[0].household_id).toBe('hh1');
  });

  it('a duplicate (unique violation) returns 200 and applies nothing', async () => {
    // Stripe retries for ~3 days and can be replayed by hand. Re-applying a
    // subscription.deleted after a re-subscribe would revoke paid access.
    insertResult = { error: { code: '23505', message: 'duplicate key' } };
    const res = await post();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.duplicate).toBe(true);
    expect(householdUpdates).toEqual([]);
  });

  it('asks Stripe to RETRY (503) if the ledger itself is unavailable', async () => {
    // The one path where redelivery is wanted: nothing was recorded and nothing
    // applied, so a retry is safe.
    insertResult = { error: { code: '08006', message: 'connection failure' } };
    const res = await post();
    expect(res.status).toBe(503);
    expect(householdUpdates).toEqual([]);
  });

  // --- 3. out-of-order delivery -------------------------------------------

  it('applies an event newer than the last one', async () => {
    householdRow = { data: { id: 'hh1', subscription_updated_at: '2026-08-05T09:00:00Z' }, error: null };
    currentEvent = makeEvent('customer.subscription.updated', subObject(), '2026-08-05T10:00:00Z');

    await post();
    expect(householdUpdates).toHaveLength(1);
    expect(householdUpdates[0].subscription_updated_at).toBe('2026-08-05T10:00:00.000Z');
  });

  it('IGNORES an event older than the last applied — state never rolls backwards', async () => {
    // The concrete hazard: a stale `active` landing after a `canceled` would
    // hand out access nobody is paying for.
    householdRow = { data: { id: 'hh1', subscription_updated_at: '2026-08-05T12:00:00Z' }, error: null };
    currentEvent = makeEvent('customer.subscription.updated', subObject(), '2026-08-05T10:00:00Z');

    const res = await post();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.outcome).toBe('stale_ignored');
    expect(householdUpdates).toEqual([]);
  });

  it('an identical timestamp is treated as already applied', async () => {
    householdRow = { data: { id: 'hh1', subscription_updated_at: '2026-08-05T10:00:00.000Z' }, error: null };
    currentEvent = makeEvent('customer.subscription.updated', subObject(), '2026-08-05T10:00:00Z');
    await post();
    expect(householdUpdates).toEqual([]);
  });

  // --- 4. deleted household -----------------------------------------------

  it('AUTO-CANCELS the subscription when the household is gone', async () => {
    // A subscription billing a household that does not exist charges someone
    // every month until a human reads a log.
    householdRow = { data: null, error: null };

    const res = await post();
    const json = await res.json();

    expect(res.status).toBe(200);                 // never make Stripe retry for 3 days
    expect(json.outcome).toBe('orphan_cancelled');
    expect(cancelledSubs).toEqual(['sub_123']);
    expect(householdUpdates).toEqual([]);
  });

  it('records the cancellation so it is PROVABLE, not merely logged', async () => {
    householdRow = { data: null, error: null };
    await post();

    const rec = eventUpdates.find((u) => u.orphan_subscription_id);
    expect(rec).toBeTruthy();
    expect(rec!.orphan_subscription_id).toBe('sub_123');
    expect(rec!.orphan_cancelled_at).toBeTruthy();
    expect(rec!.outcome).toBe('orphan_cancelled');
  });

  it('a FAILED orphan cancel records the subscription id with NO cancelled_at', async () => {
    // Exactly what the ops query looks for: a subscription still billing a
    // household that no longer exists.
    householdRow = { data: null, error: null };
    cancelThrows = true;

    const res = await post();
    expect(res.status).toBe(200);

    const rec = eventUpdates.find((u) => u.orphan_subscription_id);
    expect(rec!.orphan_subscription_id).toBe('sub_123');
    expect(rec!.orphan_cancelled_at).toBeUndefined();
    expect(String(rec!.last_error)).toContain('orphan cancel failed');
  });

  // --- state mapping ------------------------------------------------------

  it('writes the period end from the ITEM, so the household actually reads as Pro', async () => {
    await post();
    expect(householdUpdates[0].subscription_current_period_end).toBe('2099-01-01T00:00:00.000Z');
    expect(householdUpdates[0].subscription_status).toBe('active');
    expect(householdUpdates[0].stripe_subscription_id).toBe('sub_123');
    expect(householdUpdates[0].stripe_customer_id).toBe('cus_123');
    expect(householdUpdates[0].plan_price_id).toBe('price_monthly');
  });

  it('checkout.session.completed retrieves the live subscription', async () => {
    // The session carries only an id, and its subscription.created may arrive
    // either side of it. Retrieving makes the handler order-independent.
    currentEvent = makeEvent('checkout.session.completed', {
      id: 'cs_1',
      subscription: 'sub_123',
      client_reference_id: 'hh1',
    });
    retrievedSub = subObject();

    await post();
    expect(householdUpdates).toHaveLength(1);
    expect(householdUpdates[0].subscription_status).toBe('active');
  });

  it('reads household_id from client_reference_id when metadata is absent', async () => {
    currentEvent = makeEvent('checkout.session.completed', {
      id: 'cs_1', subscription: 'sub_123', client_reference_id: 'hh1',
    });
    await post();
    expect(inserted[0].household_id).toBe('hh1');
  });

  it('an unsubscribed event type is recorded but not acted on', async () => {
    // invoice.paid implies a status change, but that always arrives as its own
    // subscription.updated — acting here too would be a second writer.
    currentEvent = makeEvent('invoice.paid', { id: 'in_1', subscription: 'sub_123', metadata: { household_id: 'hh1' } });
    const res = await post();
    const json = await res.json();

    expect(json.outcome).toBe('unhandled_type');
    expect(householdUpdates).toEqual([]);
  });

  it('never returns a non-2xx once the signature is valid', async () => {
    // A non-2xx makes Stripe redeliver for three days, turning one unhandled
    // event into thousands.
    currentEvent = makeEvent('customer.subscription.updated', subObject({ metadata: {} }));
    const res = await post();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.outcome).toBe('error');
  });
});
