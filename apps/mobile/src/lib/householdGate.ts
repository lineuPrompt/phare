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
//
// PLAN. A household with no saved plan gets onboarding in place of the tabs.
// hasPlan comes from GET /api/dashboard, which is true once a file_imports
// row exists — every save-plan run writes one, manual entry included. Asked
// only once the terms are current: a blocked person should not trigger the
// dashboard's side effects (its daily "returned" heartbeat, its bridge
// materialisation) for a screen they cannot see. Same rule as the terms: a
// missing boolean is an error, not a guess.
//
// snapshotOnly=1, ALWAYS (2026-10-09). The full load logs
// `viewed_monthly_review` whenever the household has a review, and the gate
// shows no review: every app launch was counted as a review read. The
// snapshot load returns hasPlan the same way and returns before that event.
// ---------------------------------------------------------------------------

export const PLAN_GATE_PATH = '/api/dashboard?snapshotOnly=1';

export type HouseholdState = { kind: 'termsOutdated' } | { kind: 'needsPlan' } | { kind: 'ready' };

export async function loadHouseholdState(get: Getter): Promise<HouseholdState> {
  const me = await get<{ termsCurrent?: unknown }>('/api/me');
  if (typeof me?.termsCurrent !== 'boolean') {
    throw new Error('/api/me answered without a boolean termsCurrent');
  }
  if (!me.termsCurrent) return { kind: 'termsOutdated' };

  const dashboard = await get<{ hasPlan?: unknown }>(PLAN_GATE_PATH);
  if (typeof dashboard?.hasPlan !== 'boolean') {
    throw new Error('/api/dashboard answered without a boolean hasPlan');
  }
  return dashboard.hasPlan ? { kind: 'ready' } : { kind: 'needsPlan' };
}
