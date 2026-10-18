// ---------------------------------------------------------------------------
// What happened to a Phare Pro purchase — so the screen that is open hears
// about one StoreKit delivered in the background (a purchase interrupted by a
// network drop, approved later, or re-delivered at launch). Emitted by
// IapListener only, after the server has answered; same shape as entryEvents.
// ---------------------------------------------------------------------------

import type { HandleOutcome } from './subscription';

export type SubscriptionEvent =
  | HandleOutcome
  /** The person closed Apple's sheet without buying. Not an error. */
  | { kind: 'cancelled' }
  /** StoreKit refused before any purchase existed. */
  | { kind: 'storeError'; error: unknown };

type Listener = (event: SubscriptionEvent) => void;

const listeners = new Set<Listener>();

export function onSubscriptionEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitSubscriptionEvent(event: SubscriptionEvent): void {
  for (const listener of [...listeners]) listener(event);
}
