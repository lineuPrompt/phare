import { businessToday } from '@phare/core';
import { getHouseholdTimezone } from '@/lib/householdTimezone';
import {
  onboardingQuotaFrom,
  type OnboardingQuotaEvent,
  type QuotaState,
} from '@/lib/onboardingQuota';

// ---------------------------------------------------------------------------
// Reading and reserving an onboarding generation.
//
// Counts rows in `events` rather than keeping a counter column, for the same
// reason regenerationQuotaServer does: the event row IS the record of what
// happened, so the count cannot disagree with the history, and there is no
// increment to lose.
//
// This is deliberately a near-twin of regenerationQuotaServer rather than a
// shared generic. The two differ in event type, limit, and — critically — in
// what a failure means: that one guards a Pro entitlement, this one guards an
// unauthenticated-until-now onboarding path. Folding them into one
// parameterised helper would put both behind a single edit, and a wrong edit
// there is either a free-tier household billed for Pro work or an onboarding
// that refuses every real user. The duplication is the cheaper risk.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = { from(table: string): any };

/** The household's own current month, 'YYYY-MM'. */
export async function currentOnboardingMonth(
  supabase: Client,
  householdId: string
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const timezone = await getHouseholdTimezone(supabase as any, householdId);
  return businessToday(timezone).slice(0, 7);
}

/** Read-only: how much of this month's allowance is left. Never mutates. */
export async function readOnboardingQuota(
  supabase: Client,
  householdId: string,
  event: OnboardingQuotaEvent,
  month?: string
): Promise<QuotaState> {
  const m = month ?? (await currentOnboardingMonth(supabase, householdId));

  const { count, error } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('household_id', householdId)
    .eq('event_type', event)
    .eq('metadata->>month', m);

  if (error) {
    // FAILS CLOSED, matching regenerationQuotaServer exactly. An unreadable
    // count must not authorise a paid model call — reported as fully used so
    // the caller refuses rather than guesses. A household briefly refused is
    // recoverable; an unmetered spend path is not.
    console.error('Onboarding quota — count failed, treating as exhausted:', error);
    return onboardingQuotaFrom(Number.MAX_SAFE_INTEGER, m);
  }

  return onboardingQuotaFrom(count ?? 0, m);
}

export type OnboardingReserveResult =
  | { ok: true; quota: QuotaState }
  | { ok: false; reason: 'exhausted' | 'unavailable'; quota: QuotaState };

/**
 * Claim one generation, BEFORE calling the model.
 *
 * Reserve-then-generate, deliberately: a failed generation consumes a slot.
 * Generate-then-record would make a failing prompt retryable without limit,
 * which is precisely the spend this exists to bound. At ten a month a rare
 * failure is not punishing.
 *
 * The insert is AWAITED and its failure is fatal — unlike logEvent, which
 * swallows errors so analytics can never break a user action. That is right
 * for analytics and wrong for a quota: a swallowed write is an uncounted
 * generation, and enough of those make the limit fiction.
 */
export async function reserveOnboardingGeneration(
  supabase: Client,
  householdId: string,
  userId: string | null,
  event: OnboardingQuotaEvent,
  knownMonth?: string
): Promise<OnboardingReserveResult> {
  const month = knownMonth ?? (await currentOnboardingMonth(supabase, householdId));
  const quota = await readOnboardingQuota(supabase, householdId, event, month);

  if (!quota.allowed) return { ok: false, reason: 'exhausted', quota };

  const { error } = await supabase.from('events').insert({
    household_id: householdId,
    user_id: userId,
    event_type: event,
    // The month lives on the row so counting is an equality match rather than
    // timestamp arithmetic against a moving timezone boundary.
    metadata: { month },
  });

  if (error) {
    console.error('Onboarding quota — could not reserve, refusing:', error);
    return { ok: false, reason: 'unavailable', quota };
  }

  return { ok: true, quota: onboardingQuotaFrom(quota.used + 1, month) };
}
