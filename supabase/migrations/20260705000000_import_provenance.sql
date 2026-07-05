-- =============================================================================
-- Phare — Build 3 Phase B: onboarding-import provenance
-- Strictly additive. No table is dropped; no NOT NULL is added.
--
-- PENDING APPLICATION — do not apply to production without founder sign-off.
--
-- Widens file_imports beyond literal file uploads: a row is now created on
-- EVERY save-plan run (file upload OR manual-form onboarding). That is what
-- lets the app tell "this onboarding's plan data" apart from one-off rows
-- added later via the Recurring page or the ledger (which never get a
-- file_import_id and are therefore never touched by the replace-on-reimport
-- flow in /api/save-plan).
-- =============================================================================

-- No Supabase Storage write exists in the upload flow today (the file is
-- parsed in memory and never persisted), so storage_path can't be a hard
-- requirement until that lands.
ALTER TABLE file_imports ALTER COLUMN storage_path DROP NOT NULL;

-- Manual-form onboarding runs get a provenance row too, tagged 'manual'.
ALTER TABLE file_imports DROP CONSTRAINT IF EXISTS file_imports_file_type_check;
ALTER TABLE file_imports ADD CONSTRAINT file_imports_file_type_check
  CHECK (file_type IN ('csv', 'excel', 'screenshot', 'manual'));

-- Provenance columns. ON DELETE SET NULL: file_imports rows are an audit
-- trail we never delete, but if one ever were, the rows it produced should
-- degrade to "no known import" rather than disappear.
ALTER TABLE recurring_items ADD COLUMN IF NOT EXISTS file_import_id uuid REFERENCES file_imports(id) ON DELETE SET NULL;
ALTER TABLE transactions    ADD COLUMN IF NOT EXISTS file_import_id uuid REFERENCES file_imports(id) ON DELETE SET NULL;
ALTER TABLE budgets         ADD COLUMN IF NOT EXISTS file_import_id uuid REFERENCES file_imports(id) ON DELETE SET NULL;
ALTER TABLE sinking_funds   ADD COLUMN IF NOT EXISTS file_import_id uuid REFERENCES file_imports(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_recurring_file_import    ON recurring_items (file_import_id);
CREATE INDEX IF NOT EXISTS idx_transactions_file_import  ON transactions    (file_import_id);
CREATE INDEX IF NOT EXISTS idx_budgets_file_import       ON budgets         (file_import_id);
CREATE INDEX IF NOT EXISTS idx_sinking_funds_file_import ON sinking_funds   (file_import_id);
