// ---------------------------------------------------------------------------
// "An entry was saved" — so the screens that show entries can refetch.
//
// Quick entry is a modal over the tabs. When it saves, the Timeline and Cards
// underneath are showing figures that no longer include the new row. Refetching
// on every tab focus would cost a round trip per tab switch to catch an event
// that happens a few times a day; this tells them exactly when.
//
// Emitted ONLY after the server answered 200. A screen never shows an entry
// the server has not accepted.
// ---------------------------------------------------------------------------

type Listener = () => void;

const listeners = new Set<Listener>();

export function onEntrySaved(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitEntrySaved(): void {
  for (const listener of [...listeners]) listener();
}
