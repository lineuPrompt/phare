import { describe, it, expect } from 'vitest';
import {
  subscriptionToColumns,
  periodEndFrom,
  customerIdFrom,
  cancellationKindFrom,
  type StripeSubscriptionLike,
} from '@/lib/stripeSubscriptionMap';
import { entitlementFor } from '@/lib/entitlement';

// ---------------------------------------------------------------------------
// The highest-consequence, lowest-visibility mistake in the payment build:
// current_period_end is on SubscriptionItem, NOT on Subscription, in the pinned
// API version. Reading the old place yields `undefined` — no error, no type
// failure at runtime — the column goes NULL, and every paying customer silently
// reads as free forever.
// ---------------------------------------------------------------------------

const FUTURE = Math.floor(new Date('2099-01-01T00:00:00Z').getTime() / 1000);

const sub = (over: Partial<StripeSubscriptionLike> = {}): StripeSubscriptionLike => ({
  id: 'sub_123',
  status: 'active',
  cancel_at_period_end: false,
  customer: 'cus_123',
  items: { data: [{ current_period_end: FUTURE, price: { id: 'price_monthly' } }] },
  ...over,
});

describe('periodEndFrom — the field that moved', () => {
  it('reads current_period_end from the ITEM', () => {
    expect(periodEndFrom(sub())).toBe('2099-01-01T00:00:00.000Z');
  });

  it('a top-level current_period_end is IGNORED — it does not exist any more', () => {
    // Simulates code written against the old API shape. If this ever returns a
    // date, someone has reintroduced the bug by reading the wrong place.
    const legacyShape = {
      ...sub({ items: { data: [{ price: { id: 'price_monthly' } }] } }),
      current_period_end: FUTURE,
    } as unknown as StripeSubscriptionLike;
    expect(periodEndFrom(legacyShape)).toBeNull();
  });

  it('takes the MAXIMUM across items, not the first', () => {
    // Cutting access at the earliest item would end entitlement before the
    // household stopped paying — the direction that breaks the Terms.
    const earlier = Math.floor(new Date('2098-01-01T00:00:00Z').getTime() / 1000);
    const s = sub({ items: { data: [
      { current_period_end: earlier, price: { id: 'p1' } },
      { current_period_end: FUTURE, price: { id: 'p2' } },
    ] } });
    expect(periodEndFrom(s)).toBe('2099-01-01T00:00:00.000Z');
  });

  it('missing / empty / malformed items give null, never epoch zero', () => {
    expect(periodEndFrom(sub({ items: null }))).toBeNull();
    expect(periodEndFrom(sub({ items: { data: [] } }))).toBeNull();
    expect(periodEndFrom(sub({ items: { data: [{ current_period_end: 0 }] } }))).toBeNull();
    expect(periodEndFrom(sub({ items: { data: [{ current_period_end: NaN }] } }))).toBeNull();
    // 1970 would be in the past, so it would read as "not entitled" — the safe
    // direction, but for the wrong reason and impossible to debug.
    expect(periodEndFrom(sub({ items: { data: [{}] } }))).toBeNull();
  });
});

describe('customerIdFrom', () => {
  it('accepts a bare id or an expanded object', () => {
    expect(customerIdFrom(sub({ customer: 'cus_abc' }))).toBe('cus_abc');
    expect(customerIdFrom(sub({ customer: { id: 'cus_abc' } }))).toBe('cus_abc');
  });

  it('null when absent', () => {
    expect(customerIdFrom(sub({ customer: null }))).toBeNull();
  });
});

describe('subscriptionToColumns', () => {
  it('maps every column from one object', () => {
    expect(subscriptionToColumns(sub())).toEqual({
      stripe_subscription_id: 'sub_123',
      stripe_customer_id: 'cus_123',
      subscription_status: 'active',
      subscription_current_period_end: '2099-01-01T00:00:00.000Z',
      subscription_cancel_at_period_end: false,
      plan_price_id: 'price_monthly',
    });
  });

  it('cancel_at_period_end is strictly boolean, never undefined', () => {
    // The column is NOT NULL, so undefined would fail the write.
    expect(subscriptionToColumns(sub({ cancel_at_period_end: undefined })).subscription_cancel_at_period_end).toBe(false);
    expect(subscriptionToColumns(sub({ cancel_at_period_end: null })).subscription_cancel_at_period_end).toBe(false);
    expect(subscriptionToColumns(sub({ cancel_at_period_end: true })).subscription_cancel_at_period_end).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// THE PORTAL CANCELLATION. The second field-location trap in this file.
//
// Captured from a real Customer Portal cancellation against the pinned API
// version, logged out of the live webhook. The boolean says false; `cancel_at`
// carries the truth. Reading the boolean told a cancelling family their
// subscription renews — the error that produces a duplicate cancellation or a
// chargeback.
// ---------------------------------------------------------------------------

/** Unix seconds, straight from the production log: 2026-09-11T16:37:15Z. */
const PORTAL_PERIOD_END = 1789144635;

/** The exact payload the Portal produced, reduced to the fields we read. */
const portalCancelled = (): StripeSubscriptionLike => ({
  id: 'sub_1U3Ig5DmeM1uDIBVsyt20ib7',
  status: 'active',
  cancel_at_period_end: false,          // ← the lie
  cancel_at: PORTAL_PERIOD_END,         // ← the truth
  customer: 'cus_V3PURCsYYj0MQ4',
  items: { data: [{ current_period_end: PORTAL_PERIOD_END, price: { id: 'price_1U0mU0DmeM1uDIBVbpkzxzp1' } }] },
});

describe('Portal cancellation — cancel_at, not the boolean', () => {
  it('REGRESSION: the real Portal payload maps to cancel_at_period_end TRUE', () => {
    // Fails against the old mapper, which read only the boolean and returned
    // false for a subscription Stripe describes as "Cancels Sep 11, 2026".
    expect(subscriptionToColumns(portalCancelled()).subscription_cancel_at_period_end).toBe(true);
  });

  it('and the family is told they are ending, not renewing', () => {
    // The whole point, stated in the terms the household page uses.
    const cols = subscriptionToColumns(portalCancelled());
    expect(entitlementFor(cols, new Date('2026-08-11T18:00:00Z'))).toEqual({
      isPro: true,
      reason: 'active_ending',
    });
  });

  it('cancel_at EQUAL to the period end → true', () => {
    expect(cancellationKindFrom(sub({ cancel_at: FUTURE }))).toBe('at_period_end');
    expect(subscriptionToColumns(sub({ cancel_at: FUTURE })).subscription_cancel_at_period_end).toBe(true);
  });

  it('cancel_at EARLIER than the period end → false, and classed scheduled_early', () => {
    // PINNED DECISION, not a preference. An early cancellation ends access on a
    // date these columns cannot express, so the flag stays clear and the page
    // shows the period end. That over-states access rather than under-stating
    // it — the safe direction — and the handler logs it loudly. Unreachable
    // from the Portal; it takes a dashboard action or an API call.
    const early = sub({ cancel_at: FUTURE - 86_400 });
    expect(cancellationKindFrom(early)).toBe('scheduled_early');
    expect(subscriptionToColumns(early).subscription_cancel_at_period_end).toBe(false);
  });

  it('cancel_at LATER than the period end → false, because it really does renew', () => {
    // It renews at least once more first. "Won't renew" would be the lie here.
    const later = sub({ cancel_at: FUTURE + 86_400 });
    expect(cancellationKindFrom(later)).toBe('scheduled_later');
    expect(subscriptionToColumns(later).subscription_cancel_at_period_end).toBe(false);
  });

  it('no cancel_at and the boolean false → false', () => {
    expect(cancellationKindFrom(sub())).toBe('none');
    expect(subscriptionToColumns(sub()).subscription_cancel_at_period_end).toBe(false);
  });

  it('the boolean TRUE with no cancel_at → true (the path that already worked)', () => {
    // Whatever still sets the boolean — the API does — must keep working.
    const flagged = sub({ cancel_at_period_end: true, cancel_at: null });
    expect(cancellationKindFrom(flagged)).toBe('at_period_end');
    expect(subscriptionToColumns(flagged).subscription_cancel_at_period_end).toBe(true);
  });

  it('a junk cancel_at is ignored rather than trusted', () => {
    for (const junk of [0, -1, NaN, undefined, null]) {
      expect(cancellationKindFrom(sub({ cancel_at: junk as number | null }))).toBe('none');
    }
  });

  it('with no readable period end there is nothing to compare, and nothing is claimed', () => {
    const noEnd = sub({ cancel_at: FUTURE, items: { data: [{ price: { id: 'price_monthly' } }] } });
    expect(cancellationKindFrom(noEnd)).toBe('none');
    expect(subscriptionToColumns(noEnd).subscription_cancel_at_period_end).toBe(false);
  });
});

describe('the mapping actually grants entitlement — end to end', () => {
  // The unit that matters: mapper output fed straight into the entitlement
  // decision. If the period end were read from the wrong place, this is the
  // test that fails, and it fails as "paying customer reads as free" rather
  // than as an abstract null.
  it('an active subscription maps to isPro', () => {
    const cols = subscriptionToColumns(sub());
    expect(entitlementFor(cols).isPro).toBe(true);
  });

  it('a cancelled-but-paid-through subscription still maps to isPro', () => {
    const cols = subscriptionToColumns(sub({ status: 'canceled', cancel_at_period_end: true }));
    expect(entitlementFor(cols)).toEqual({ isPro: true, reason: 'cancelled_paid_through' });
  });

  it('past_due maps to the deliberate grace', () => {
    const cols = subscriptionToColumns(sub({ status: 'past_due' }));
    expect(entitlementFor(cols)).toEqual({ isPro: true, reason: 'grace_past_due' });
  });

  it('a subscription with NO readable period end reads as free, not as Pro', () => {
    const cols = subscriptionToColumns(sub({ items: { data: [] } }));
    expect(entitlementFor(cols).isPro).toBe(false);
  });
});
