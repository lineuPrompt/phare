/**
 * Event logger — lightweight trial diary.
 *
 * Rules:
 *   1. logEvent NEVER throws. Tracking must never break the user action.
 *   2. isFirstEvent / isFirstReturnToday return false on DB error (conservative:
 *      prefer missing an event over logging a duplicate on error).
 *   3. No UI. No dashboard. Data is read via Supabase SQL editor.
 */

// Minimal structural type — only the from() shape we actually use.
// Compatible with both the real Supabase client and test mocks.
export interface EventClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}

export type EventType =
  | 'signup'
  | 'completed_onboarding'
  | 'created_first_expense'
  | 'viewed_planner'
  | 'created_first_goal'
  | 'added_second_family_member'
  | 'returned'
  // The monthly review actually being shown to the user (not merely the
  // dashboard loading) — the strongest available retention predictor, per
  // the Coaching Layer spec. Fired from GET /api/dashboard's full (non-
  // snapshotOnly) load, gated on a non-empty review string.
  | 'viewed_monthly_review'
  // reviewText's post-generation guards (category-sourcing leak, borrowed-
  // cash mislabeling) required a retry — the only production visibility
  // into how often the model actually violates these soft-instruction-
  // backed rules. Fired from POST /api/regenerate-plan whenever the first
  // attempt fails either check; metadata carries which check(s) triggered
  // it and whether the retry passed or which deterministic fallback was
  // used. Never fired on the common (clean-first-attempt) path.
  | 'review_text_guard_retried'
  // FUNNEL INSTRUMENTATION (2026-07-31) — these events look unused right
  // now; they aren't. They exist so that, once there's enough data (aimed
  // at November), someone can ask retention questions this app currently
  // has no way to answer: do families who create a goal (completed_onboarding
  // → created_first_goal) retain better than those who never do? Does
  // opening Timeline predict retention more strongly than opening the
  // monthly review does (timeline_opened vs. viewed_monthly_review, the
  // existing "strongest available retention predictor" per the Coaching
  // Layer spec)? None of that can be asked without the raw event rows
  // existing first — this is that raw data, not a dashboard, not analyzed
  // yet. Fired from GET /api/timeline, gated on a `pageView` marker so the
  // dashboard's own /api/timeline call (for the dip tile) never counts as
  // "Timeline opened" — see that route for the distinguishing signal. Fires
  // on every real page load, same convention as viewed_monthly_review (no
  // isFirstEvent gate — this is a frequency signal, not a one-time
  // milestone); the Timeline page itself only calls this once per mount
  // (month navigation re-slices client-side, no refetch), so this is
  // already "once per real load, never per nav" by construction on the
  // client side, not by a dedup check here.
  | 'timeline_opened'
  // A member was given the owner role after the fact (POST
  // /api/household/members/[id]/promote). Role was previously assignable only
  // at invite time and immutable thereafter, so every one of these rows is a
  // deliberate administrative act by an existing owner — worth a trail both
  // for support ("who made them an owner?") and because it is the step that
  // unblocks the last owner deleting their account. metadata carries the
  // household_members id and the promoted user's id; user_id on the row is
  // the OWNER who performed it, not the person promoted.
  | 'member_promoted_to_owner'
  // A pending invite was revoked (DELETE /api/household/members/[id]) — the
  // auth user is deleted and the household_members row reverts to name-only,
  // freeing one of the household's capped slots. Only ever fires for someone
  // who never signed in; removing an active member is account deletion and
  // will have its own event. metadata carries the household_members id and
  // the deleted user's id; user_id on the row is the OWNER who did it.
  | 'pending_member_removed'
  // A member deleted their OWN account and the household survived — Case B
  // (DELETE /api/me). Distinct from 'pending_member_removed', which is an
  // owner revoking an invite for someone who never signed in.
  //
  // user_id on the row is the departing member, and it goes NULL the moment
  // the auth step succeeds (events.user_id is ON DELETE SET NULL against
  // auth.users) — which is correct: the event must outlive the identity, and
  // the erasure is the point. metadata therefore carries the household_members
  // id and the deletion-request id, which are what remain queryable
  // afterwards; it deliberately does NOT carry the email, since
  // member_deletion_requests already holds that under household-scoped RLS
  // and duplicating it here would widen the erasure's own footprint.
  | 'member_self_deleted'
  // One Pro review regeneration. UNLIKE every other event here, this one is
  // load-bearing rather than diagnostic: it IS the monthly quota counter, so
  // it is written with an awaited insert in regenerationQuotaServer.ts rather
  // than through logEvent's deliberately-swallowed path. metadata.month is the
  // household's own calendar month, which is what the count matches on.
  | 'review_regenerated';

/**
 * Insert one event row.
 * Catches all errors internally — tracking failures must not surface to the caller.
 */
export async function logEvent(
  supabase: EventClient,
  householdId: string,
  userId: string | null,
  eventType: EventType,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const { error } = await supabase.from('events').insert({
      household_id: householdId,
      user_id: userId,
      event_type: eventType,
      metadata: metadata ?? null,
    });
    if (error) {
      console.error(`[events] logEvent ${eventType}:`, error.message);
    }
  } catch (err) {
    console.error(`[events] logEvent ${eventType} threw:`, err);
  }
}

/**
 * Returns true if this event_type has never been logged for this household.
 * Used to fire "created_first_X" events exactly once.
 * Returns false on DB error — conservative default prevents duplicate fires.
 */
export async function isFirstEvent(
  supabase: EventClient,
  householdId: string,
  eventType: EventType
): Promise<boolean> {
  try {
    const { count, error } = await supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('household_id', householdId)
      .eq('event_type', eventType);
    if (error) {
      console.error(`[events] isFirstEvent ${eventType}:`, error.message);
      return false;
    }
    return (count ?? 0) === 0;
  } catch (err) {
    console.error(`[events] isFirstEvent ${eventType} threw:`, err);
    return false;
  }
}

/**
 * Returns true if no 'returned' event has been logged today (UTC) for this user.
 * Deduplicated per user per UTC calendar day so the heartbeat fires once per day.
 * Returns false on DB error — conservative default prevents duplicate fires.
 */
export async function isFirstReturnToday(
  supabase: EventClient,
  householdId: string,
  userId: string
): Promise<boolean> {
  try {
    const now = new Date();
    // UTC day boundaries
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dayEnd   = new Date(dayStart.getTime() + 86_400_000); // +1 day

    const { count, error } = await supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('household_id', householdId)
      .eq('user_id', userId)
      .eq('event_type', 'returned')
      .gte('created_at', dayStart.toISOString())
      .lt('created_at', dayEnd.toISOString());

    if (error) {
      console.error('[events] isFirstReturnToday:', error.message);
      return false;
    }
    return (count ?? 0) === 0;
  } catch (err) {
    console.error('[events] isFirstReturnToday threw:', err);
    return false;
  }
}
