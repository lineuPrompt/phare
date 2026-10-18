// ---------------------------------------------------------------------------
// Apple's VERIFIED subscription data → the households.apple_* columns.
//
// Pure. Every input here has already passed SignedDataVerifier (Apple's
// signature, chained to Apple's root). This module decides only what the
// verified data means for one household, and refuses anything that does not
// fit — it never guesses a status, a date or an environment.
//
// The counterpart of stripeSubscriptionMap.ts. Same doctrine: the columns are
// a mirror of Apple's state, and entitlementFor derives Pro from them on every
// read. Nothing here decides Pro.
// ---------------------------------------------------------------------------

import { PHARE_PRO_PRODUCT_IDS } from '@phare/core';

// The only products this app sells — one list in @phare/core, shared with the
// app that requests them. A transaction for anything else, including the
// retired money.phare.app.pro.* products, is refused by name: Apple signing it
// proves only that it is real, not that it is ours to grant Pro for.
export { PHARE_PRO_PRODUCT_IDS };

/** Apple's numeric statuses (App Store Server API `status`). */
const STATUS_WORDS: Record<number, AppleStatusWord> = {
  1: 'active',
  2: 'expired',
  3: 'billing_retry',
  4: 'grace_period',
  5: 'revoked',
};

export type AppleStatusWord = 'active' | 'expired' | 'billing_retry' | 'grace_period' | 'revoked';

/** The fields of a verified JWSTransaction this module reads. */
export type VerifiedTransaction = {
  originalTransactionId?: string;
  bundleId?: string;
  productId?: string;
  expiresDate?: number;
  appAccountToken?: string;
  environment?: string;
  signedDate?: number;
};

/** The fields of a verified JWSRenewalInfo this module reads. */
export type VerifiedRenewalInfo = {
  originalTransactionId?: string;
  autoRenewStatus?: number;
  gracePeriodExpiresDate?: number;
  signedDate?: number;
};

export type AppleColumns = {
  apple_original_transaction_id: string;
  apple_product_id: string;
  apple_status: AppleStatusWord;
  apple_expires_at: string;
  apple_grace_period_expires_at: string | null;
  apple_auto_renew: boolean | null;
  apple_environment: 'Production' | 'Sandbox';
  apple_updated_at: string;
};

export class AppleMappingError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AppleMappingError';
  }
}

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * One subscription's live state → columns.
 *
 * `status` is the number Apple's status endpoint returned beside these two
 * signed documents. `bundleId` is ours: a transaction for another app is
 * refused even though Apple signed it.
 */
export function appleSubscriptionToColumns(
  status: number | undefined,
  transaction: VerifiedTransaction,
  renewal: VerifiedRenewalInfo | null,
  bundleId: string
): AppleColumns {
  if (transaction.bundleId !== bundleId) {
    throw new AppleMappingError('wrong_bundle', `transaction is for ${String(transaction.bundleId)}, not ${bundleId}`);
  }
  const original = transaction.originalTransactionId;
  if (!original) throw new AppleMappingError('no_original_transaction', 'transaction has no originalTransactionId');
  if (renewal && renewal.originalTransactionId && renewal.originalTransactionId !== original) {
    throw new AppleMappingError('renewal_mismatch', 'renewal info belongs to another subscription');
  }
  if (!transaction.productId) throw new AppleMappingError('no_product', 'transaction has no productId');
  if (!(PHARE_PRO_PRODUCT_IDS as readonly string[]).includes(transaction.productId)) {
    throw new AppleMappingError('unknown_product', `product ${transaction.productId} is not a Phare Pro product`);
  }

  const word = status === undefined ? undefined : STATUS_WORDS[status];
  if (!word) throw new AppleMappingError('unknown_status', `unknown Apple status ${String(status)}`);

  // An auto-renewable subscription always has an expiry. Without one there is
  // no date to bound access by, and entitlementFor would read it as free —
  // refused here so the failure is loud, not a quiet "not Pro".
  if (typeof transaction.expiresDate !== 'number' || !Number.isFinite(transaction.expiresDate)) {
    throw new AppleMappingError('no_expiry', 'transaction has no expiresDate');
  }

  const environment = transaction.environment;
  if (environment !== 'Production' && environment !== 'Sandbox') {
    // Xcode and LocalTesting transactions are signed by a local certificate,
    // never by Apple's root, so they should not get this far; refuse anyway.
    throw new AppleMappingError('wrong_environment', `environment ${String(environment)} is not accepted`);
  }

  const grace = renewal?.gracePeriodExpiresDate;
  const signedDates = [transaction.signedDate, renewal?.signedDate].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  );
  if (signedDates.length === 0) throw new AppleMappingError('no_signed_date', 'no signedDate to order this state by');

  return {
    apple_original_transaction_id: original,
    apple_product_id: transaction.productId,
    apple_status: word,
    apple_expires_at: iso(transaction.expiresDate),
    apple_grace_period_expires_at: typeof grace === 'number' && Number.isFinite(grace) ? iso(grace) : null,
    // Unknown is null, not "on": entitlementFor reads only an explicit false
    // as "ending".
    apple_auto_renew: renewal?.autoRenewStatus === 1 ? true : renewal?.autoRenewStatus === 0 ? false : null,
    apple_environment: environment,
    apple_updated_at: iso(Math.max(...signedDates)),
  };
}

/**
 * May this state overwrite what is stored? Only when it is not older. Equal
 * is allowed: a re-delivery of the same state writes the same values.
 */
export function isNotOlder(incomingUpdatedAt: string, storedUpdatedAt: string | null): boolean {
  if (!storedUpdatedAt) return true;
  return Date.parse(incomingUpdatedAt) >= Date.parse(storedUpdatedAt);
}
