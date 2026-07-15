-- =============================================================================
-- Phare — deterministic, template-order card ordering
--
-- Cards created together during save-plan go in via a single bulk INSERT.
-- Postgres's now() is constant for the whole statement (transaction time,
-- not per-row), so every card in that batch gets an identical created_at —
-- ORDER BY created_at alone has no tiebreak and Postgres does not guarantee
-- any particular tie order (it can and did change between runs with no
-- ordering code touched). Same precedent as categories.sort_order already
-- in this schema.
--
-- Existing rows default to 0 (their true template order, if any, is
-- unrecoverable from created_at alone — this is the best available
-- reconstruction, same honest fallback as the "id" tiebreak this replaces).
-- New rows going forward get an explicit, strictly-increasing value that
-- preserves the order the caller (save-plan's account-creation loop, or a
-- manual single-account add) presented them in.
-- =============================================================================

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_accounts_household_sort
  ON accounts (household_id, sort_order, created_at);
