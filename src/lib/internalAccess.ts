// ---------------------------------------------------------------------------
// Internal-only surfaces.
//
// Some pages exist for the person building Phare, not for the households using
// it. The Audit page (/reconcile) is the first: it renders two independently
// derived nets side by side and calls a delta "the bug". That is a debugging
// instrument. Shown to a household, it does not read as a feature — it reads
// as an admission that the numbers might be wrong.
//
// WHY NOT THE EXISTING GATES:
//   - requirePro would sell debugging as a paid feature. It was gated that way
//     until 2026-08-12; the pricing card advertised it, which is what made the
//     problem visible.
//   - role === 'owner' is the wrong axis entirely. Every household has an
//     owner. Owner means "runs this household", not "develops this product".
//
// WHY AN ENV VAR RATHER THAN A CONST:
//   Household ids are stable identifiers for real people's data. Kept out of
//   the repo they cannot be read from git history, and — with no NEXT_PUBLIC_
//   prefix — Next never inlines them into a client bundle, so the list is
//   invisible in the browser. Changing who is on it is an environment edit,
//   not a deploy.
//
// FAILS CLOSED. Unset or empty means NOBODY, including in local dev. A gate
// that defaults to open when its config is missing is not a gate — and the
// missing-config case (fresh checkout, forgotten Vercel var, typo'd name) is
// exactly when nobody is watching. If /reconcile 404s for you, the variable
// is not set in that environment; that is this function working.
//
// Read at call time, not module scope: a value captured at import would freeze
// whatever the environment held when the lambda cold-started.
// ---------------------------------------------------------------------------

/**
 * True only for household ids listed in `PHARE_INTERNAL_HOUSEHOLD_IDS`
 * (comma-separated). Comparison is case-insensitive and whitespace-tolerant so
 * a copy-pasted list with spaces or a capitalised UUID still matches.
 *
 * SERVER ONLY. The variable has no NEXT_PUBLIC_ prefix, so in a client
 * component `process.env.PHARE_INTERNAL_HOUSEHOLD_IDS` is undefined and this
 * returns false for everyone. That is the safe direction, but it means the
 * check must live in a route handler or a server component — never in the
 * browser. The client learns the answer as a boolean from /api/me.
 */
export function isInternalHousehold(householdId: string | null | undefined): boolean {
  if (!householdId) return false;

  const raw = process.env.PHARE_INTERNAL_HOUSEHOLD_IDS ?? '';
  if (!raw.trim()) return false;

  const allowed = raw
    .split(',')
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);

  return allowed.includes(householdId.trim().toLowerCase());
}
