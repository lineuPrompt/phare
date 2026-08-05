import { describe, it, expect } from 'vitest';
import {
  subscriptionToColumns,
  periodEndFrom,
  customerIdFrom,
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
