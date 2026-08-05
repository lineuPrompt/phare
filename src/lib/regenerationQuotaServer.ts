import { businessToday } from '@/lib/dateHelpers';
import { getHouseholdTimezone } from '@/lib/householdTimezone';
import { quotaFrom, REGENERATION_EVENT, type QuotaState } from '@/lib/regenerationQuota';

// ---------------------------------------------------------------------------
// Reading and reserving the monthly regeneration allowance.
//
// Counts rows in `events` rather than keeping a counter column: the events row
// is a record of what happened, so the count cannot disagree with the history.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = { from(table: string): any };

/** The household's own current month, 'YYYY-MM'. */
export async function currentQuotaMonth(supabase: Client, householdId: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const timezone = await getHouseholdTimezone(supabase as any, householdId);
  return businessToday(timezone).slice(0, 7);
}

/** Read-only: how much of the allowance is left. Never mutates. */
export async function readQuota(
  supabase: Client,
  householdId: string,
  month?: string
): Promise<QuotaState> {
  const m = month ?? (await currentQuotaMonth(supabase, householdId));

  const { count, error } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('household_id', householdId)
    .eq('event_type', REGENERATION_EVENT)
    .eq('metadata->>month', m);

  if (error) {
    // FAILS CLOSED. An unreadable count must not authorise the most expensive
    // call in the app — the same doctrine as every other gate here. Reported as
    // fully used so the caller refuses rather than guesses.
    console.error('Regeneration quota — count failed, treating as exhausted:', error);
    return quotaFrom(Number.MAX_SAFE_INTEGER, m);
  }

  return quotaFrom(count ?? 0, m);
}

export type ReserveResult =
  | { ok: true; quota: QuotaState }
  | { ok: false; reason: 'exhausted' | 'unavailable'; quota: QuotaState };

/**
 * Claim one regeneration, BEFORE doing the work.
 *
 * Reserve-then-generate, deliberately: a failed generation consumes a slot.
 * The alternative — generate then record — makes a failing prompt retryable
 * without limit, which is precisely the cost this exists to bound. At four a
 * month a rare failure is not punishing; an unbounded retry loop on the most
 * expensive prompt in the app is.
 *
 * The insert is AWAITED and its failure is fatal, unlike logEvent which
 * deliberately swallows errors so analytics can never break a user action.
 * That is right for analytics and wrong for a quota: a swallowed write is an
 * uncounted regeneration, and enough of those make the limit fiction.
 */
export async function reserveRegeneration(
  supabase: Client,
  householdId: string,
  userId: string | null,
  /**
   * The household's own 'YYYY-MM'. Passed in by callers that have already
   * resolved the timezone — the regenerate route computes it a few lines later
   * anyway, and looking it up twice is a second round trip for an answer we
   * already have.
   */
  knownMonth?: string
): Promise<ReserveResult> {
  const month = knownMonth ?? (await currentQuotaMonth(supabase, householdId));
  const quota = await readQuota(supabase, householdId, month);

  if (!quota.allowed) return { ok: false, reason: 'exhausted', quota };

  const { error } = await supabase.from('events').insert({
    household_id: householdId,
    user_id: userId,
    event_type: REGENERATION_EVENT,
    // The month lives on the row so counting is an equality match rather than
    // timestamp arithmetic against a moving timezone boundary.
    metadata: { month },
  });

  if (error) {
    console.error('Regeneration quota — could not reserve, refusing:', error);
    return { ok: false, reason: 'unavailable', quota };
  }

  const used = quota.used + 1;
  return { ok: true, quota: quotaFrom(used, month) };
}
