// ---------------------------------------------------------------------------
// The onboarding funnel's vocabulary — one list, shared by the web page, the
// mobile screen and the server that validates what they send. 2026-09-29.
//
// Every value here is an enum member, never free text: the events carry which
// step, which choice, which refusal — never a name, an amount or a file name.
// The web allowlist (src/lib/clientEvents.ts) builds its accepted values from
// these arrays, so a step a client can emit and a step the server accepts
// cannot drift apart.
// ---------------------------------------------------------------------------

/**
 * The steps between choosing a lane and seeing a plan, in the order a
 * household meets them. Not every household meets every step:
 *   upload_parsed   — template lane only: the file was accepted and parsed.
 *   member_confirm  — template lane only, and only when an income row names
 *                     someone the household doesn't have yet.
 *   plausibility    — only when the numbers (or skipped rows) need a second look.
 *   accounts        — everyone: cards and the chequing opening balance.
 *   anchor_dates    — only when a saved line still needs a real pay date.
 * Mobile has no template lane, so it can reach only the last three.
 */
export const ONBOARDING_STEPS = [
  'upload_parsed',
  'member_confirm',
  'plausibility',
  'accounts',
  'anchor_dates',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/**
 * Where a funnel event came from. Every onboarding event carries one, so the
 * funnel can be read per platform (2026-09-29). Clients stamp it in their
 * emitter; the server derives it from the transport for the events it writes.
 */
export const CLIENT_PLATFORMS = ['web', 'mobile'] as const;
export type ClientPlatform = (typeof CLIENT_PLATFORMS)[number];

/** What a household did with the plausibility warning. */
export const PLAUSIBILITY_ACTIONS = ['confirm', 'correct'] as const;
export type PlausibilityAction = (typeof PLAUSIBILITY_ACTIONS)[number];

/** Why /api/upload turned a file away. Written by the server, never a client. */
export const UPLOAD_REJECTION_REASONS = [
  'no_file',
  'unsupported_type',
  'wrong_file',
  'outdated_template',
  'parse_failed',
] as const;
export type UploadRejectionReason = (typeof UPLOAD_REJECTION_REASONS)[number];

/**
 * Which step, if any, a screen state is — and only on ENTERING it. Returns
 * null when the state is not a funnel step, or is the same step the screen
 * was already on (a re-render, or a state that carries new data but is the
 * same screen). Each platform passes its own state→step map.
 */
export function stepEntered<S extends string>(
  previous: S | null,
  next: S,
  stepOf: Partial<Record<S, OnboardingStep>>
): OnboardingStep | null {
  const step = stepOf[next] ?? null;
  if (step === null) return null;
  if (previous !== null && stepOf[previous] === step) return null;
  return step;
}
