/**
 * When onboarding is finished enough to offer the way out.
 *
 * WHY THIS IS A FUNCTION AND NOT AN INLINE `&&` IN THE JSX.
 *
 * The rule it encodes is a safety rule, not a cosmetic one. The onboarding
 * save is a plain client-side `fetch('/api/save-plan')` and there is NO
 * beforeunload guard anywhere in this codebase — so the cost of showing this
 * button one state too early is a user who taps it mid-save. A rule with that
 * consequence should be stated once, in a place a test can reach, rather than
 * buried in a render expression that nothing can assert on. This repo runs
 * Vitest in a `node` environment with no jsdom and no testing-library, so an
 * inline condition would be genuinely untestable.
 *
 * WHAT "SAFE" MEANS HERE, precisely:
 *
 *   planSaveStatus === 'saved' is set in doSave() only after the response came
 *   back ok AND was not a `needsConfirmation` reply. It is the one state in
 *   which the plan is known to be persisted. 'saving' is in flight; 'idle' is
 *   also what a needsConfirmation reply resets to, so the replace dialog is
 *   still open and nothing has been written; 'error' has an unsaved plan and a
 *   Retry sitting next to it.
 *
 *   !reviewStreaming is REDUNDANT TODAY and kept deliberately. streamReview()
 *   clears the flag in its `finally` and only then calls doSave(), so a
 *   'saved' status already implies streaming has stopped. It is asserted here
 *   so that reordering those two — moving the save earlier, or making the
 *   review resumable — cannot silently start rendering this button over a
 *   half-written letter. The redundancy is the point.
 *
 * A REVIEW FAILURE MUST NOT STRAND THE USER, and this rule gets that for free
 * rather than by special-casing it. streamReview() calls doSave()
 * unconditionally after its try/catch/finally, with placeholder copy when the
 * prose failed, so a failed review still reaches planSaveStatus === 'saved'
 * and the button still appears. There is no `reviewText` term in this
 * predicate on purpose: adding one would reintroduce exactly the coupling
 * between "the letter worked" and "the plan is safe" that the save flow was
 * restructured to remove.
 */

export type PlanSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function canGoToDashboard(state: {
  planSaveStatus: PlanSaveStatus;
  reviewStreaming: boolean;
}): boolean {
  return state.planSaveStatus === 'saved' && !state.reviewStreaming;
}
