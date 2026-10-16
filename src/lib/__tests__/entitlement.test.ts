import { describe, it, expect } from 'vitest';
import {
  entitlementFor,
  isPro,
  horizonMonthsFor,
  entitledHorizonEndMonth,
  HORIZON_MONTHS_FREE,
  HORIZON_MONTHS_PRO,
} from '@/lib/entitlement';

// ---------------------------------------------------------------------------
// Entitlement is the money-correctness boundary: every wrong answer either
// gives away what was sold or takes back what was paid for. `now` is injected
// so the boundaries are asserted exactly rather than approximately.
// ---------------------------------------------------------------------------

const NOW = new Date('2026-08-04T12:00:00Z');
const future = '2026-09-01T00:00:00Z';
const past = '2026-07-01T00:00:00Z';

describe('entitlementFor — comp', () => {
  it('a live comp grants Pro regardless of billing state', () => {
    // The whole point of keeping comps out of Stripe: no billing state can
    // contradict a gift.
    const e = entitlementFor(
      { comp_until: '2027-11-01', subscription_status: 'canceled', subscription_current_period_end: past },
      NOW
    );
    expect(e).toEqual({ isPro: true, reason: 'comp' });
  });

  it('comp is honoured for the WHOLE of its final day', () => {
    // A gift must not expire at midnight UTC while it is still that date for
    // the family. Erring toward the household on the boundary is deliberate.
    expect(isPro({ comp_until: '2026-08-04' }, NOW)).toBe(true);
  });

  it('expires the day after', () => {
    expect(isPro({ comp_until: '2026-08-03' }, NOW)).toBe(false);
  });

  it('drops silently to free — no error, no special state', () => {
    const e = entitlementFor({ comp_until: '2026-08-03' }, NOW);
    expect(e).toEqual({ isPro: false, reason: 'none' });
  });

  it('a malformed comp date never grants access', () => {
    for (const bad of ['soon', '2026-13-99x', '', '11/01/2027']) {
      expect(isPro({ comp_until: bad }, NOW), bad).toBe(false);
    }
  });
});

describe('entitlementFor — paid', () => {
  it('active with a future period end is Pro', () => {
    expect(entitlementFor(
      { subscription_status: 'active', subscription_current_period_end: future }, NOW
    )).toEqual({ isPro: true, reason: 'active' });
  });

  it('active with a PAST period end is NOT Pro', () => {
    // Guards against a stale row still reading 'active' long after Stripe moved
    // on — e.g. a webhook that never arrived.
    expect(isPro(
      { subscription_status: 'active', subscription_current_period_end: past }, NOW
    )).toBe(false);
  });

  it('active with NO period end is NOT Pro', () => {
    expect(isPro({ subscription_status: 'active' }, NOW)).toBe(false);
  });

  it('trialing (Stripe’s own trial) is honoured', () => {
    expect(isPro(
      { subscription_status: 'trialing', subscription_current_period_end: future }, NOW
    )).toBe(true);
  });
});

describe('entitlementFor — the two cases most likely to be got wrong', () => {
  it('past_due keeps access until period end (grace, decided deliberately)', () => {
    // An expired card is the most common and least culpable billing failure.
    // Stripe retries for days; dropping access instantly punishes a household
    // that fully intends to pay.
    expect(entitlementFor(
      { subscription_status: 'past_due', subscription_current_period_end: future }, NOW
    )).toEqual({ isPro: true, reason: 'grace_past_due' });
  });

  it('past_due grace is BOUNDED by period end — never indefinite', () => {
    expect(isPro(
      { subscription_status: 'past_due', subscription_current_period_end: past }, NOW
    )).toBe(false);
  });

  it('cancelled mid-period keeps access through the paid period', () => {
    // The Terms promise this explicitly. Reading "cancelled" as "no access"
    // would break them in the customer's disfavour — the worst direction.
    for (const status of ['canceled', 'cancelled']) {
      expect(entitlementFor(
        { subscription_status: status, subscription_current_period_end: future }, NOW
      ), status).toEqual({ isPro: true, reason: 'cancelled_paid_through' });
    }
  });

  it('cancelled after the period has ended is not Pro', () => {
    expect(isPro(
      { subscription_status: 'canceled', subscription_current_period_end: past }, NOW
    )).toBe(false);
  });
});

describe('entitlementFor — the legacy ‘trial’ default', () => {
  it('does NOT grant Pro, even though every existing household has it', () => {
    // households.subscription_status defaults to 'trial' with no expiry, so
    // honouring it would silently make every household that ever existed Pro
    // forever. Comped families are covered by comp_until instead — which is
    // precisely why comps were kept out of this column.
    expect(isPro({ subscription_status: 'trial' }, NOW)).toBe(false);
    expect(isPro(
      { subscription_status: 'trial', subscription_current_period_end: future }, NOW
    )).toBe(false);
  });
});

describe('entitlementFor — absent and malformed input', () => {
  it('null / undefined household is free, not a crash', () => {
    expect(entitlementFor(null, NOW)).toEqual({ isPro: false, reason: 'none' });
    expect(entitlementFor(undefined, NOW)).toEqual({ isPro: false, reason: 'none' });
  });

  it('an empty row is free', () => {
    expect(entitlementFor({}, NOW)).toEqual({ isPro: false, reason: 'none' });
  });

  it('an unparseable period end never grants access', () => {
    expect(isPro(
      { subscription_status: 'active', subscription_current_period_end: 'whenever' }, NOW
    )).toBe(false);
  });

  it('an unrecognised status never grants access', () => {
    expect(isPro(
      { subscription_status: 'incomplete_expired', subscription_current_period_end: future }, NOW
    )).toBe(false);
  });
});

describe('horizonMonthsFor', () => {
  it('free sees 3 months, Pro sees 12', () => {
    expect(horizonMonthsFor({}, NOW)).toBe(HORIZON_MONTHS_FREE);
    expect(horizonMonthsFor(
      { subscription_status: 'active', subscription_current_period_end: future }, NOW
    )).toBe(HORIZON_MONTHS_PRO);
  });

  it('a comped household gets the Pro horizon', () => {
    expect(horizonMonthsFor({ comp_until: '2027-11-01' }, NOW)).toBe(HORIZON_MONTHS_PRO);
  });

  it('the two horizons actually differ', () => {
    // Teeth: without this the constants could both be 3 and every test above
    // would still pass.
    expect(HORIZON_MONTHS_PRO).toBeGreaterThan(HORIZON_MONTHS_FREE);
  });
});

// The one horizon-end function the Timeline AND the Cards page call. The
// current month counts as month 1.
describe('entitledHorizonEndMonth', () => {
  it('free: current + 2 (three months including this one)', () => {
    expect(entitledHorizonEndMonth('2026-09', false)).toBe('2026-11');
  });

  it('Pro: current + 11 (twelve months including this one)', () => {
    expect(entitledHorizonEndMonth('2026-09', true)).toBe('2027-08');
  });

  it('rolls over the year boundary', () => {
    expect(entitledHorizonEndMonth('2026-11', false)).toBe('2027-01');
    expect(entitledHorizonEndMonth('2026-12', false)).toBe('2027-02');
    expect(entitledHorizonEndMonth('2026-01', true)).toBe('2026-12');
    expect(entitledHorizonEndMonth('2026-02', true)).toBe('2027-01');
  });
});

describe('active_ending — cancelled mid-period, still entitled', () => {
  // Without this, a household that cancels sees NOTHING change on return and
  // concludes the cancellation failed — then cancels again, or emails support,
  // or disputes the charge. The entitlement is identical; only the sentence
  // the UI can say differs.
  it('active + cancel_at_period_end reads as active_ending, still Pro', () => {
    expect(entitlementFor({
      subscription_status: 'active',
      subscription_current_period_end: future,
      subscription_cancel_at_period_end: true,
    }, NOW)).toEqual({ isPro: true, reason: 'active_ending' });
  });

  it('active WITHOUT the flag stays plain active', () => {
    expect(entitlementFor({
      subscription_status: 'active',
      subscription_current_period_end: future,
      subscription_cancel_at_period_end: false,
    }, NOW)).toEqual({ isPro: true, reason: 'active' });
  });

  it('the flag alone never grants access once the period has ended', () => {
    expect(isPro({
      subscription_status: 'active',
      subscription_current_period_end: past,
      subscription_cancel_at_period_end: true,
    }, NOW)).toBe(false);
  });

  it('a comped household is unaffected by the flag', () => {
    expect(entitlementFor({
      comp_until: '2027-11-01',
      subscription_cancel_at_period_end: true,
    }, NOW).reason).toBe('comp');
  });
});

// ---------------------------------------------------------------------------
// Apple (in-app purchase, 2026-10-16). Each status bounded by a future date.
// ---------------------------------------------------------------------------

describe('entitlementFor — Apple', () => {
  it('active with a future expiry is Pro', () => {
    expect(entitlementFor({ apple_status: 'active', apple_expires_at: future, apple_auto_renew: true }, NOW))
      .toEqual({ isPro: true, reason: 'apple_active' });
  });

  it('active with a PAST expiry is NOT Pro — a stale row never means access for ever', () => {
    expect(entitlementFor({ apple_status: 'active', apple_expires_at: past, apple_auto_renew: true }, NOW))
      .toEqual({ isPro: false, reason: 'none' });
  });

  it('active with NO expiry is NOT Pro', () => {
    expect(isPro({ apple_status: 'active', apple_auto_renew: true }, NOW)).toBe(false);
  });

  it('renewal turned off: still Pro until the period ends, and says so', () => {
    expect(entitlementFor({ apple_status: 'active', apple_expires_at: future, apple_auto_renew: false }, NOW))
      .toEqual({ isPro: true, reason: 'apple_ending' });
  });

  it('an unknown renewal setting reads as renewing, not ending', () => {
    expect(entitlementFor({ apple_status: 'active', apple_expires_at: future }, NOW).reason).toBe('apple_active');
  });

  it('billing grace period keeps access until the grace date', () => {
    expect(entitlementFor({
      apple_status: 'grace_period', apple_expires_at: past, apple_grace_period_expires_at: future,
    }, NOW)).toEqual({ isPro: true, reason: 'apple_grace' });
  });

  it('grace is BOUNDED by its own date, not by the paid period', () => {
    expect(isPro({ apple_status: 'grace_period', apple_expires_at: future, apple_grace_period_expires_at: past }, NOW))
      .toBe(false);
  });

  it.each(['billing_retry', 'expired', 'revoked', 'something_new'])(
    '%s is not Pro, even with a future expiry on the row',
    (status) => {
      expect(entitlementFor({
        apple_status: status, apple_expires_at: future, apple_grace_period_expires_at: future,
      }, NOW)).toEqual({ isPro: false, reason: 'none' });
    }
  );

  it('an unparseable expiry never grants access', () => {
    expect(isPro({ apple_status: 'active', apple_expires_at: 'soon' }, NOW)).toBe(false);
  });

  it('Apple is enough on its own when Stripe has lapsed', () => {
    expect(entitlementFor({
      subscription_status: 'canceled', subscription_current_period_end: past,
      apple_status: 'active', apple_expires_at: future,
    }, NOW).reason).toBe('apple_active');
  });

  it('Stripe is enough on its own when Apple has expired', () => {
    expect(entitlementFor({
      subscription_status: 'active', subscription_current_period_end: future,
      apple_status: 'expired', apple_expires_at: past,
    }, NOW).reason).toBe('active');
  });

  it('paying through both reads with the Stripe sentence; comp still comes first', () => {
    const both = {
      subscription_status: 'active', subscription_current_period_end: future,
      apple_status: 'active', apple_expires_at: future,
    };
    expect(entitlementFor(both, NOW).reason).toBe('active');
    expect(entitlementFor({ ...both, comp_until: '2027-11-01' }, NOW).reason).toBe('comp');
  });

  it('a Stripe status that grants nothing does not hide a live Apple subscription', () => {
    // The legacy 'trial' default sits on every household; it must not stop the
    // Apple path from being asked.
    expect(entitlementFor({
      subscription_status: 'trial', apple_status: 'grace_period', apple_grace_period_expires_at: future,
    }, NOW).reason).toBe('apple_grace');
  });

  it('the Pro horizon follows an Apple subscription', () => {
    expect(horizonMonthsFor({ apple_status: 'active', apple_expires_at: future }, NOW)).toBe(HORIZON_MONTHS_PRO);
  });
});
