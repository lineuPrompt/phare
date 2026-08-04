import Stripe from 'stripe';

// ---------------------------------------------------------------------------
// The Stripe client.
//
// Built LAZILY, on first use, and never at module load. A module-level client
// would throw at import time on any deployment without STRIPE_SECRET_KEY —
// including today's, where no Stripe setup exists yet — and would take down
// every route that transitively imports it, most of which have nothing to do
// with billing.
//
// THIS THROWS WHEN THE KEY IS MISSING, deliberately. The alternative — return
// null and let callers skip — turns a misconfigured deployment into silent
// non-cancellation: a household gets deleted, its subscription keeps billing,
// and nothing anywhere records that it happened. Callers that can safely
// proceed without Stripe must decide that explicitly by checking whether there
// is anything to do FIRST (see stripeConfigured / the Case A deletion path),
// not by swallowing an error.
// ---------------------------------------------------------------------------

let cached: Stripe | null = null;

/** True when a Stripe client can be built. Lets a caller distinguish "nothing
 *  to do" from "cannot do it" before attempting anything irreversible. */
export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe {
  if (cached) return cached;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      'STRIPE_SECRET_KEY is not set. Any operation that would touch a real ' +
      'subscription must fail loudly rather than silently skip.'
    );
  }

  cached = new Stripe(key, {
    // Pin the API version. Stripe changes response shapes between versions, and
    // an account-level default that moves under us would alter what the webhook
    // reads without a single line of our code changing.
    //
    // This must match the version the installed SDK is built against — the types
    // are generated per-version, so a mismatch is a compile error rather than a
    // runtime surprise. Bump it and the `stripe` package together, never alone.
    apiVersion: '2026-07-29.dahlia',
    // Surfaces in the Stripe dashboard's request log, which is the first place
    // anyone looks when a payment question arrives.
    appInfo: { name: 'Phare', url: 'https://phare.money' },
  });
  return cached;
}

/**
 * Cancel a subscription immediately, tolerating the two harmless races.
 *
 * Returns `alreadyGone: true` when Stripe reports the subscription does not
 * exist or is already cancelled — both mean the desired end state is already
 * true, so the caller should proceed rather than retry forever. Any OTHER error
 * propagates, because "we could not reach Stripe" and "there is nothing to
 * cancel" must never be confused: the first has to stop a household deletion,
 * the second must not.
 */
export async function cancelSubscription(
  subscriptionId: string
): Promise<{ cancelled: boolean; alreadyGone: boolean }> {
  const stripe = getStripe();
  try {
    await stripe.subscriptions.cancel(subscriptionId);
    return { cancelled: true, alreadyGone: false };
  } catch (err) {
    const e = err as { code?: string; statusCode?: number; message?: string };
    // resource_missing → the subscription id is unknown to Stripe.
    // A 404 covers the same ground for older/edge responses.
    if (e.code === 'resource_missing' || e.statusCode === 404) {
      return { cancelled: false, alreadyGone: true };
    }
    // Stripe rejects cancelling an already-cancelled subscription. The end
    // state we want is already true, so this is success, not failure.
    if (typeof e.message === 'string' && /already canceled|already cancelled/i.test(e.message)) {
      return { cancelled: false, alreadyGone: true };
    }
    throw err;
  }
}
