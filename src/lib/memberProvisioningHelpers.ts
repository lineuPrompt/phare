// Pending-invite detection for household members.
//
// A member row with no user_id is name-only (never invited) — not this
// helper's concern, the household page's existing invite/add flow handles
// that case.
//
// For a member WITH a user_id, "pending" means the auth user was created via
// the invite flow (admin.auth.admin.createUser, email_confirm:true) but has
// never completed the set-password flow. email_confirmed_at is useless as a
// signal here — it's forced true at creation time regardless of whether the
// member ever signs in. last_sign_in_at is the reliable signal: it stays
// null until the member actually authenticates.
//
// Known gap, deliberately accepted: clicking the recovery link itself can
// establish a session (and so set last_sign_in_at) before the member submits
// a new password on /set-password. A member who clicks but abandons before
// finishing would read as "active" and lose the resend option. Not fixed
// here — no explicit "password set" event is tracked anywhere in this app
// today, and adding one is bigger scope than this feature asked for.
export function isPendingMember(userId: string | null, lastSignInAt: string | null): boolean {
  if (!userId) return false;
  return lastSignInAt === null || lastSignInAt === undefined;
}

// Locale for a provisioning email's set-password landing page.
//
// The invite/resend routes used to hardcode next=/en/dashboard, so a French
// family's invitee met Phare for the first time in English. households.locale
// is the household's own setting ('en'|'fr', NOT NULL, CHECK-constrained), so
// it's the honest source — an invitee has no preference of their own yet.
//
// The argument is whatever PostgREST returned for an embedded households(locale)
// select. That embed is typed loosely and can arrive as an object or a
// single-element array depending on how the relationship is detected, so both
// are accepted. Anything unrecognized falls back to 'en' rather than throwing:
// this decides which language an email's landing page is in, and a wrong guess
// must never be the reason an invite fails to send.
export function householdLocaleFrom(embedded: unknown): 'en' | 'fr' {
  const row = Array.isArray(embedded) ? embedded[0] : embedded;
  const locale = (row as { locale?: unknown } | null | undefined)?.locale;
  return locale === 'fr' ? 'fr' : 'en';
}

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

/**
 * Whether to offer "Make owner". Strictly for a known member — not merely
 * "not an owner", which is what let the button render for actual owners and
 * for people whose role simply hadn't loaded.
 *
 * Pending members are excluded: an owner who never set a password holds the
 * role without being able to sign in and use it. The server enforces both of
 * these independently; this only decides whether to show the control.
 */
export function canPromoteToOwner(member: MemberRoleInput & { pending?: boolean }): boolean {
  return memberRoleView(member) === 'member' && member.pending !== true;
}
