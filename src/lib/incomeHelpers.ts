export type IncomeFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Converts a per-paycheque amount to a monthly equivalent.
 *
 * weekly:      52 pays/year ÷ 12 months
 * biweekly:    26 pays/year ÷ 12 months — NOT 2× per month; produces two windfall months/year
 * semimonthly: exactly 2× per month = 24 pays/year (no windfall, always predictable)
 * monthly:     1× per month
 *
 * Code owns this math. The user enters the paycheque amount; code computes the monthly figure.
 */
export function monthlyIncomeEquivalent(amount: number, frequency: IncomeFrequency): number {
  switch (frequency) {
    case 'weekly':      return round2(amount * 52 / 12);
    case 'biweekly':    return round2(amount * 26 / 12);
    case 'semimonthly': return round2(amount * 2);
    case 'monthly':     return round2(amount);
  }
}

/**
 * Resolves which household member an income row belongs to.
 *
 * Matches the template's "Member" name against real household_members by
 * exact name (case/whitespace-insensitive). Falls back to the current
 * onboarding user when there's no name to match, or the name doesn't match
 * anyone in the household — but the fallback is always reported back
 * (usedFallback / unmatchedName) so the caller can surface it, never apply
 * it silently.
 */
export function resolveMemberId(
  memberName: string | undefined,
  members: { id: string; name: string }[],
  fallbackMemberId: string | null
): { memberId: string | null; usedFallback: boolean; unmatchedName: string | null } {
  const trimmed = memberName?.trim();
  if (trimmed) {
    const match = members.find((m) => m.name.trim().toLowerCase() === trimmed.toLowerCase());
    if (match) {
      return { memberId: match.id, usedFallback: false, unmatchedName: null };
    }
    return { memberId: fallbackMemberId, usedFallback: true, unmatchedName: trimmed };
  }
  return { memberId: fallbackMemberId, usedFallback: true, unmatchedName: null };
}
