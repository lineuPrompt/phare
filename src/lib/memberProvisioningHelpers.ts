import { memberRoleView, type MemberRoleInput } from '@phare/core';
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

// How a member's role is displayed lives in @phare/core (shared with the app).
export { memberRoleView, type MemberRoleView, type MemberRoleInput } from '@phare/core';

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

// ---------------------------------------------------------------------------
// HOUSEHOLD MEMBER CAP
//
// A hard product rule: a household may hold at most this many members with
// account access. Not a tier limit — it does not move with a subscription.
//
// The single source of the number. The route enforces it and the UI hides the
// invite form with it; neither may hardcode a 2 of its own, because a UI and
// an API disagreeing about a limit is how you get a form that submits into a
// rejection (or worse, a button that hides an action the server would allow).
//
// WHAT COUNTS: a household_members row with a user_id — someone who can sign
// in, or who has been invited and simply hasn't set a password yet. A PENDING
// invite therefore occupies a slot, which is the point: otherwise a household
// could invite unlimited people so long as none of them accepted.
//
// WHAT DOES NOT COUNT: name-only rows (user_id null). Those are created by
// onboarding discovery and quick-add to attribute income and expenses to
// people in the family — a spreadsheet naming three people creates three of
// them — and they carry no login. Counting them would cap a family's ability
// to attribute a child's expenses, and would block a household of three named
// people from ever inviting the second spouse. See the handoff: this is the
// one judgement call in the cap, and it is deliberately narrower than "count
// every household_members row".
// ---------------------------------------------------------------------------
export const HOUSEHOLD_MEMBER_CAP = 2;

/** True when the household already holds the maximum number of access-holding members. */
export function isAtMemberCap(accessHoldingMemberCount: number): boolean {
  return accessHoldingMemberCount >= HOUSEHOLD_MEMBER_CAP;
}

/** Members that occupy a cap slot: anyone with an account, pending or active. */
export function countAccessHoldingMembers(
  members: { user_id: string | null }[]
): number {
  return members.filter((m) => m.user_id !== null && m.user_id !== undefined).length;
}
