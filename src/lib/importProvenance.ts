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

/**
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
