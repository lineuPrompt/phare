// ---------------------------------------------------------------------------
// Keeps the signed-out screens on screen while a flow finishes.
//
// Confirming a sign-up or a reset code signs the person in (verifyOtp), and
// AuthGate would swap to the app that same instant — unmounting the screen
// before it records consent or sets the new password, and before it can say
// that either failed. A flow holds the gate until its last step is done, then
// releases it. A tiny store, read with useSyncExternalStore.
// ---------------------------------------------------------------------------

let held = false;
const listeners = new Set<() => void>();

export function setAuthHold(value: boolean): void {
  if (held === value) return;
  held = value;
  for (const l of listeners) l();
}

export function isAuthHeld(): boolean {
  return held;
}

export function subscribeAuthHold(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
