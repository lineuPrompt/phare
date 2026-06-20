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
  | 'returned';

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
