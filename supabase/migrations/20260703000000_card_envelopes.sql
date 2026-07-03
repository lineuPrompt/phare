-- =============================================================================
-- Phare — Build 2: Per-card budget envelopes
-- Fixes trial bug #9 (one shared goal across all cards) and adds per-card
-- category sub-budgets. Sum constraint = WARN not block (#5). Exposes
-- statement_close_day / payment_day editing per card (#4).
-- =============================================================================

-- 1. Add account_id to monthly_goals so each card can have its own goal.
--    Nullable to avoid breaking existing rows; new code always provides it.
ALTER TABLE monthly_goals
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts(id) ON DELETE CASCADE;

-- Drop the old household+month unique constraint and replace with
-- household+account+month so two cards can have goals in the same month.
ALTER TABLE monthly_goals
  DROP CONSTRAINT IF EXISTS monthly_goals_household_id_month_key;

ALTER TABLE monthly_goals
  ADD CONSTRAINT monthly_goals_household_account_month_key
  UNIQUE (household_id, account_id, month);

-- Update the index to reflect the new constraint shape.
DROP INDEX IF EXISTS idx_monthly_goals_household_month;
CREATE INDEX IF NOT EXISTS idx_monthly_goals_household_account_month
  ON monthly_goals (household_id, account_id, month);

-- =============================================================================
-- 2. card_envelope_items — per-card category sub-budgets (persistent template,
--    not month-scoped; the monthly goal is in monthly_goals above).
-- =============================================================================
CREATE TABLE IF NOT EXISTS card_envelope_items (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   uuid          NOT NULL REFERENCES households(id)  ON DELETE CASCADE,
  account_id     uuid          NOT NULL REFERENCES accounts(id)    ON DELETE CASCADE,
  category_id    uuid          NOT NULL REFERENCES categories(id)  ON DELETE CASCADE,
  monthly_amount numeric(10,2) NOT NULL,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (household_id, account_id, category_id)
);

-- No updated_at trigger needed: rows are replaced via DELETE+INSERT, never UPDATEd in place.

-- Indexes
CREATE INDEX IF NOT EXISTS idx_card_envelope_items_household
  ON card_envelope_items (household_id);
CREATE INDEX IF NOT EXISTS idx_card_envelope_items_account
  ON card_envelope_items (account_id);

-- Row Level Security (same pattern as every other table)
ALTER TABLE card_envelope_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "card_envelope_items_all" ON card_envelope_items
  FOR ALL USING (household_id = auth_household_id());
