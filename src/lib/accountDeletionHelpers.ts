import { memberRoleView, type MemberRoleInput } from '@/lib/memberProvisioningHelpers';

// ---------------------------------------------------------------------------
// WHICH DELETION IS EVEN AVAILABLE TO THIS PERSON.
//
// Deleting an account means something different depending on who else is in the
// household, and getting it wrong destroys other people's data. The decision is
// isolated here, as a pure function over the member list, so it can be tested
// exhaustively without mocking Supabase — the routes and the UI both read their
// behaviour from this one place rather than each re-deriving it.
//
// The governing rule: A HOUSEHOLD IS NEVER DESTROYED WHILE SOMEONE ELSE CAN
// STILL SIGN IN TO IT. Everything below follows from that.
// ---------------------------------------------------------------------------

export type DeletionMember = MemberRoleInput & {
  id: string;
  /** true when an invite was issued but the person has never signed in. */
  pending: boolean;
  /** Set for a member who already deleted their account — already erased. */
  deleted_at?: string | null;
};

export type DeletionVerdict =
  /** Case B. Another owner remains, so the household carries on without them. */
  | { mode: 'self_delete' }
  /** Case A. Nobody else has an account at all — their account IS the household. */
  | { mode: 'household_delete'; reason: 'sole_member' }
  /**
   * Case A via the escape hatch. Others exist but NONE has ever signed in, so
   * there is no one to hand ownership to. Offered, never automatic — the route
   * and the UI both require a second, separate confirmation.
   */
  | { mode: 'household_delete'; reason: 'all_pending' }
  /** Blocked, with a way forward: promote one of these, then delete. */
  | { mode: 'blocked_promote'; candidates: { id: string; name?: string }[] }
  /**
   * Blocked with no automatic way forward: somebody else is active, but their
   * role could not be read as promotable. Deliberately NOT collapsed into the
   * escape hatch — offering to destroy the household here would destroy an
   * active person's data on the strength of a failed role lookup.
   */
  | { mode: 'blocked_no_path' };

/** Members who hold real access right now: an account, not a tombstone. */
export function liveAccessHolders<T extends DeletionMember>(members: T[]): T[] {
  return members.filter((m) => m.user_id != null && !m.deleted_at);
}

/**
 * Decide what deleting `selfMemberId`'s account would mean.
 *
 * `members` is the whole household, including the caller. Tombstoned rows are
 * ignored throughout: a former member is already erased and is not someone the
 * household can be handed to.
 */
export function decideDeletion(
  members: DeletionMember[],
  selfMemberId: string
): DeletionVerdict {
  const others = liveAccessHolders(members).filter((m) => m.id !== selfMemberId);

  // Nobody else has an account. Their account is the household.
  if (others.length === 0) {
    return { mode: 'household_delete', reason: 'sole_member' };
  }

  // Someone else is already an owner and can actually sign in — the household
  // has a custodian, so this is an ordinary Case B departure.
  const activeOthers = others.filter((m) => !m.pending);
  if (activeOthers.some((m) => memberRoleView(m) === 'owner')) {
    return { mode: 'self_delete' };
  }

  // Others exist but not one of them has ever signed in. There is no one to
  // promote — an invite that was never accepted cannot be handed a household.
  // This is the escape hatch, and it is the ONLY branch where a household with
  // other members in it may be destroyed.
  if (activeOthers.length === 0) {
    return { mode: 'household_delete', reason: 'all_pending' };
  }

  // Someone active remains. They must take over; the household is not the
  // caller's alone to destroy.
  const candidates = activeOthers.filter((m) => memberRoleView(m) === 'member');
  if (candidates.length > 0) {
    return {
      mode: 'blocked_promote',
      candidates: candidates.map((m) => ({ id: m.id, name: (m as { name?: string }).name })),
    };
  }

  // Active, but no readable promotable role. memberRoleView returns 'unknown'
  // rather than defaulting to 'member' precisely so this case stays visible
  // instead of silently becoming an offer to delete everything.
  return { mode: 'blocked_no_path' };
}

/**
 * Confirmation-phrase check.
 *
 * The phrase is the household's name (whole-household deletion) or the
 * caller's own email (self-deletion) — never a generic word like "DELETE",
 * which a person can type without reading, and which reads identically on
 * every screen in the product.
 *
 * Trimmed and case-insensitive on purpose: this is a gate against acting
 * without reading, not a spelling test. Someone who types their household's
 * name in the wrong case has demonstrated exactly the understanding being
 * checked for.
 */
export function confirmationMatches(expected: string | null | undefined, typed: unknown): boolean {
  if (typeof expected !== 'string' || expected.trim().length === 0) return false;
  if (typeof typed !== 'string') return false;
  return typed.trim().toLowerCase() === expected.trim().toLowerCase();
}
