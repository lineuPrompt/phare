/**
 * Whether the plan screen should offer the way out to the dashboard.
 *
 * THE RULE: show it whenever the plan screen is up, EXCEPT when the screen is
 * already asking the user for something. There are exactly two such moments,
 * and both own the screen while they last:
 *
 *   - planSaveStatus === 'error' — the save failed and a Retry is sitting
 *     there. Leaving now abandons a plan that is genuinely not saved.
 *   - the replace-confirmation dialog is open — the server came back with
 *     needsConfirmation, NOTHING has been written, and the user is being asked
 *     to approve replacing existing data. A competing primary action here
 *     would let them walk away believing they were done.
 *
 * Everything else shows the button. In particular:
 *
 *   NOT GATED ON reviewStreaming. A letter still being written does not make
 *   the dashboard unreachable, and the plan itself is already fully rendered
 *   above it.
 *
 *   NOT GATED ON planSaveStatus === 'saved'. An earlier version of this
 *   required it, on the reasoning that navigating away mid-save could abandon
 *   an in-flight request. That was rejected deliberately: the "Saving your
 *   plan…" line renders directly beside the button while a save is in flight,
 *   so the user can see the state they are in, and the far more common failure
 *   was a user stranded on a finished plan screen with no visible way forward.
 *   A stranded user is certain; the mid-save exit is rare and self-signposted.
 *
 * A FAILED REVIEW STILL SHOWS THE BUTTON, and now for a simpler reason than
 * before — the review does not appear in this predicate at all. There is no
 * path by which a letter failing to generate can hide the way out.
 */

export type PlanSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function canGoToDashboard(state: {
  planSaveStatus: PlanSaveStatus;
  /** True while the needsConfirmation replace dialog is on screen. */
  replaceConfirmationOpen: boolean;
}): boolean {
  return state.planSaveStatus !== 'error' && !state.replaceConfirmationOpen;
}
