import { NextResponse } from 'next/server';
import { loadEntitlement, type HouseholdReader } from '@/lib/entitlementServer';

// ---------------------------------------------------------------------------
// One server-side gate for every Pro-only route.
//
// Same doctrine as the review truncation: the SERVER enforces, the UI only
// presents, and both fail closed. A route that hand-rolled its own check could
// forget comp_until (paywalling a comped family) or forget the period end
// (granting access to a lapsed one) — single-word mistakes with billing
// consequences that no test of that one route would catch.
//
// WHAT THIS DOES NOT GATE, deliberately, because the pricing card promises them
// to the free tier and the card is the contract:
//   - goal tracking (explicitly "no limit" on the card)
//   - reserve funds, family sharing, spending tracking, EN/FR
//   - CSV export — also a Law 25 portability commitment in the Privacy Policy
//   - the onboarding plan itself
//   - reading EXISTING data of any kind, including categories a household
//     created while it was Pro
// ---------------------------------------------------------------------------

export type ProGateResult =
  | { allowed: true }
  | { allowed: false; response: NextResponse };

/**
 * Refuses with 403 and `code: 'pro_required'` when the household is not
 * entitled. The code is what the UI keys off to render a padlock rather than an
 * error — a paywall that surfaces as "something went wrong" teaches people the
 * product is broken.
 */
export async function requirePro(
  supabase: HouseholdReader,
  householdId: string,
  feature: string
): Promise<ProGateResult> {
  const entitlement = await loadEntitlement(supabase, householdId);
  if (entitlement.isPro) return { allowed: true };

  return {
    allowed: false,
    response: NextResponse.json(
      {
        error: 'This is part of Phare Pro.',
        code: 'pro_required',
        feature,
        locked: true,
      },
      { status: 403 }
    ),
  };
}
