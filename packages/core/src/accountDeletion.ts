// ---------------------------------------------------------------------------
// Account deletion — the parts both the web section and the mobile screen
// read. The verdict itself is decided server-side (decideDeletion, in the web
// app's accountDeletionHelpers.ts, over the live member list); clients only
// render it and gate the button.
// ---------------------------------------------------------------------------

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
 *
 * The routes and every client use this one function, so the button can never
 * be enabled for a phrase the server would refuse, or disabled for one it
 * would accept.
 */
export function confirmationMatches(expected: string | null | undefined, typed: unknown): boolean {
  if (typeof expected !== 'string' || expected.trim().length === 0) return false;
  if (typeof typed !== 'string') return false;
  return typed.trim().toLowerCase() === expected.trim().toLowerCase();
}
