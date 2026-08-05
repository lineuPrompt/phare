// ---------------------------------------------------------------------------
// Stripe Subscription  →  households billing columns.
//
// Pure and separated from the webhook route so the one genuinely dangerous
// detail in this whole build can be tested directly:
//
//   `current_period_end` IS NOT ON THE SUBSCRIPTION.
//
// Stripe REMOVED current_period_start/end from Subscription and moved them onto
// SubscriptionItem (confirmed in the installed SDK's own CHANGELOG for the
// version pinned in src/lib/stripe.ts). Reading the old location returns
// undefined — not an error, not a type failure at runtime — so
// subscription_current_period_end would be written as NULL.
//
// And entitlement REQUIRES a future period end. So that one silent undefined
// would make every paying customer read as free, on every request, with no
// error anywhere. It is the highest-consequence, lowest-visibility mistake
// available in this feature, which is why it lives in a tested function rather
// than inline in a route handler.
// ---------------------------------------------------------------------------

/** Only the shape we read. Structural, so tests need no Stripe fixtures. */
export type StripeSubscriptionLike = {
  id: string;
  status: string;
  cancel_at_period_end?: boolean | null;
  customer?: string | { id: string } | null;
  items?: {
    data?: Array<{
      current_period_end?: number | null;
      price?: { id?: string | null } | null;
    }>;
  } | null;
};

export type SubscriptionColumns = {
  stripe_subscription_id: string;
  stripe_customer_id: string | null;
  subscription_status: string;
  subscription_current_period_end: string | null;
  subscription_cancel_at_period_end: boolean;
  plan_price_id: string | null;
};

/** Unix seconds → ISO, defensively. Never turns a bad value into epoch zero. */
function unixToIso(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

/**
 * The period end for the subscription as a whole.
 *
 * Takes the MAXIMUM across items rather than the first. Phare sells a single
 * price today so there is only ever one item, but if that ever changes, the
 * household is entitled until the last item's period ends — taking the first
 * would cut access short, which is the direction that breaks the Terms.
 */
export function periodEndFrom(sub: StripeSubscriptionLike): string | null {
  const items = sub.items?.data ?? [];
  let max: number | null = null;
  for (const item of items) {
    const end = item?.current_period_end;
    if (typeof end === 'number' && Number.isFinite(end) && end > 0) {
      if (max === null || end > max) max = end;
    }
  }
  return unixToIso(max);
}

/** The customer id, which Stripe sends either expanded or as a bare string. */
export function customerIdFrom(sub: StripeSubscriptionLike): string | null {
  const c = sub.customer;
  if (!c) return null;
  return typeof c === 'string' ? c : (c.id ?? null);
}

/**
 * Maps the WHOLE subscription object to the columns it owns.
 *
 * Wholesale, never patched field-by-field: the founder's rule, and the reason
 * is ordering. If an older event updated only the fields it happened to carry,
 * a stale `status` could be written over a newer one while `period_end` stayed
 * current — leaving a row that describes a state that never existed. Taking
 * every column from one object keeps the row internally consistent even when
 * the object itself is stale (which the ordering guard then rejects wholesale).
 */
export function subscriptionToColumns(sub: StripeSubscriptionLike): SubscriptionColumns {
  const firstPrice = sub.items?.data?.[0]?.price?.id ?? null;
  return {
    stripe_subscription_id: sub.id,
    stripe_customer_id: customerIdFrom(sub),
    subscription_status: sub.status,
    subscription_current_period_end: periodEndFrom(sub),
    subscription_cancel_at_period_end: sub.cancel_at_period_end === true,
    plan_price_id: firstPrice,
  };
}
