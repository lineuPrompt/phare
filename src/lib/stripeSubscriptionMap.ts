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

// ---------------------------------------------------------------------------
// THE SECOND INSTANCE OF THE SAME TRAP — cancel_at_period_end.
//
// The boolean is still declared, and still non-optional, on Subscription in the
// pinned API version. It is simply NOT WHAT THE CUSTOMER PORTAL SETS. Cancelling
// through the Portal produces:
//
//   cancel_at_period_end: false
//   cancel_at:            1789144635   ← the period end, to the second
//   canceled_at:          1786477919
//   cancellation_details: { reason: 'cancellation_requested', ... }
//
// So reading the boolean returns `false` for a subscription Stripe's own Portal
// describes as "Cancels Sep 11, 2026". Worse than the current_period_end move:
// that one returned undefined, this one returns a plausible, wrong answer of
// the right type. Nothing can catch it except comparing against the truth.
//
// The lesson worth keeping: a field existing in the type definitions says
// nothing about whether the thing that changed the subscription actually writes
// it. Types describe what CAN be there, not what IS.
// ---------------------------------------------------------------------------

/** Only the shape we read. Structural, so tests need no Stripe fixtures. */
export type StripeSubscriptionLike = {
  id: string;
  status: string;
  cancel_at_period_end?: boolean | null;
  /** Unix seconds. The Portal's real cancellation signal — see above. */
  cancel_at?: number | null;
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
  return unixToIso(periodEndUnixFrom(sub));
}

/** The same value in Stripe's own units, so cancel_at can be compared to it
 *  without a round-trip through ISO strings. One source of truth for both. */
function periodEndUnixFrom(sub: StripeSubscriptionLike): number | null {
  const items = sub.items?.data ?? [];
  let max: number | null = null;
  for (const item of items) {
    const end = item?.current_period_end;
    if (typeof end === 'number' && Number.isFinite(end) && end > 0) {
      if (max === null || end > max) max = end;
    }
  }
  return max;
}

/**
 * What KIND of cancellation, if any, is scheduled on this subscription.
 *
 * Named rather than boolean because `cancel_at` conflates three genuinely
 * different futures, and flattening them is how a family gets told the wrong
 * thing:
 *
 *   at_period_end    cancel_at === the period end. The ordinary "cancel" — it
 *                    runs to the end of what they paid for, then stops.
 *   scheduled_early  cancel_at BEFORE the period end. Access stops mid-period.
 *                    Not reachable from the Portal; it comes from the Stripe
 *                    dashboard or the API. See the note in subscriptionToColumns.
 *   scheduled_later  cancel_at AFTER the period end. This subscription RENEWS at
 *                    least once more first, so "won't renew" would be a lie.
 *   none             no cancellation scheduled.
 *
 * Exact equality, not a tolerance window. Stripe sets cancel_at to the period
 * end to the second for a period-end cancellation, and a fuzzy match would
 * quietly reclassify a genuine early cancellation that happened to fall nearby.
 */
export type CancellationKind = 'none' | 'at_period_end' | 'scheduled_early' | 'scheduled_later';

export function cancellationKindFrom(sub: StripeSubscriptionLike): CancellationKind {
  // Still honoured wherever it is still set — the API sets it even though the
  // Portal does not, and this path is the one that already worked.
  if (sub.cancel_at_period_end === true) return 'at_period_end';

  const cancelAt = sub.cancel_at;
  if (typeof cancelAt !== 'number' || !Number.isFinite(cancelAt) || cancelAt <= 0) return 'none';

  const periodEnd = periodEndUnixFrom(sub);
  // No period end means entitlement already reads as not-Pro regardless of any
  // flag, so there is nothing to qualify and nothing to claim.
  if (periodEnd === null) return 'none';

  if (cancelAt === periodEnd) return 'at_period_end';
  return cancelAt < periodEnd ? 'scheduled_early' : 'scheduled_later';
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

  // ONLY `at_period_end` sets the flag.
  //
  // `scheduled_later` must not: that subscription renews at least once more, so
  // "won't renew" would be false.
  //
  // `scheduled_early` must not either — but it is NOT properly represented and
  // this is a known gap, not an oversight. The column pair we have can say "runs
  // out on <period end>" and nothing else; it cannot say "ends on a date that is
  // not the period end". Setting the flag would date the ending wrongly, and
  // leaving it clear says "renews" to somebody whose access stops sooner. Both
  // are lies; today we tell the smaller and safer one (access is over-stated
  // until the cancellation lands as its own event, never under-stated).
  //
  // Not reachable from the Customer Portal, which is the only cancellation route
  // Phare offers a family — it takes a Stripe dashboard action or a direct API
  // call. That is the whole reason it is acceptable to defer, and the condition
  // under which it stops being acceptable.
  //
  // ---------------------------------------------------------------------------
  // THE INTENDED REMEDY, decided 2026-08-11, deliberately not applied yet.
  // Apply it the moment early cancellation becomes reachable by a family —
  // e.g. a Portal configuration that offers a cancellation date, or any code
  // of ours that sets `cancel_at`. Do not re-derive this; it was argued once.
  //
  //   subscription_current_period_end: kind === 'scheduled_early'
  //     ? unixToIso(sub.cancel_at ?? null)   // the date access ACTUALLY ends
  //     : periodEndFrom(sub),
  //   subscription_cancel_at_period_end: kind === 'at_period_end'
  //     || kind === 'scheduled_early',
  //
  // Three lines, no migration. It works because this column is already the
  // "entitled until" date in everything that reads it — entitlement compares it
  // to now, and the household page prints it — and for every other kind it is
  // identical to the period end. Moving the DATE is what makes setting the flag
  // honest: "ends on <real date>, won't renew" is then true for both kinds, and
  // the family is told the date their access actually stops.
  //
  // Setting the flag WITHOUT moving the date is the one combination to avoid —
  // it dates the ending wrongly and cuts short something already paid for.
  // ---------------------------------------------------------------------------
  const kind = cancellationKindFrom(sub);

  return {
    stripe_subscription_id: sub.id,
    stripe_customer_id: customerIdFrom(sub),
    subscription_status: sub.status,
    subscription_current_period_end: periodEndFrom(sub),
    subscription_cancel_at_period_end: kind === 'at_period_end',
    plan_price_id: firstPrice,
  };
}
