-- =============================================================================
-- Phare — Sinking funds become fundable (Part 2, founder-approved 2026-07-21).
-- Strictly additive.
--
-- STATUS: APPLIED — verified live in production on 2026-08-03 by direct schema
--   inspection (information_schema / pg_catalog), not by assumption.
--   Evidence: accounts.is_sinking_fund present, NOT NULL, default false;
--   sinking_funds.linked_account_id present and nullable.
--
--   Superseded banner, kept as history — until 2026-08-03 this file read:
--     "PENDING APPLICATION — do not apply to production without founder
--      sign-off."
--
-- MODEL: a sinking fund reuses the existing 'savings' account type (no
-- accounts_type_check / create_transfer destination-check change needed —
-- both already whitelist 'savings') plus this new boolean flag to
-- distinguish "cyclical cash buffer" from "real savings goal" everywhere the
-- app currently branches on GOAL_ACCOUNT_TYPES. sinking_funds.linked_account_id
-- is the join from the provision row to its real cash account, once one
-- exists — NULL means "still a dead provision, not started yet."
-- =============================================================================

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_sinking_fund boolean NOT NULL DEFAULT false;

ALTER TABLE sinking_funds ADD COLUMN IF NOT EXISTS linked_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sinking_funds_linked_account ON sinking_funds (linked_account_id);
