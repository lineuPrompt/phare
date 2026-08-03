/**
 * The version of the legal documents currently in force.
 *
 * Lives in code, not in the database, so publishing a revision is a deploy
 * rather than a migration — and so the version a user is shown and the version
 * recorded against their consent come from the same source in the same build.
 *
 * BUMP THIS whenever the substance of the Terms or the Privacy Policy changes.
 * Every user's stored terms_version then stops matching, the guard treats them
 * as unaccepted, and they are asked to consent again on their next visit.
 * That re-consent is the entire reason the version is recorded at all — a bare
 * "accepted: true" cannot survive its own documents being edited.
 *
 * Do NOT bump it for a typo fix or a formatting change: forcing a household
 * through a consent screen for a corrected comma trains people to click through
 * consent screens without reading, which is worse than the typo.
 *
 * Format is a date, not a semver, because that is what a reader of a legal
 * document expects to see and what the documents themselves display.
 */
export const CURRENT_LEGAL_VERSION = '2026-08-03';

/** True when a stored acceptance still matches the documents in force. */
export function hasAcceptedCurrent(
  acceptedAt: string | null | undefined,
  version: string | null | undefined
): boolean {
  if (!acceptedAt) return false;
  return version === CURRENT_LEGAL_VERSION;
}
