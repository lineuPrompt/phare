// Shared by the web Household page and the app's Household screen.
// Moved from src/lib/memberProvisioningHelpers.ts on 2026-11-04 (one copy).

// ---------------------------------------------------------------------------
// How a member's role should be DISPLAYED.
//
// This exists because of a real bug: the household page read the role from an
// embedded `users(...)` relation fetched with the caller's own session client.
// The users RLS policy is `id = auth.uid()`, so that embed returns NULL for
// every member except the caller — and the page's `?? 'member'` default turned
// "I am not allowed to read this" into "they are a member". Two owners rendered
// as one owner and one member, and the promote button offered an action that
// could never succeed.
//
// The fix is to source roles with the service-role client, but the defaulting
// is the part worth encoding here: an absent role is UNKNOWN. It is never
// silently downgraded to the least-privileged value, because "member" is a
// claim about a person, not a safe fallback.
// ---------------------------------------------------------------------------
export type MemberRoleView = 'owner' | 'member' | 'unknown' | 'not_invited';

export type MemberRoleInput = {
  user_id: string | null;
  users?: { role?: string | null } | null;
};

export function memberRoleView(member: MemberRoleInput): MemberRoleView {
  // No account at all — a name-only row from onboarding discovery or quick-add.
  // Genuinely has no role, which is different from having one we can't read.
  if (!member.user_id) return 'not_invited';

  const role = member.users?.role;
  if (role === 'owner') return 'owner';
  if (role === 'member') return 'member';

  // Row missing, or a role string outside the CHECK constraint. Either way we
  // do not know, and saying so is the only honest option.
  return 'unknown';
}
