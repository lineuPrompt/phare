-- =============================================================================
-- Phare — goal accounts and transfers
-- Applied 2026-06-19.
-- Goals are first-class accounts. Transfers move money chequing → goal.
-- =============================================================================

-- 1. Extend account types to include goal account variants.
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_type_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_type_check
  CHECK (type IN ('chequing', 'credit_card', 'line_of_credit', 'savings', 'tfsa', 'rrsp'));

-- 2. Goal metadata — optional target amount and target date.
--    Balance is always derived from transactions (never a stored current_balance).
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS goal_target      numeric(12,2);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS goal_target_date date;

-- 3. Transfer peer link — links the two rows of a chequing→goal transfer pair.
--    Each row points to the other. ON DELETE SET NULL so orphan detection is possible
--    if one side is accidentally removed (the API always deletes both).
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transfer_peer_id uuid
  REFERENCES transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_transfer_peer
  ON transactions (transfer_peer_id);

-- =============================================================================
-- Transfer invariant (enforced at API layer, documented here for reference):
--
--   A transfer creates exactly TWO transaction rows:
--     chequing row: type='transfer', account_id=chequing, amount=N, transfer_peer_id→goal row
--     goal row:     type='transfer', account_id=goal,     amount=N, transfer_peer_id→chequing row
--
--   Dashboard bucket math:
--     income   = Σ amount WHERE type='income'
--     expenses = Σ amount WHERE type='expense'  AND account_id ∈ {chequing}
--     savings  = Σ amount WHERE type='transfer' AND account_id ∈ {chequing}
--     net      = income − expenses − savings
--
--   Goal balance = Σ amount WHERE account_id=goal AND type='transfer'
-- =============================================================================
