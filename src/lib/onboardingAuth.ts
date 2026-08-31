import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import {
  reserveOnboardingGeneration,
  currentOnboardingMonth,
} from '@/lib/onboardingQuotaServer';
import type { OnboardingQuotaEvent } from '@/lib/onboardingQuota';
import type { QuotaState } from '@/lib/onboardingQuota';

// ---------------------------------------------------------------------------
// The identity gate for the three onboarding routes.
//
// WHY THESE THREE NEEDED IT. /api/plan, /api/review-stream and /api/upload were
// unauthenticated. Their headers said "pre-signup", and that was simply wrong:
// signup creates the household (handle_new_user) and onboarding runs after it,
// which is why the very same page already calls /api/accounts,
// /api/household/members, /api/anchors and /api/save-plan — all of which return
// 401 without a session. The legitimate flow always had a session; the routes
// just never asked for one.
//
// WHAT ASKING BUYS. Not a spend wall — signup is open and free, so a throwaway
// account is thirty seconds away. It buys two things that matter anyway:
//   1. A key that survives CGNAT. This is the mobile blocker. Many households
//      share one carrier IP, so an IP-keyed limit either locks out real users
//      or counts nothing. household_id is stable and unshared.
//   2. Attribution. Every reserved generation now carries a user_id, so abuse
//      is visible and cuttable instead of anonymous.
//
// MOBILE WORKS FOR FREE. supabase-server.ts's createClient() already matches
// `Authorization: Bearer <jwt>` and builds a token client, falling through to
// cookies otherwise. Calling it here is all the mobile app needs.
// ---------------------------------------------------------------------------

/** 401 body. Carries a code, because these routes' clients map code → i18n key. */
export const NOT_AUTHENTICATED = {
  code: 'NOT_AUTHENTICATED',
  error: 'You need to be signed in to do this.',
} as const;

export type OnboardingSession = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  householdId: string;
};

export type OnboardingAuthResult =
  | { ok: true; session: OnboardingSession }
  | { ok: false; response: NextResponse };

/**
 * Resolves the caller to a household, or refuses.
 *
 * THE HOUSEHOLD IS DERIVED, NEVER ASSERTED — read from `users` keyed on the
 * verified user id, exactly as every other authenticated route does. Nothing
 * the caller sends names a household, so there is no field to lie in.
 *
 * A signed-in user with no household row is a 401 rather than a 400: it is not
 * a state a real account reaches (the signup trigger creates the household),
 * and treating it as "not authenticated" avoids inventing a fourth code for a
 * case that should never happen.
 */
export async function requireOnboardingSession(): Promise<OnboardingAuthResult> {
  const supabase = await createClient();

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { ok: false, response: NextResponse.json(NOT_AUTHENTICATED, { status: 401 }) };
  }

  const { data: userRow } = await supabase
    .from('users')
    .select('household_id')
    .eq('id', user.id)
    .single();

  if (!userRow?.household_id) {
    return { ok: false, response: NextResponse.json(NOT_AUTHENTICATED, { status: 401 }) };
  }

  return {
    ok: true,
    session: { supabase, userId: user.id, householdId: userRow.household_id },
  };
}

/**
 * The 429 body for an exhausted or unreadable allowance.
 *
 * `resetsOn` is the whole point of returning a structured body: a household
 * that legitimately re-onboarded and hit the ceiling needs to know WHEN it
 * clears, not merely that it was hit. The date is 'YYYY-MM-DD' and the client
 * formats it in its own locale — these routes compose no localized prose, the
 * same doctrine the rest of the API follows.
 *
 * An UNREADABLE quota returns this same code, deliberately. Fail-closed means
 * the caller is refused; giving that its own code would invite a client to
 * treat it as retryable, which is exactly what an unmetered spend path must
 * not be.
 */
export function quotaExhaustedResponse(quota: QuotaState): NextResponse {
  return NextResponse.json(
    {
      code: 'ONBOARDING_QUOTA_EXHAUSTED',
      error: `This household has used all ${quota.limit} onboarding generations for this month. The allowance refills on ${quota.resetsOn}.`,
      quota,
      resetsOn: quota.resetsOn,
    },
    { status: 429 }
  );
}

/**
 * Session + one reserved generation, or the refusal to return.
 *
 * Used by the two routes that spend Anthropic tokens. /api/upload calls
 * requireOnboardingSession() alone: it spends no model tokens, and it is the
 * one onboarding route a legitimate user fires repeatedly — a wrong-file
 * response sends them back to re-download and drop again, so a quota there
 * would refuse honest people to bound CPU that the body-size cap already
 * bounds.
 */
export async function requireOnboardingGeneration(
  event: OnboardingQuotaEvent
): Promise<
  | { ok: true; session: OnboardingSession; quota: QuotaState }
  | { ok: false; response: NextResponse }
> {
  const auth = await requireOnboardingSession();
  if (!auth.ok) return auth;

  const { supabase, userId, householdId } = auth.session;
  const month = await currentOnboardingMonth(supabase, householdId);
  const reservation = await reserveOnboardingGeneration(
    supabase, householdId, userId, event, month
  );

  if (!reservation.ok) {
    return { ok: false, response: quotaExhaustedResponse(reservation.quota) };
  }

  return { ok: true, session: auth.session, quota: reservation.quota };
}
