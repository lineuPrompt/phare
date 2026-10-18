import { PHARE_PRO_PRODUCT_IDS, type PhareProProductId } from '@phare/core';
import { ApiError, messageKeyFor } from './apiErrors';

// ---------------------------------------------------------------------------
// Phare Pro in the app, through Apple's in-app purchase (piece 3, 2026-10-17;
// design: docs/iap-design.md).
//
// Pure: StoreKit (through expo-iap) and the API are injected, so every rule is
// tested without a phone or Apple. src/lib/iap.ts binds the real ones.
//
// THE RULES
//   - Only the two Phare Pro products are requested or handled (@phare/core,
//     the same list the server accepts).
//   - Every purchase is tagged with the household's id (appAccountToken). The
//     server accepts a purchase only for the household it was made for.
//   - A purchase is FINISHED only after /api/apple/verify answered 200. An
//     unfinished one stays in StoreKit's queue and is delivered again at the
//     next launch, so a failed verify is retried rather than lost.
//   - Pro is what the SERVER answers (entitlement), never what the phone
//     concludes from StoreKit.
//   - Who may buy: the household owner, as on the web (/api/stripe/checkout:
//     owner_only). A household that is already Pro is offered nothing.
//   - No price is ever typed: what is shown is StoreKit's own displayPrice.
// ---------------------------------------------------------------------------

/** GET /api/me — only what this screen needs. */
export type Me = {
  isPro: boolean;
  entitlementReason: string;
  role: string | null;
  household_id: string | null;
};

export type Entitlement = { isPro: boolean; reason: string };

/** A product as StoreKit returned it, reduced to what the screen shows. */
export type ProProduct = { id: PhareProProductId; displayPrice: string; period: 'month' | 'year' };

/** The slice of a StoreKit purchase this module reads. */
export type StorePurchase = { productId: string; purchaseToken?: string | null };

export interface Store {
  fetchSubscriptions(skus: string[]): Promise<{ id: string; displayPrice: string }[]>;
  requestSubscription(sku: string, appAccountToken: string): Promise<unknown>;
  availablePurchases(): Promise<StorePurchase[]>;
  finish(purchase: StorePurchase): Promise<void>;
}

export type Poster = <T>(path: string, body: unknown) => Promise<T>;

export const isProProduct = (id: string): id is PhareProProductId =>
  (PHARE_PRO_PRODUCT_IDS as readonly string[]).includes(id);

/** What the Phare Pro screen offers this person. */
export type ProOffer =
  /** Owner of a household without Pro: may subscribe. */
  | { kind: 'canSubscribe'; householdId: string }
  /** Not the owner: only the owner subscribes for the household. */
  | { kind: 'ownerOnly' }
  /** Already Pro. `throughApple` adds "Manage subscription". */
  | { kind: 'alreadyPro'; reason: string; throughApple: boolean };

export function proOffer(me: Me): ProOffer {
  if (me.isPro) {
    return { kind: 'alreadyPro', reason: me.entitlementReason, throughApple: me.entitlementReason.startsWith('apple_') };
  }
  if (me.role !== 'owner' || !me.household_id) return { kind: 'ownerOnly' };
  return { kind: 'canSubscribe', householdId: me.household_id };
}

/**
 * Should the account screen warn before deletion? Only while an Apple
 * subscription is still RENEWING: active or in its billing grace period.
 * 'apple_ending' (renewal already off) will not bill again, so no warning.
 */
export function needsCancelWarning(me: Me): boolean {
  return me.isPro && (me.entitlementReason === 'apple_active' || me.entitlementReason === 'apple_grace');
}

/**
 * Both products from StoreKit, monthly first. A missing one is an error, not
 * a shorter list: it means App Store Connect or the sandbox is not set up, and
 * a screen offering only one of two plans would hide that.
 */
export async function loadProducts(store: Store): Promise<ProProduct[]> {
  const found = await store.fetchSubscriptions([...PHARE_PRO_PRODUCT_IDS]);
  return PHARE_PRO_PRODUCT_IDS.map((id) => {
    const product = found.find((candidate) => candidate.id === id);
    if (!product || !product.displayPrice) throw new Error(`subscription: StoreKit did not return ${id}`);
    return { id, displayPrice: product.displayPrice, period: id.endsWith('.yearly') ? 'year' : 'month' };
  });
}

/** Start a purchase. The outcome arrives through the purchase listener (handlePurchase). */
export async function subscribe(store: Store, offer: ProOffer, productId: PhareProProductId): Promise<void> {
  if (offer.kind !== 'canSubscribe') throw new Error(`subscription: nothing to buy (${offer.kind})`);
  await store.requestSubscription(productId, offer.householdId);
}

export type HandleOutcome =
  /** Verified and finished. Pro as the server now reads it. */
  | { kind: 'verified'; entitlement: Entitlement }
  /** Not one of ours. Left alone: never finished, never sent. */
  | { kind: 'ignored' }
  /** The server did not accept it. NOT finished, so StoreKit delivers it again. */
  | { kind: 'failed'; error: unknown };

/** One purchase from StoreKit: verify on the server, then (only then) finish it. */
export async function handlePurchase(store: Store, post: Poster, purchase: StorePurchase): Promise<HandleOutcome> {
  if (!isProProduct(purchase.productId)) return { kind: 'ignored' };
  const signedTransaction = purchase.purchaseToken;
  if (!signedTransaction) return { kind: 'failed', error: new Error('subscription: StoreKit gave no signed transaction') };
  try {
    const answer = await post<{ entitlement?: Entitlement }>('/api/apple/verify', { signedTransaction });
    if (!answer?.entitlement || typeof answer.entitlement.isPro !== 'boolean') {
      throw new Error('subscription: the server answered without an entitlement');
    }
    await store.finish(purchase);
    return { kind: 'verified', entitlement: answer.entitlement };
  } catch (error) {
    return { kind: 'failed', error };
  }
}

export type RestoreOutcome =
  | { kind: 'restored'; entitlement: Entitlement }
  /** StoreKit holds no Phare Pro purchase for this Apple ID. */
  | { kind: 'nothingToRestore' }
  | { kind: 'failed'; error: unknown };

/**
 * Restore Purchases: every Phare Pro purchase StoreKit still holds, verified in
 * turn. Other products need no filter here: handlePurchase ignores them, and a
 * mutation run proved a filter redundant.
 */
export async function restore(store: Store, post: Poster): Promise<RestoreOutcome> {
  let purchases: StorePurchase[];
  try {
    purchases = await store.availablePurchases();
  } catch (error) {
    return { kind: 'failed', error };
  }
  if (purchases.length === 0) return { kind: 'nothingToRestore' };
  let last: RestoreOutcome = { kind: 'nothingToRestore' };
  for (const purchase of purchases) {
    const outcome = await handlePurchase(store, post, purchase);
    if (outcome.kind === 'failed') return { kind: 'failed', error: outcome.error };
    if (outcome.kind === 'verified') last = { kind: 'restored', entitlement: outcome.entitlement };
  }
  return last;
}

/**
 * A failed verify → its message. Each route code has its own sentence
 * (/api/apple/verify); anything else uses the shared status mapping.
 */
export const VERIFY_ERROR_KEYS: Record<string, string> = {
  account_token_mismatch: 'pro.errors.otherHousehold',
  belongs_to_other_household: 'pro.errors.otherHousehold',
  apple_not_configured: 'pro.errors.notAvailable',
  subscription_not_found: 'pro.errors.notFound',
  invalid_signature: 'pro.errors.notVerified',
  unknown_product: 'pro.errors.notVerified',
};

export function verifyErrorKey(err: unknown): string {
  if (err instanceof ApiError && err.code && err.code in VERIFY_ERROR_KEYS) return VERIFY_ERROR_KEYS[err.code];
  return messageKeyFor(err);
}
