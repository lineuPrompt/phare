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
