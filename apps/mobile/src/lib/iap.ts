import {
  deepLinkToSubscriptions,
  endConnection,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  isUserCancelledError,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  type Purchase,
  type PurchaseInput,
} from 'expo-iap';
import type { Store, StorePurchase } from './subscription';

// ---------------------------------------------------------------------------
// The real StoreKit, through expo-iap 5.8.2, shaped as subscription.ts's Store.
//
// Kept apart from subscription.ts because expo-iap is a native module: nothing
// that imports it can run under the Node test runner. Every rule lives in
// subscription.ts; this file only forwards.
//
// Field names are expo-iap 5.8.2's, read from its types (2026-10-17):
//   - purchase.purchaseToken: "Unified purchase token (iOS JWS …)", the
//     signed transaction /api/apple/verify verifies;
//   - requestPurchase({ request: { apple: { sku, appAccountToken } }, type: 'subs' });
//   - finishTransaction({ purchase, isConsumable: false }) for a subscription;
//   - a product's displayPrice: StoreKit's own localized price string.
// ---------------------------------------------------------------------------

export const appStore: Store = {
  async fetchSubscriptions(skus) {
    const products = (await fetchProducts({ skus, type: 'subs' })) ?? [];
    return products.map((product) => ({ id: product.id, displayPrice: product.displayPrice }));
  },
  async requestSubscription(sku, appAccountToken) {
    return requestPurchase({ request: { apple: { sku, appAccountToken } }, type: 'subs' });
  },
  async availablePurchases() {
    return (await getAvailablePurchases()) as StorePurchase[];
  },
  async finish(purchase) {
    // The object StoreKit handed over (a full Purchase), passed back as it came.
    await finishTransaction({ purchase: purchase as PurchaseInput, isConsumable: false });
  },
};

export const connectStore = () => initConnection();
export const disconnectStore = () => endConnection();

/** Apple's own "manage subscriptions" sheet. */
export const openManageSubscriptions = () => deepLinkToSubscriptions();

export function onStorePurchase(listener: (purchase: Purchase) => void) {
  return purchaseUpdatedListener(listener);
}

export function onStoreError(listener: (cancelled: boolean, error: unknown) => void) {
  return purchaseErrorListener((error) => listener(isUserCancelledError(error), error));
}
