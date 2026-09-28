import type { Getter } from './timelineLoader';

// ---------------------------------------------------------------------------
// What a signed-in person may see, decided after sign-in and before any tab.
//
// TERMS. /api/me computes termsCurrent server-side: accepted, AND accepted
// the current version. Accepting happens on the web only — the Terms carry
// prices, so neither a link to them nor a copy of them belongs in this app.
// When termsCurrent is false the app shows one plain sentence and a way to
// sign out, nothing else.
//
// A MISSING FLAG IS NOT A PASS. If /api/me answers without a boolean
// termsCurrent, this throws and the gate shows an error with a retry. Reading
// `undefined` as "fine" would open the app to someone the server never
// cleared; reading it as "outdated" would lock everyone out over a deploy.
// ---------------------------------------------------------------------------

export type HouseholdState = { kind: 'termsOutdated' } | { kind: 'ready' };

export async function loadHouseholdState(get: Getter): Promise<HouseholdState> {
  const me = await get<{ termsCurrent?: unknown }>('/api/me');
  if (typeof me?.termsCurrent !== 'boolean') {
    throw new Error('/api/me answered without a boolean termsCurrent');
  }
  if (!me.termsCurrent) return { kind: 'termsOutdated' };
  return { kind: 'ready' };
}
