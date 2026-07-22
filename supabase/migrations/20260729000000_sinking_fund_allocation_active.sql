-- =============================================================================
-- Phare — sinking fund allocations become editable (2026-07-22).
-- Strictly additive.
--
-- PENDING APPLICATION — do not apply to production without founder sign-off.
--
-- Each sinking_funds row is one line the shared buffer covers (e.g.
-- "Property tax", "Christmas"). `active` lets a household exclude a line
-- from the buffer's contribution without losing its due-month/amount
-- history — a soft flag, never a delete, so it can be re-included later.
-- The buffer's total monthly contribution is always sum(monthly_provision)
-- over active=true rows only; excluded rows are display-only.
-- =============================================================================

ALTER TABLE sinking_funds ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
