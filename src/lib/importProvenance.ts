/**
 * Pure decision logic for onboarding-import provenance and replace-on-reimport.
 * Code owns these decisions; the API route only executes the DB calls they imply.
 */

export type FileMeta = { fileName: string; fileType: 'csv' | 'excel' } | null | undefined;

/** What gets written to file_imports for this onboarding save. */
export function buildFileImportRow(
  fileMeta: FileMeta,
  householdId: string,
  uploadedBy: string
): { household_id: string; uploaded_by: string; file_name: string; file_type: string; storage_path: null; status: 'completed' } {
  return {
    household_id: householdId,
    uploaded_by: uploadedBy,
    file_name: fileMeta?.fileName ?? 'Manual entry',
    file_type: fileMeta?.fileType ?? 'manual',
    storage_path: null,
    status: 'completed',
  };
}

/** transactions.source must reflect the real origin — never hardcode 'manual'. */
export function resolveTransactionSource(fileMeta: FileMeta): 'manual' | 'csv' | 'excel' {
  return fileMeta?.fileType ?? 'manual';
}

/***
 * A destructive re-onboarding replace should never run silently once the
 * household already has plan data. confirmReplace is the explicit go-ahead
 * from the bilingual confirmation step in the UI.
 */
export function needsReplaceConfirmation(hasPriorData: boolean, confirmReplace: boolean | undefined): boolean {
  return hasPriorData && !confirmReplace;
}

/**
 * Split rows created by prior save-plan runs (file_import_id set — whether
 * from a real file or a manual-form onboarding) from rows with no import
 * provenance at all. The latter are either ad-hoc entries added one at a
 * time (Recurring page, ledger) or legacy rows that predate provenance
 * tracking — either way, replace-on-reimport must never touch them.
 */
export function partitionByProvenance<T extends { file_import_id: string | null }>(
  rows: T[]
): { provenanced: T[]; legacy: T[] } {
  const provenanced: T[] = [];
  const legacy: T[] = [];
  for (const row of rows) {
    (row.file_import_id !== null ? provenanced : legacy).push(row);
  }
  return { provenanced, legacy };
}

/**
 * Which of the 10 seed category names are missing for this household.
 * Replaces wipe-then-reinsert: seeding must be idempotent so a user's
 * manually added custom categories (and anything referencing them) survive
 * re-onboarding.
 */
export function missingSeedCategories(existingNames: string[], seedNames: string[]): string[] {
  const existing = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  return seedNames.filter((n) => !existing.has(n.trim().toLowerCase()));
}

// ---------------------------------------------------------------------------
// Card/goal account reuse, create, delete, and preserve on re-onboarding
// (Phase B2 + the duplicate-account fix)
// ---------------------------------------------------------------------------

export type AccountPreserveReason = 'not_from_import' | 'has_transactions' | 'has_envelope_budget' | 'has_monthly_goal';
// The full set accounts.type can hold (see accounts_type_check). Reuse only
// ever matches 'credit_card' (cardNames) or 'savings' (plan.goals) — other
// existing types (line_of_credit, tfsa, rrsp) simply never match a desired
// entry and fall through to the ordinary delete/preserve decision.
export type AccountKind = 'chequing' | 'credit_card' | 'line_of_credit' | 'savings' | 'tfsa' | 'rrsp';

export type AccountProvenanceInfo = {
  id: string;
  name: string;
  type: AccountKind;
  file_import_id: string | null;
  transactionCount: number;   // includes bridge-sourced rows on chequing, and goal-transfer rows
  envelopeItemCount: number;
  monthlyGoalCount: number;
};

export type DesiredAccount = { name: string; type: AccountKind };

export type AccountActionPlan = {
  toDelete: { id: string; name: string }[];
  toPreserve: { id: string; name: string; reason: AccountPreserveReason }[];
  toReuse: { id: string; name: string; type: AccountKind; refreshProvenance: boolean }[];
  toCreate: DesiredAccount[];
};

// "Has history that must never be silently re-tagged as import-owned" —
// either real activity, or the account was never import-managed to begin
// with (manually added). Both cases keep their provenance exactly as-is on reuse.
function hasManualHistory(a: AccountProvenanceInfo): boolean {
  return a.file_import_id === null || a.transactionCount > 0 || a.envelopeItemCount > 0 || a.monthlyGoalCount > 0;
}

/**
 * Decides what happens to every non-chequing account on a confirmed
 * re-onboarding, resolving reuse BEFORE delete/preserve so a name match
 * never results in delete-then-recreate duplication:
 *
 *  - A desired account (from cardNames / plan.goals) matching an existing
 *    account of the same type by name (case/whitespace-insensitive) is
 *    REUSED, never recreated. If the match has no manual data of its own,
 *    its provenance is refreshed to this run (still import-managed); if it
 *    does, provenance is left exactly as-is — reuse never touches a row
 *    with real history.
 *  - A desired account with no match is created fresh, tagged to this run.
 *  - Any remaining (unclaimed) existing account is deleted if it came from
 *    a prior import and has no activity of its own, or preserved otherwise
 *    (manually added, or has transactions/envelope items/a monthly goal).
 */
export function planAccountActions(
  desired: DesiredAccount[],
  existing: AccountProvenanceInfo[]
): AccountActionPlan {
  const claimed = new Set<string>();
  const toReuse: AccountActionPlan['toReuse'] = [];
  const toCreate: AccountActionPlan['toCreate'] = [];

  for (const want of desired) {
    const normalized = want.name.trim().toLowerCase();
    const match = existing.find(
      (a) => a.type === want.type && !claimed.has(a.id) && a.name.trim().toLowerCase() === normalized
    );
    if (match) {
      claimed.add(match.id);
      toReuse.push({ id: match.id, name: match.name, type: want.type, refreshProvenance: !hasManualHistory(match) });
    } else {
      toCreate.push(want);
    }
  }

  const toDelete: AccountActionPlan['toDelete'] = [];
  const toPreserve: AccountActionPlan['toPreserve'] = [];

  for (const a of existing) {
    if (claimed.has(a.id)) continue; // being reused — not a delete or preserve decision

    if (a.file_import_id === null) {
      toPreserve.push({ id: a.id, name: a.name, reason: 'not_from_import' });
    } else if (a.monthlyGoalCount > 0) {
      toPreserve.push({ id: a.id, name: a.name, reason: 'has_monthly_goal' });
    } else if (a.envelopeItemCount > 0) {
      toPreserve.push({ id: a.id, name: a.name, reason: 'has_envelope_budget' });
    } else if (a.transactionCount > 0) {
      toPreserve.push({ id: a.id, name: a.name, reason: 'has_transactions' });
    } else {
      toDelete.push({ id: a.id, name: a.name });
    }
  }

  return { toDelete, toPreserve, toReuse, toCreate };
}

// Assigns explicit, strictly-increasing sort_order values to a list of
// to-be-created accounts, starting just after the household's current
// maximum — new accounts append after existing ones, and the array's own
// order (planAccountActions above preserves the caller's input order, e.g.
// the onboarding template's card sequence) becomes the real ordering. A
// single bulk INSERT can't rely on created_at for this: Postgres's now() is
// constant for the whole statement, so every row in the batch gets an
// identical timestamp and ties break in an unspecified, unstable order.
export function assignSequentialSortOrder<T>(
  items: T[],
  startAfter: number
): (T & { sort_order: number })[] {
  return items.map((item, i) => ({ ...item, sort_order: startAfter + 1 + i }));
}
