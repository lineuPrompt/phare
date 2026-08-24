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
export function normalizeName(s: string): string {
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
 *  (b) unique first-name match, checked on BOTH sides — "Julia" matches
 *      "Julia Alff" (short input, full candidate) AND "Julia Alff" matches
 *      a candidate named just "Julia" (full input, short candidate — e.g. a
 *      name-only member created during onboarding, later invited by full
 *      name). Two Julias is never resolved to either one.
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

  const firstToken = normalized.split(' ')[0];
  const firstNameMatches = members.filter((m) => normalizeName(m.name).split(' ')[0] === firstToken);
  if (firstNameMatches.length === 1) return { kind: 'member', memberId: firstNameMatches[0].id };

  return { kind: 'unmatched' };
}

/**
 * Every existing member matching `name` under the same tiers as
 * resolveMemberName (exact, then first-name in either direction) — WITHOUT
 * collapsing multiple matches down to "unmatched". Used where the caller
 * needs to tell "no match" apart from "ambiguous, ask a human" instead of
 * treating both the same way resolveMemberName's silent-fallback callers do
 * (e.g. the member-invite endpoint's match-before-create check: a unique
 * result attaches automatically, an ambiguous one must ask the owner to
 * pick, never guess).
 */
export function findMemberNameCandidates(
  name: string,
  members: { id: string; name: string }[]
): { id: string; name: string }[] {
  const normalized = normalizeName(name);
  if (!normalized) return [];

  const exact = members.filter((m) => normalizeName(m.name) === normalized);
  if (exact.length > 0) return exact;

  const firstToken = normalized.split(' ')[0];
  return members.filter((m) => normalizeName(m.name).split(' ')[0] === firstToken);
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

/**
 * Which distinct Member-column names, across a set of income lines, don't
 * resolve to an existing household member or a household keyword. Used to
 * decide which names need the "is this part of your household?"
 * confirmation before a plan is generated — so a plan is born with correct
 * attribution instead of being patched after saving.
 *
 * Deduped case/accent/whitespace-insensitively — "Julia" and "julia" across
 * two lines produce exactly one entry, in the casing of its first
 * occurrence. Blank cells and household keywords are never included:
 * there is nothing to confirm about them.
 */
export function collectUnresolvedMemberNames(
  memberCells: (string | undefined)[],
  existingMembers: { id: string; name: string }[]
): string[] {
  const seenKeys = new Set<string>();
  const result: string[] = [];
  for (const cell of memberCells) {
    const trimmed = cell?.trim();
    if (!trimmed) continue;
    const key = normalizeName(trimmed);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    if (resolveMemberName(trimmed, existingMembers).kind === 'unmatched') {
      result.push(trimmed);
    }
  }
  return result;
}
