import { confirmationMatches, type DeletionVerdict } from '@phare/core';
import { ApiError, messageKeyFor } from './apiErrors';
import type { Getter } from './timelineLoader';
import type { Poster } from './onboardingFlow';

// ---------------------------------------------------------------------------
// Account deletion on mobile: the web DeleteAccountSection's rules, with the
// same routes and the same phrase check (confirmationMatches, from core).
//
// THE SERVER DECIDES WHAT DELETION MEANS. GET /api/household/deletion-preview
// returns a verdict computed over the live member list, and both DELETE routes
// recompute it rather than trusting the preview. This module only renders the
// verdict, gates the button, and reads the outcome.
// ---------------------------------------------------------------------------

export type BlastRadius = {
  members: number;
  accounts: number;
  transactions: number;
  recurringItems: number;
  sinkingFunds: number;
  reviews: number;
  monthsOfHistory: number;
};

export type DeletionPreview = {
  verdict: DeletionVerdict;
  householdName: string | null;
  blastRadius: BlastRadius | null;
  confirmWith: { field: 'confirmHouseholdName' | 'confirmEmail'; phrase: string | null };
};

const MODES = new Set(['self_delete', 'household_delete', 'blocked_promote', 'blocked_no_path']);

/**
 * The preview, checked before anything is drawn from it. A verdict this app
 * does not know is an error: rendering an unknown mode as some default would
 * mean guessing what deleting destroys.
 */
export async function loadDeletionPreview(get: Getter): Promise<DeletionPreview> {
  const data = await get<DeletionPreview>('/api/household/deletion-preview');
  if (!data || !data.verdict || !MODES.has(data.verdict.mode)) {
    throw new Error('deletion-preview answered with no verdict this app understands');
  }
  if (
    !data.confirmWith ||
    (data.confirmWith.field !== 'confirmEmail' && data.confirmWith.field !== 'confirmHouseholdName')
  ) {
    throw new Error('deletion-preview answered without a confirmation field');
  }
  return data;
}

/** Which route, and which body field carries the typed phrase. */
export function deletionRequest(preview: DeletionPreview): { path: '/api/me' | '/api/household'; field: string } {
  return preview.verdict.mode === 'household_delete'
    ? { path: '/api/household', field: 'confirmHouseholdName' }
    : { path: '/api/me', field: 'confirmEmail' };
}

/**
 * Whether the delete button may be pressed.
 *
 * Blocked verdicts never. The escape hatch (all_pending) takes a separate
 * acknowledgement as well as the phrase — two gates, as on the web. The phrase
 * check is the routes' own function, so the button can never be enabled for a
 * phrase the server would refuse.
 */
export function canDelete(preview: DeletionPreview, typed: string, hatchAcknowledged: boolean): boolean {
  const v = preview.verdict;
  if (v.mode !== 'self_delete' && v.mode !== 'household_delete') return false;
  if (v.mode === 'household_delete' && v.reason === 'all_pending' && !hatchAcknowledged) return false;
  return confirmationMatches(preview.confirmWith.phrase, typed);
}

/** 200 is done; 202 is started and recorded but not finished. Both end the session. */
export function deletionOutcome(status: number): 'deleted' | 'partial' {
  return status === 202 ? 'partial' : 'deleted';
}

/** The message for a refused deletion. Literal keys: see the test. */
export function deletionErrorKey(err: unknown): string {
  const code = err instanceof ApiError ? err.code : null;
  switch (code) {
    case 'confirmation_mismatch': return 'deletion.errors.confirmationMismatch';
    case 'promote_first':
    case 'sole_owner': return 'deletion.errors.promoteFirst';
    case 'blocked_no_path': return 'deletion.errors.blockedNoPath';
    case 'household_deletion_required':
    case 'self_delete_instead':
    case 'last_member': return 'deletion.errors.verdictChanged';
    case 'stripe_unavailable':
    case 'stripe_cancel_failed': return 'deletion.errors.paymentServiceFailed';
    default: return err instanceof ApiError && err.kind !== 'server' ? messageKeyFor(err) : 'deletion.errors.failed';
  }
}

/** Promote one member so the caller can leave. Blocked verdict only. */
export async function promoteMember(post: Poster, memberId: string): Promise<{ ok: true } | { ok: false; messageKey: string }> {
  try {
    await post(`/api/household/members/${encodeURIComponent(memberId)}/promote`, {});
    return { ok: true };
  } catch (err) {
    console.error('Promote error:', err);
    return { ok: false, messageKey: err instanceof ApiError && err.kind !== 'server' ? messageKeyFor(err) : 'deletion.promoteFailed' };
  }
}

/** The export's path, in the app's language. */
export function exportPath(locale: 'en' | 'fr'): string {
  return `/api/export/transactions?locale=${locale}`;
}
