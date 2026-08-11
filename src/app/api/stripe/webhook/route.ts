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
// 3. OUT-OF-ORDER DELIVERY — AND EVENTS THAT CANNOT BE ORDERED AT ALL.
//    Stripe does not guarantee order, and `event.created` has only SECOND
//    resolution. A Portal cancellation emits TWO customer.subscription.updated
//    events bearing the same second, so no comparison of event timestamps can
//    order them: one carries the pre-cancellation snapshot and one carries the
//    flag, and which arrives first is a coin flip. That is not hypothetical —
//    it shipped, and it wrote cancel_at_period_end=false over a real
//    cancellation.
//
//    So THE EVENT PAYLOAD IS NEVER TRUSTED FOR STATE. The handler re-retrieves
//    the subscription from Stripe and writes what Stripe says NOW. Ordering
//    stops deciding correctness entirely: whichever of the two events applies
//    first reads the same live object, so both orders produce the same row.
//
//    The ordering guard is kept, but only for what it is actually good for —
//    skipping redundant work. It no longer has to be right for the state to be
//    right, which is the only reason it is safe to keep a guard that cannot
//    distinguish two events in the same second.
//
// 4. A HOUSEHOLD THAT NO LONGER EXISTS. Deleted between checkout and delivery.
//    Retrying forever helps nobody, so the event is recorded and 200 returned —
//    but the subscription is CANCELLED first, because a subscription billing a
//    household that does not exist charges someone for nothing, every month,
//    until a human reads a log. The cancellation is recorded on the event row
//    so it is provable, not merely logged.
//
// RETURNS 2xx once the signature is valid, EXCEPT where redelivery is the
// remedy. A non-2xx makes Stripe redeliver for three days, which turns one
// unhandled event into thousands, so a bug in this handler is recorded in
// `last_error` and answered 200. The two exceptions are the cases where we
// applied nothing and a retry genuinely fixes it: the ledger being unavailable,
// and a failed retrieve (see RETRYABLE_OUTCOMES).
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
  | 'retrieve_failed'
  | 'error';

/**
 * Outcomes that mean "we recorded the event but never reached a verdict".
 *
 * These exist because the idempotency insert is a LOCK, not a record of
 * success. Once the row is inserted, a redelivery hits the unique violation and
 * would normally be answered 200/duplicate — which is correct for an event we
 * finished, and catastrophic for one we abandoned. Returning 503 to ask Stripe
 * to retry would be a lie: the retry would arrive, see the row, and be swallowed
 * as a duplicate, stranding the household on stale state forever.
 *
 * So an abandoned attempt is recorded with an outcome listed here, and the
 * duplicate branch reprocesses exactly those.
 */
const RETRYABLE_OUTCOMES = new Set<string>(['retrieve_failed']);

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

  if (insertErr && (insertErr as { code?: string }).code === '23505') {
    // 23505 = unique_violation = this event id is already in the ledger.
    //
    // Usually that means we finished it and must not repeat the work. But it
    // ALSO covers an attempt that recorded the event and then abandoned it —
    // a retrieve that failed, where we deliberately asked Stripe to redeliver.
    // Answering `duplicate` there would swallow the very retry we requested.
    const { data: prior } = await admin
      .from('stripe_webhook_events')
      .select('outcome')
      .eq('id', event.id)
      .maybeSingle();

    const priorOutcome = (prior?.outcome ?? null) as string | null;
    if (!priorOutcome || !RETRYABLE_OUTCOMES.has(priorOutcome)) {
      // A NULL outcome means another delivery is in flight right now. That is
      // not abandoned work, so it must not be reprocessed concurrently.
      return NextResponse.json({ received: true, duplicate: true });
    }

    console.warn('Stripe webhook — reprocessing an abandoned event (%s):', priorOutcome, event.id);
    // Fall through and process it properly this time.
  } else if (insertErr) {
    console.error('Stripe webhook — could not record event, refusing to process:', event.id, insertErr);
    // Nothing was applied and nothing was recorded, so a retry is safe and
    // wanted — this is the one path that deliberately asks Stripe to try again.
    return NextResponse.json({ error: 'ledger_unavailable' }, { status: 503 });
  }

  const finish = async (outcome: Outcome, extra: Record<string, unknown> = {}, status = 200) => {
    await admin
      .from('stripe_webhook_events')
      .update({ outcome, ...extra })
      .eq('id', event.id);
    return NextResponse.json({ received: true, outcome }, { status });
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

    // --- 5. Ordering guard — now an OPTIMISATION, not a correctness control --
    //
    // It runs before the retrieve so a redundant event costs no Stripe call.
    // What it must NOT do is decide what gets stored: it compares timestamps of
    // second resolution, so it cannot order two events from the same second and
    // will drop one of them arbitrarily. That is now harmless, because whichever
    // sibling survives retrieves the same live subscription.
    //
    // Deliberately still `>=` rather than `>`. Widening it would let a genuinely
    // stale same-second event through in the other direction, trading a bug we
    // have fixed for the state-rollback this guard exists to prevent.
    const lastApplied = household.subscription_updated_at as string | null;
    if (lastApplied && Date.parse(lastApplied) >= Date.parse(eventCreatedAt)) {
      return await finish('stale_ignored');
    }

    // --- 6. Resolve the subscription FROM STRIPE, never from the event ------
    //
    // The event tells us WHICH subscription changed. It does not tell us what
    // its state is — see hazard 3 above. Two events in the same second carry
    // two different snapshots and cannot be ordered, so a payload is only ever
    // "some state this subscription had recently", which is not what we store.
    //
    // Retrieving costs one GET per subscription event, against a subscription
    // that generates roughly one event a month. That is the entire price of
    // making delivery order irrelevant to correctness.
    const subId = subscriptionIdFrom(event);
    if (!subId) {
      return await finish('unhandled_type', { last_error: 'event carried no subscription id' });
    }

    let subscription: StripeSubscriptionLike;
    try {
      subscription = (await stripe.subscriptions.retrieve(subId)) as unknown as StripeSubscriptionLike;
    } catch (err) {
      const e = err as { code?: string; statusCode?: number; message?: string };

      // Terminal: the subscription does not exist at Stripe. Three days of
      // redelivery cannot conjure it, so record it and stop. Distinguishing
      // this from "cannot reach Stripe" is the same rule cancelSubscription
      // follows, and for the same reason.
      if (e.code === 'resource_missing' || e.statusCode === 404) {
        console.error('Stripe webhook — subscription not found at Stripe:', subId, event.id);
        return await finish('error', {
          last_error: `subscription ${subId} not found at Stripe; nothing to mirror`,
        });
      }

      // Transient: Stripe is down, rate limiting, or timing out — and the SDK
      // has ALREADY retried twice internally before throwing. We do not know
      // the current state, so we write nothing and ask for redelivery.
      //
      // Falling back to the event payload here is the one thing we must not do:
      // it would reintroduce exactly the cancellation bug this design removes,
      // and only under Stripe degradation — the conditions least likely to be
      // reproduced before a customer is billed wrongly.
      console.error('Stripe webhook — retrieve failed, asking for redelivery:', subId, event.id, err);
      return await finish(
        'retrieve_failed',
        { last_error: `retrieve failed: ${e.message ?? String(err)}` },
        503
      );
    }

    // --- 7. Write. Wholesale, never patched --------------------------------
    const columns = subscriptionToColumns(subscription);

    // --- TEMPORARY DIAGNOSTIC — REMOVE once the cancellation flag is proven --
    //
    // Prints what Stripe ACTUALLY returned beside what we are about to store,
    // for one cancellation. It exists because the remaining hypothesis cannot
    // be settled from the type definitions: `cancel_at_period_end` is still
    // declared on Subscription in the pinned API version, but a field being
    // declared does not mean the Customer Portal SETS it. This version also
    // added `billing_schedules`, whose bill_until.computed_timestamp could
    // express "cancels Sep 11" without the boolean ever flipping.
    //
    // So every candidate location is printed, and fields are marked ABSENT
    // rather than coerced to null — "absent" and "present but false" point at
    // completely different bugs, and collapsing them is what hid the original
    // current_period_end move.
    //
    // Single-line JSON so the log viewer keeps it as one entry.
    const rawSub = subscription as unknown as Record<string, unknown>;
    const at = (k: string) => (k in rawSub ? rawSub[k] : '<<ABSENT>>');
    console.log('Stripe webhook — RETRIEVED [v2] ' + JSON.stringify({
      event: event.id,
      type: event.type,
      subId,
      status: at('status'),
      cancel_at_period_end: at('cancel_at_period_end'),
      cancel_at: at('cancel_at'),
      canceled_at: at('canceled_at'),
      cancellation_details: at('cancellation_details'),
      billing_schedules: at('billing_schedules'),
      schedule: at('schedule'),
      item_period_end: subscription.items?.data?.[0]?.current_period_end ?? '<<ABSENT>>',
      WROTE_cancel_at_period_end: columns.subscription_cancel_at_period_end,
      WROTE_period_end: columns.subscription_current_period_end,
      WROTE_status: columns.subscription_status,
    }));
    // --- end temporary diagnostic -------------------------------------------

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
