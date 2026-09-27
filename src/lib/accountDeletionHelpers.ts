import { memberRoleView, type MemberRoleInput } from '@/lib/memberProvisioningHelpers';
import { confirmationMatches, type DeletionVerdict } from '@phare/core';

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

// DeletionVerdict and confirmationMatches live in @phare/core
// (packages/core/src/accountDeletion.ts): the mobile deletion screen renders the
// same verdict and gates its button on the same phrase check the routes use.
export { confirmationMatches, type DeletionVerdict };

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
