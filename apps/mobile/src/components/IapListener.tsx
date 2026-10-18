import { useEffect } from 'react';
import { apiPost } from '../lib/api';
import { appStore, connectStore, disconnectStore, onStoreError, onStorePurchase } from '../lib/iap';
import { handlePurchase } from '../lib/subscription';
import { emitEntrySaved } from '../lib/entryEvents';
import { emitSubscriptionEvent } from '../lib/subscriptionEvents';

/**
 * The one StoreKit connection and the one purchase listener, for as long as a
 * signed-in household is on screen (mounted inside both gates, TabsLayout).
 *
 * ONE LISTENER, ON PURPOSE. StoreKit delivers every purchase here: one just
 * made on the Phare Pro screen, and one left unfinished last time (approved
 * later, or a verify that failed) re-delivered at launch. A second listener on
 * the screen would verify and finish the same purchase twice.
 *
 * After the server answers, the tabs refetch (Pro changes the horizon and the
 * review letter) and the open screen hears the outcome.
 */
export default function IapListener() {
  useEffect(() => {
    let active = true;
    connectStore().catch((err: unknown) => console.error('StoreKit connection error:', err));

    const purchases = onStorePurchase((purchase) => {
      void (async () => {
        const outcome = await handlePurchase(appStore, apiPost, purchase);
        if (outcome.kind === 'failed') console.error('Purchase verify failed (left unfinished):', outcome.error);
        if (!active) return;
        if (outcome.kind === 'verified') emitEntrySaved();
        emitSubscriptionEvent(outcome);
      })();
    });

    const errors = onStoreError((cancelled, error) => {
      if (!cancelled) console.error('StoreKit purchase error:', error);
      emitSubscriptionEvent(cancelled ? { kind: 'cancelled' } : { kind: 'storeError', error });
    });

    return () => {
      active = false;
      purchases.remove();
      errors.remove();
      disconnectStore().catch((err: unknown) => console.error('StoreKit disconnect error:', err));
    };
  }, []);

  return null;
}
