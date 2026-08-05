import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase-admin';
import { getStripe, stripeConfigured, cancelSubscription } from '@/lib/stripe';
import { subscriptionToColumns, type StripeSubscriptionLike } from '@/lib/stripeSubscriptionMap';

// ---------------------------------------------------------------------------
// POST /api/stripe/webhook — THE ONLY WRITER OF SUBSCRIPTION STATE.
//
// Nothing else in the application writes households.subscription_*. Checkout
// writes nothing; the success page reads only. That single-writer rule is what
// removes the checkout/webhook race entirely rather than mitigating it.
//
// FOUR THINGS THIS HAS TO SURVIVE:
//
// 1. FORGED REQUESTS. The endpoint is public and grants paid access, so the
//    signature check is the authentication. The RAW body is required — parsing
//    JSON first and re-serialising changes bytes and breaks verification.
//
// 2. DUPLICATE DELIVERY. Stripe retries for ~3 days until it gets a 2xx, and
//    can be replayed by hand from the dashboard. The handler INSERTS the event
//    id first; a unique violation means "already done" and returns 200. The
//    insert is the lock — there is no read-then-write window to lose.
//
// 3. OUT-OF-ORDER DELIVERY. Stripe does not guarantee order. Writes are
//    accepted only when the EVENT's own timestamp is newer than the last one
//    applied to that household. Last-writer-wins by event time, never by
//    arrival time.
//
// 4. A HOUSEHOLD THAT NO LONGER EXISTS. Deleted between checkout and delivery.
//    Retrying forever helps nobody, so the event is recorded and 200 returned —
//    but the subscription is CANCELLED first, because a subscription billing a
//    household that does not exist charges someone for nothing, every month,
//    until a human reads a log. The cancellation is recorded on the event row
//    so it is provable, not merely logged.
//
// ALWAYS RETURNS 2xx once the signature is valid. A non-2xx makes Stripe
// redeliver for three days, which turns one unhandled event into thousands.
// Failures are recorded in `last_error` on the event row instead.
// ---------------------------------------------------------------------------

/** Subscription-bearing events we act on. Anything else is recorded, not acted on. */
const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

type Outcome =
  | 'applied'
  | 'stale_ignored'
  | 'household_missing'
  | 'orphan_cancelled'
  | 'unhandled_type'
  | 'error';

/** Household id, from wherever this event type happens to carry it. */
function householdIdFrom(event: Stripe.Event): string | null {
  // Stripe types data.object as a union of ~80 resource types. Widening via
  // unknown is required because none of them carry an index signature.
  const obj = event.data.object as unknown as Record<string, unknown>;

  const meta = obj.metadata as Record<string, string> | undefined;
  if (meta?.household_id) return meta.household_id;

  // checkout.session.completed carries it here as well — both are set at
  // creation precisely because not every event type surfaces both.
  const ref = obj.client_reference_id;
  if (typeof ref === 'string' && ref) return ref;

  return null;
}

/** The subscription id this event concerns, if any. */
function subscriptionIdFrom(event: Stripe.Event): string | null {
  // Stripe types data.object as a union of ~80 resource types. Widening via
  // unknown is required because none of them carry an index signature.
  const obj = event.data.object as unknown as Record<string, unknown>;
  if (SUBSCRIPTION_EVENTS.has(event.type)) return (obj.id as string) ?? null;

  const sub = obj.subscription;
  if (typeof sub === 'string' && sub) return sub;
  if (sub && typeof sub === 'object' && 'id' in sub) return (sub as { id: string }).id;
  return null;
}

export async function POST(request: Request) {
  // --- 1. Signature -------------------------------------------------------
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeConfigured() || !secret) {
    console.error('Stripe webhook — not configured (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET)');
    // 503 rather than 200: nothing was processed, and Stripe SHOULD retry once
    // configuration is fixed.
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'missing_signature' }, { status: 400 });

  // Raw text, never request.json(). Re-serialising changes the bytes the
  // signature was computed over.
  const raw = await request.text();

  let event: Stripe.Event;
  const stripe = getStripe();
  try {
    event = stripe.webhooks.constructEvent(raw, signature, secret);
  } catch (err) {
    // Also the shape a mismatched secret takes — the `stripe listen` secret and
    // the dashboard endpoint's secret are different, and crossing them looks
    // exactly like an attack.
    console.error('Stripe webhook — signature verification failed:', (err as Error).message);
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
  }

  const admin = createAdminClient();
  const householdId = householdIdFrom(event);
  const eventCreatedAt = new Date(event.created * 1000).toISOString();

  // --- 2. Idempotency: insert FIRST ---------------------------------------
  const { error: insertErr } = await admin
    .from('stripe_webhook_events')
    .insert({
      id: event.id,
      type: event.type,
      household_id: householdId,
      event_created_at: eventCreatedAt,
    });

  if (insertErr) {
    // 23505 = unique_violation = we have already handled this event.
    if ((insertErr as { code?: string }).code === '23505') {
      return NextResponse.json({ received: true, duplicate: true });
    }
    console.error('Stripe webhook — could not record event, refusing to process:', event.id, insertErr);
    // Nothing was applied and nothing was recorded, so a retry is safe and
    // wanted — this is the one path that deliberately asks Stripe to try again.
    return NextResponse.json({ error: 'ledger_unavailable' }, { status: 503 });
  }

  const finish = async (outcome: Outcome, extra: Record<string, unknown> = {}) => {
    await admin
      .from('stripe_webhook_events')
      .update({ outcome, ...extra })
      .eq('id', event.id);
    return NextResponse.json({ received: true, outcome });
  };

  try {
    // --- 3. Only subscription events carry state we mirror -----------------
    if (!SUBSCRIPTION_EVENTS.has(event.type) && event.type !== 'checkout.session.completed') {
      // invoice.paid / invoice.payment_failed are subscribed for visibility.
      // The status change they imply always arrives as its own
      // customer.subscription.updated, so acting on them too would be a second
      // writer racing the first.
      return await finish('unhandled_type');
    }

    if (!householdId) {
      console.error('Stripe webhook — event carries no household_id:', event.id, event.type);
      return await finish('error', { last_error: 'no household_id in metadata or client_reference_id' });
    }

    // --- 4. Does the household still exist? --------------------------------
    const { data: household } = await admin
      .from('households')
      .select('id, subscription_updated_at')
      .eq('id', householdId)
      .maybeSingle();

    if (!household) {
      // Deleted between checkout and delivery. Cancel the subscription rather
      // than leaving it billing a household that is gone — the same reasoning
      // as Case A's cancel-before-cascade, arriving from the other direction.
      const subId = subscriptionIdFrom(event);
      if (!subId) {
        console.error('Stripe webhook — household gone and no subscription to cancel:', event.id, householdId);
        return await finish('household_missing', { last_error: 'household missing; no subscription id on event' });
      }

      console.error(
        'Stripe webhook — ORPHAN SUBSCRIPTION: household %s no longer exists; cancelling %s (event %s)',
        householdId, subId, event.id
      );

      try {
        await cancelSubscription(subId);
        return await finish('orphan_cancelled', {
          orphan_subscription_id: subId,
          orphan_cancelled_at: new Date().toISOString(),
        });
      } catch (cancelErr) {
        // Recorded with the subscription id and NO cancelled_at — which is
        // exactly what the ops query looks for: a subscription still billing a
        // household that does not exist.
        console.error('Stripe webhook — ORPHAN CANCEL FAILED, still billing:', subId, cancelErr);
        return await finish('household_missing', {
          orphan_subscription_id: subId,
          last_error: `orphan cancel failed: ${(cancelErr as Error).message}`,
        });
      }
    }

    // --- 5. Ordering guard --------------------------------------------------
    const lastApplied = household.subscription_updated_at as string | null;
    if (lastApplied && Date.parse(lastApplied) >= Date.parse(eventCreatedAt)) {
      // An older event arrived after a newer one. Applying it would roll state
      // backwards — restoring `active` over a `canceled`, for instance.
      return await finish('stale_ignored');
    }

    // --- 6. Resolve the full subscription object ---------------------------
    // checkout.session.completed carries only an id, and its
    // customer.subscription.created may arrive before or after. Retrieving the
    // live object makes this handler correct regardless of which lands first.
    let subscription: StripeSubscriptionLike | null = null;

    if (SUBSCRIPTION_EVENTS.has(event.type)) {
      subscription = event.data.object as unknown as StripeSubscriptionLike;
    } else {
      const subId = subscriptionIdFrom(event);
      if (!subId) return await finish('unhandled_type', { last_error: 'checkout session had no subscription' });
      subscription = (await stripe.subscriptions.retrieve(subId)) as unknown as StripeSubscriptionLike;
    }

    // --- 7. Write. Wholesale, never patched --------------------------------
    const columns = subscriptionToColumns(subscription);

    const { error: writeErr } = await admin
      .from('households')
      .update({ ...columns, subscription_updated_at: eventCreatedAt })
      .eq('id', householdId);

    if (writeErr) {
      console.error('Stripe webhook — state write failed:', event.id, writeErr);
      return await finish('error', { last_error: `write failed: ${writeErr.message ?? String(writeErr)}` });
    }

    return await finish('applied');
  } catch (err) {
    console.error('Stripe webhook — handler threw:', event.id, err);
    // Still 2xx: the event is recorded with its error, and three days of
    // redelivery would not fix a bug in this handler.
    return await finish('error', { last_error: (err as Error).message ?? String(err) });
  }
}
