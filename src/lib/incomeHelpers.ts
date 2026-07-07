export type IncomeFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Converts a per-payment amount to a monthly equivalent. Used for both income
 * (per-paycheque) and fixed expenses (per-payment, e.g. a bi-weekly mortgage
 * payment) — the math is identical either direction, so there is exactly one
 * conversion point for the whole app.
 *
 * weekly:      52 pays/year ÷ 12 months
 * biweekly:    26 pays/year ÷ 12 months — NOT 2× per month; produces two windfall months/year
 * semimonthly: exactly 2× per month = 24 pays/year (no windfall, always predictable)
 * monthly:     1× per month
 *
 * Code owns this math. The user enters the per-payment amount; code computes the monthly figure.
 */
export function monthlyEquivalent(amount: number, frequency: IncomeFrequency): number {
  switch (frequency) {
    case 'weekly':      return round2(amount * 52 / 12);
    case 'biweekly':    return round2(amount * 26 / 12);
    case 'semimonthly': return round2(amount * 2);
    case 'monthly':     return round2(amount);
  }
}

// Template values that mean "this income belongs to the household as a
// whole, not to any one person" — e.g. child benefits. Case/accent-insensitive.
const HOUSEHOLD_NAMES = new Set(['household', 'menage', 'menage familial']);

/** Case/accent/whitespace-insensitive normalization shared by every tier of matching. */
function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics (e.g. accented -> unaccented)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export type MemberNameMatch =
  | { kind: 'household' }
  | { kind: 'member'; memberId: string }
  | { kind: 'unmatched' };

/**
 * Tiered, pure name-matching logic for the template's "Member" column.
 * Never guesses: a match is only returned when it is unambiguous.
 *
 *  (a) exact full-name match, case/whitespace-insensitive
 *  (b) unique first-name match — "Julia" matches "Julia Alff" iff exactly
 *      one household member's first name is Julia; two Julias is never
 *      resolved to either one
 *  (c) accent-insensitive throughout (é/e, ç/c, ...), both sides normalized
 *
 * "Household" / "Ménage" / "Ménage familial" resolve to household-level
 * income (no member at all) before any person-matching is attempted.
 */
export function resolveMemberName(name: string, members: { id: string; name: string }[]): MemberNameMatch {
  const normalized = normalizeName(name);
  if (!normalized) return { kind: 'unmatched' };
  if (HOUSEHOLD_NAMES.has(normalized)) return { kind: 'household' };

  const exact = members.find((m) => normalizeName(m.name) === normalized);
  if (exact) return { kind: 'member', memberId: exact.id };

  const firstNameMatches = members.filter((m) => normalizeName(m.name).split(' ')[0] === normalized);
  if (firstNameMatches.length === 1) return { kind: 'member', memberId: firstNameMatches[0].id };

  return { kind: 'unmatched' };
}

/**
 * Resolves which household member (or the household itself) an income row
 * belongs to, via resolveMemberName's tiered matching. Falls back to the
 * current onboarding user when there's no name to match, or the name
 * doesn't match anyone in the household — but the fallback is always
 * reported back (usedFallback / unmatchedName) so the caller can surface
 * it, never apply it silently. Household-level income is reported via
 * isHousehold and must never be treated as an unmatched fallback.
 */
export function resolveMemberId(
  memberName: string | undefined,
  members: { id: string; name: string }[],
  fallbackMemberId: string | null
): { memberId: string | null; usedFallback: boolean; unmatchedName: string | null; isHousehold: boolean } {
  const trimmed = memberName?.trim();
  if (!trimmed) {
    return { memberId: fallbackMemberId, usedFallback: true, unmatchedName: null, isHousehold: false };
  }

  const match = resolveMemberName(trimmed, members);
  if (match.kind === 'household') {
    return { memberId: null, usedFallback: false, unmatchedName: null, isHousehold: true };
  }
  if (match.kind === 'member') {
    return { memberId: match.memberId, usedFallback: false, unmatchedName: null, isHousehold: false };
  }
  return { memberId: fallbackMemberId, usedFallback: true, unmatchedName: trimmed, isHousehold: false };
}
