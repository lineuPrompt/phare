// ---------------------------------------------------------------------------
// IS THIS HOUSEHOLD ENTITLED TO PRO, RIGHT NOW?
//
// Entitlement is DERIVED on every read and never stored. There is no `is_pro`
// column and there must not be one: a stored boolean is a cache of Stripe's
// state, and a cache of someone else's truth diverges silently — granting
// access nobody paid for, or taking back access somebody did. Computing it from
// the mirrored columns means there is nothing to drift.
//
// HOUSEHOLD-SCOPED. One subscription covers both members; there is no per-user
// entitlement anywhere in this file, and there should never be one.
//
// PURE. No Supabase client, no clock of its own — `now` is injected so the
// boundary cases (period end, comp expiry) are testable without fake timers.
// Callers pass the household row they already fetched.
// ---------------------------------------------------------------------------

/** The subset of `households` this decision depends on. */
export type EntitlementInput = {
  /** Stripe's own status string, mirrored by the webhook. Null until piece 5. */
  subscription_status?: string | null;
  /** When paid access ends. Null when there has never been a subscription. */
  subscription_current_period_end?: string | null;
  /**
   * Stripe's cancel_at_period_end. A mid-period cancellation keeps status
   * 'active' and sets this — so WITHOUT reading it, a cancelled household is
   * indistinguishable from a renewing one. The practical damage is not a
   * missing label: someone cancels, comes back, sees nothing changed, and
   * concludes the cancellation failed. Then they cancel again, or email
   * support, or dispute the charge.
   */
  subscription_cancel_at_period_end?: boolean | null;
  /** Founder-granted access, independent of Stripe entirely. YYYY-MM-DD. */
  comp_until?: string | null;

  // ── Apple (in-app purchase, 2026-10-16) ─────────────────────────────────
  // Mirrored by the server from Apple's verified signed data
  // (20261016010000_apple_subscription_columns.sql). Same doctrine as the
  // Stripe columns: copies of Apple's truth, never an is_pro flag.
  /** 'active' | 'expired' | 'billing_retry' | 'grace_period' | 'revoked' */
  apple_status?: string | null;
  /** When the current paid period ends (Apple's expiresDate). */
  apple_expires_at?: string | null;
  /** During a billing grace period, when access stops (gracePeriodExpiresDate). */
  apple_grace_period_expires_at?: string | null;
  /** false = renewal turned off: Pro until apple_expires_at, then not. */
  apple_auto_renew?: boolean | null;
};

export type EntitlementReason =
  | 'comp'
  | 'active'
  /** Paid and working, but will not renew. Still fully Pro until period end. */
  | 'active_ending'
  | 'grace_past_due'
  | 'cancelled_paid_through'
  /** Paid through Apple and renewing. */
  | 'apple_active'
  /** Paid through Apple, renewal turned off: Pro until the period ends. */
  | 'apple_ending'
  /** Apple is retrying a failed renewal inside its billing grace period. */
  | 'apple_grace'
  | 'none';

export type Entitlement = {
  isPro: boolean;
  /** Why — for support ("they say they paid") and for the upgrade UI's copy. */
  reason: EntitlementReason;
};

/**
 * Stripe statuses that mean "this subscription is currently paying its way".
 *
 * `trialing` is Stripe's own trial, which we do not use today but which costs
 * nothing to honour and would otherwise deny access to a real paying customer
 * if it were ever switched on.
 *
 * NOTE what is absent: our own legacy `'trial'` value. Every household created
 * before billing existed defaults to subscription_status='trial' with no expiry,
 * so honouring it would silently make every existing household Pro forever.
 * Comped families are covered by comp_until instead, which is exactly why comps
 * were kept out of this column.
 */
const PAYING_STATUSES = new Set(['active', 'trialing']);

/**
 * `past_due` means a renewal charge failed and Stripe's dunning is running.
 *
 * Treated as ENTITLED until the period end, deliberately. Dropping someone the
 * instant a card expires punishes the most common, least culpable failure in
 * subscription billing — an expired card on a household that fully intends to
 * pay — and Stripe will retry for days before giving up. The grace is bounded
 * by current_period_end, so this cannot become indefinite free access.
 */
const GRACE_STATUSES = new Set(['past_due']);

/**
 * Statuses where Stripe keeps the subscription alive to the end of a period the
 * customer already paid for. The Terms promise exactly this, so reading
 * `cancelled` as "no access" would break them in the customer's disfavour.
 *
 * In practice Stripe reports a mid-period cancellation as status='active' with
 * cancel_at_period_end=true — which the `active` branch already handles — but
 * our own legacy enum also allows the literal string 'cancelled', so both are
 * honoured while a period end is still in the future.
 */
const PAID_THROUGH_STATUSES = new Set(['canceled', 'cancelled']);

/** Parses a timestamp defensively — a malformed value must not grant access. */
function isFuture(value: string | null | undefined, now: Date): boolean {
  if (!value) return false;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return false;
  return ms > now.getTime();
}

/**
 * Is a comp still running?
 *
 * comp_until is a DATE, and the household keeps access for the WHOLE of that
 * day — compared date-to-date rather than as an instant, so a comp ending
 * '2027-11-01' does not silently expire at midnight UTC while it is still
 * 2027-11-01 for the family. Erring toward the household on a boundary is the
 * right direction for a gift.
 */
function compActive(compUntil: string | null | undefined, now: Date): boolean {
  if (!compUntil) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(compUntil)) return false;
  const today = now.toISOString().slice(0, 10);
  return compUntil >= today;
}

/**
 * The single entitlement decision. Every gate in the app reads this and nothing
 * else, so there is exactly one place where "is this household Pro" is answered.
 */
export function entitlementFor(
  household: EntitlementInput | null | undefined,
  now: Date = new Date()
): Entitlement {
  if (!household) return { isPro: false, reason: 'none' };

  // Comp is checked FIRST and short-circuits everything. A comped household has
  // no Stripe objects at all, so no billing state can contradict this.
  if (compActive(household.comp_until, now)) {
    return { isPro: true, reason: 'comp' };
  }

  // Stripe, then Apple. Either one is enough; Stripe is asked first only so a
  // household that somehow pays through both reads with its Stripe sentence.
  return stripeEntitlement(household, now) ?? appleEntitlement(household, now) ?? { isPro: false, reason: 'none' };
}

/** The Stripe path, or null when Stripe grants nothing. */
function stripeEntitlement(household: EntitlementInput, now: Date): Entitlement | null {
  const status = household.subscription_status ?? null;
  const paidThrough = isFuture(household.subscription_current_period_end, now);

  // Every remaining branch requires a period end in the future. Without one
  // there is nothing to be entitled by — including for `active`, which protects
  // against a stale row that says active long after Stripe moved on.
  if (!paidThrough) return null;

  if (status && PAYING_STATUSES.has(status)) {
    // Same entitlement, different sentence. The Terms promise access through
    // the paid period after cancelling; this is what lets the UI say so.
    return {
      isPro: true,
      reason: household.subscription_cancel_at_period_end === true ? 'active_ending' : 'active',
    };
  }
  if (status && GRACE_STATUSES.has(status)) return { isPro: true, reason: 'grace_past_due' };
  if (status && PAID_THROUGH_STATUSES.has(status)) {
    return { isPro: true, reason: 'cancelled_paid_through' };
  }
  return null;
}

/**
 * The Apple path, or null when Apple grants nothing.
 *
 * Apple's own statuses decide, each bounded by a date in the future, so a
 * stale row can never mean access for ever:
 *   - active        → Pro until apple_expires_at. Renewal turned off is still
 *                     Pro until then (apple_ending), as Apple promises the
 *                     customer.
 *   - grace_period  → Pro until apple_grace_period_expires_at. Apple keeps
 *                     service on while it retries the card; the same choice
 *                     Stripe's past_due grace makes.
 *   - billing_retry → NOT Pro. Apple is retrying without a grace period, and
 *                     Apple itself treats this as no service.
 *   - expired, revoked (refunded or family-sharing removed), anything else
 *                   → NOT Pro.
 * The sandbox is not gated here: TestFlight and App Review buy in it.
 */
function appleEntitlement(household: EntitlementInput, now: Date): Entitlement | null {
  const status = household.apple_status ?? null;
  if (status === 'active' && isFuture(household.apple_expires_at, now)) {
    return { isPro: true, reason: household.apple_auto_renew === false ? 'apple_ending' : 'apple_active' };
  }
  if (status === 'grace_period' && isFuture(household.apple_grace_period_expires_at, now)) {
    return { isPro: true, reason: 'apple_grace' };
  }
  return null;
}

/** Convenience for the common call site. */
export function isPro(household: EntitlementInput | null | undefined, now?: Date): boolean {
  return entitlementFor(household, now).isPro;
}

// ---------------------------------------------------------------------------
// WHAT PRO ACTUALLY UNLOCKS AT LAUNCH.
//
// Only shipped, genuinely-gated functionality. Named here so the routes, the UI
// and the landing page cannot drift apart about what was sold.
//
// Deliberately NOT included:
//   - CSV export. The Privacy Policy commits to it as a Law 25 portability
//     right; gating it would contradict a legal document.
//   - Canadian (RRSP/RESP/TFSA) guidance. Real, but it rides inside the
//     onboarding plan the FREE tier already receives, so it is not a
//     differentiator and must not be sold as one.
//   - Budget alerts, AI coach, screenshot import. Not built.
// ---------------------------------------------------------------------------

// HORIZON_MONTHS_FREE / HORIZON_MONTHS_PRO moved to @phare/core (2026-10-17),
// shared with the app's Phare Pro screen. Re-exported so no import site changed.
import { HORIZON_MONTHS_FREE, HORIZON_MONTHS_PRO } from '@phare/core';
export { HORIZON_MONTHS_FREE, HORIZON_MONTHS_PRO };

/** Review regenerations per calendar month. Enforced in piece 7, not yet. */
export const REGENERATIONS_PER_MONTH_FREE = 0;
export const REGENERATIONS_PER_MONTH_PRO = 4;

export function horizonMonthsFor(household: EntitlementInput | null | undefined, now?: Date): number {
  return isPro(household, now) ? HORIZON_MONTHS_PRO : HORIZON_MONTHS_FREE;
}

/**
 * The LAST month (YYYY-MM) a household may navigate to, counting the current
 * month as month 1 — free: current + 2, Pro: current + 11.
 *
 * ONE function for every navigable surface. The Timeline and the Cards page
 * both call this, so the two can never sell a different horizon: before
 * 2026-09-11 Cards had its own flat +11 and a free household saw eleven
 * forward months of card plan while its Timeline stopped at three.
 */
export function entitledHorizonEndMonth(currentMonth: string, pro: boolean): string {
  const count = pro ? HORIZON_MONTHS_PRO : HORIZON_MONTHS_FREE;
  const [y, m] = currentMonth.split('-').map(Number);
  const idx = (m - 1) + (count - 1);
  return `${y + Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}
