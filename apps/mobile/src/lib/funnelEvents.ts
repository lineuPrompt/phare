import type { OnboardingStep, PlausibilityAction } from '@phare/core';

// ---------------------------------------------------------------------------
// Onboarding funnel events from the app — the same events, through the same
// POST /api/events allowlist, as the web /upload page. 2026-09-29.
//
// Values are @phare/core's enums, the arrays the server validates against,
// so the app cannot send a step the server does not know. No names, amounts
// or free text: which step, which choice, nothing else.
//
// Fire-and-forget: the emitter returns void and swallows every failure. A
// funnel event must never block, slow or break someone onboarding. The
// transport is injected (the screen passes apiPostNoContent), as every other
// lib/ module here takes its getter/poster.
// ---------------------------------------------------------------------------

export type FunnelEvent =
  | { type: 'onboarding_entry_viewed' }
  | { type: 'onboarding_step_reached'; metadata: { step: OnboardingStep } }
  | { type: 'onboarding_plausibility_resolved'; metadata: { action: PlausibilityAction } };

export type NoContentPoster = (path: string, body: unknown) => Promise<void>;

export function createFunnelEmitter(post: NoContentPoster): (event: FunnelEvent) => void {
  return (event) => {
    try {
      // Every event says it came from the app — stamped here, not at call sites.
      const body = { type: event.type, metadata: { ...('metadata' in event ? event.metadata : {}), platform: 'mobile' } };
      void post('/api/events', body).catch(() => { /* telemetry never breaks onboarding */ });
    } catch {
      /* same, for a synchronous throw */
    }
  };
}

/**
 * Which onboarding screen states are funnel steps. The app has no template
 * lane, so it can only reach these three. 'working', 'done' and the error
 * states are not steps.
 */
export const MOBILE_STEP_OF: Partial<Record<string, OnboardingStep>> = {
  plausibility: 'plausibility',
  accounts: 'accounts',
  payDates: 'anchor_dates',
};
