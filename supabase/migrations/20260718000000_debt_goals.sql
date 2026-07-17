-- =============================================================================
-- Phare — debt as a goal type (Build 4 Phase 3)
-- Applied 2026-07-18.
--
-- A goal account can now be type='debt': a negative starting balance seeded
-- as an opening transaction (same "Starting balance" pattern save-plan
-- already uses for imported savings goals — see POST /api/accounts), target
-- 0 by default (or user-set), paid down via Phase 2 recurring transfers.
-- Balance is still Σ transfer transactions on the account (computeGoalBalance,
-- dashboardHelpers.ts) — no new balance concept, no interest modeling.
--
-- 'debt' is added to the same accounts_type_check list goal accounts already
-- share, and to GOAL_ACCOUNT_TYPES (dashboardHelpers.ts) — every existing
-- goal-account code path (goals API, recurring-transfer destination
-- validation, transfer validation, account creation) picks it up for free.
-- =============================================================================

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_type_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_type_check
  CHECK (type IN ('chequing', 'credit_card', 'line_of_credit', 'savings', 'tfsa', 'rrsp', 'debt'));
