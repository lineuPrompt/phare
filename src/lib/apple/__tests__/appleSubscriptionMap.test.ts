import { describe, it, expect } from 'vitest';
import { appleSubscriptionToColumns, AppleMappingError, isNotOlder, type VerifiedTransaction } from '../appleSubscriptionMap';

const BUNDLE = 'money.phare.app';
const EXPIRES = Date.UTC(2026, 10, 16, 12, 0, 0);
const SIGNED_TX = Date.UTC(2026, 9, 16, 12, 0, 0);
const SIGNED_RENEWAL = Date.UTC(2026, 9, 16, 12, 5, 0);

const tx = (over: Partial<VerifiedTransaction> = {}): VerifiedTransaction => ({
  originalTransactionId: '2000000123',
  bundleId: BUNDLE,
  productId: 'phare.app.pro.monthly',
  expiresDate: EXPIRES,
  appAccountToken: 'cceaee4b-8e8d-46e1-b8c8-2d743e2f6563',
  environment: 'Sandbox',
  signedDate: SIGNED_TX,
  ...over,
});

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof AppleMappingError ? err.code : `not a mapping error: ${String(err)}`;
  }
  return 'no error';
};

describe('appleSubscriptionToColumns', () => {
  it('maps a renewing subscription to every column', () => {
    expect(appleSubscriptionToColumns(1, tx(), { originalTransactionId: '2000000123', autoRenewStatus: 1, signedDate: SIGNED_RENEWAL }, BUNDLE))
      .toEqual({
        apple_original_transaction_id: '2000000123',
        apple_product_id: 'phare.app.pro.monthly',
        apple_status: 'active',
        apple_expires_at: '2026-11-16T12:00:00.000Z',
        apple_grace_period_expires_at: null,
        apple_auto_renew: true,
        apple_environment: 'Sandbox',
        // The newer of the two signatures orders this state.
        apple_updated_at: '2026-10-16T12:05:00.000Z',
      });
  });

  it.each([
    [1, 'active'], [2, 'expired'], [3, 'billing_retry'], [4, 'grace_period'], [5, 'revoked'],
  ])('Apple status %i is %s', (status, word) => {
    expect(appleSubscriptionToColumns(status, tx(), null, BUNDLE).apple_status).toBe(word);
  });

  it('refuses a status it does not know, rather than guessing one', () => {
    expect(code(() => appleSubscriptionToColumns(9, tx(), null, BUNDLE))).toBe('unknown_status');
    expect(code(() => appleSubscriptionToColumns(undefined, tx(), null, BUNDLE))).toBe('unknown_status');
  });

  it('keeps the grace date and reads renewal turned off as false', () => {
    const cols = appleSubscriptionToColumns(4, tx(), {
      autoRenewStatus: 0, gracePeriodExpiresDate: Date.UTC(2026, 10, 20), signedDate: SIGNED_RENEWAL,
    }, BUNDLE);
    expect(cols.apple_grace_period_expires_at).toBe('2026-11-20T00:00:00.000Z');
    expect(cols.apple_auto_renew).toBe(false);
  });

  it('an unknown renewal setting is null, never "on"', () => {
    expect(appleSubscriptionToColumns(1, tx(), null, BUNDLE).apple_auto_renew).toBeNull();
    expect(appleSubscriptionToColumns(1, tx(), { signedDate: SIGNED_RENEWAL }, BUNDLE).apple_auto_renew).toBeNull();
  });

  it('accepts both Phare Pro products', () => {
    expect(appleSubscriptionToColumns(1, tx({ productId: 'phare.app.pro.yearly' }), null, BUNDLE).apple_product_id).toBe('phare.app.pro.yearly');
  });

  it('refuses any other product, including the retired ones, by name', () => {
    expect(code(() => appleSubscriptionToColumns(1, tx({ productId: 'money.phare.app.pro.monthly' }), null, BUNDLE))).toBe('unknown_product');
    expect(code(() => appleSubscriptionToColumns(1, tx({ productId: 'phare.app.pro.lifetime' }), null, BUNDLE))).toBe('unknown_product');
  });

  it('refuses a transaction signed for another app', () => {
    expect(code(() => appleSubscriptionToColumns(1, tx({ bundleId: 'com.other.app' }), null, BUNDLE))).toBe('wrong_bundle');
  });

  it('refuses renewal info that belongs to another subscription', () => {
    expect(code(() => appleSubscriptionToColumns(1, tx(), { originalTransactionId: '999', signedDate: SIGNED_RENEWAL }, BUNDLE)))
      .toBe('renewal_mismatch');
  });

  it('refuses a subscription with no expiry, so it can never read as quietly free', () => {
    expect(code(() => appleSubscriptionToColumns(1, tx({ expiresDate: undefined }), null, BUNDLE))).toBe('no_expiry');
  });

  it.each(['Xcode', 'LocalTesting', undefined])('refuses the %s environment', (environment) => {
    expect(code(() => appleSubscriptionToColumns(1, tx({ environment }), null, BUNDLE))).toBe('wrong_environment');
  });

  it('accepts Production', () => {
    expect(appleSubscriptionToColumns(1, tx({ environment: 'Production' }), null, BUNDLE).apple_environment).toBe('Production');
  });

  it('refuses a transaction with no subscription id, no product, or no signature date', () => {
    expect(code(() => appleSubscriptionToColumns(1, tx({ originalTransactionId: undefined }), null, BUNDLE))).toBe('no_original_transaction');
    expect(code(() => appleSubscriptionToColumns(1, tx({ productId: undefined }), null, BUNDLE))).toBe('no_product');
    expect(code(() => appleSubscriptionToColumns(1, tx({ signedDate: undefined }), null, BUNDLE))).toBe('no_signed_date');
  });
});

describe('isNotOlder', () => {
  it('anything goes when nothing is stored', () => {
    expect(isNotOlder('2026-10-16T12:00:00.000Z', null)).toBe(true);
  });
  it('a newer or equal state may overwrite; an older one may not', () => {
    expect(isNotOlder('2026-10-16T12:00:01.000Z', '2026-10-16T12:00:00+00:00')).toBe(true);
    expect(isNotOlder('2026-10-16T12:00:00.000Z', '2026-10-16T12:00:00+00:00')).toBe(true);
    expect(isNotOlder('2026-10-16T11:59:59.000Z', '2026-10-16T12:00:00+00:00')).toBe(false);
  });
});
