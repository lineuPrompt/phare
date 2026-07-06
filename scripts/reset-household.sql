-- =============================================================================
-- Phare — household reset script
-- FOUNDER/DEV TOOL. Not exposed anywhere in the UI. Run manually in the
-- Supabase SQL Editor. This is also the script used for the pre-trial wipe —
-- run it once against your own household right before a fresh trial-style
-- onboarding, to verify Phase C + the anchor step + member resolution
-- end-to-end on real data with a completely clean ledger.
-- =============================================================================
--
-- PURPOSE
--   Delete every financial row for ONE household so it can go through
--   onboarding again from scratch, without recreating the household, its
--   users, its household_members, or its seed categories.
--
-- WHAT THIS DELETES (all scoped to the one household_id below)
--   transactions, recurring_items, monthly_goals, card_envelope_items,
--   budgets, sinking_funds, goals, account_balance_anchors, budget_alerts,
--   file_imports, events, conversations, and ALL accounts (including
--   chequing — onboarding recreates it via /api/accounts, not the signup
--   trigger, so losing it here is recoverable).
--
-- WHAT THIS PRESERVES
--   households, users, household_members, categories (the 10 seed
--   categories, plus any custom ones — re-onboarding is idempotent on
--   categories and will not duplicate them).
--
-- SAFETY CONTRACT
--   • Scoped to ONE household via the _reset_target temp table below —
--     paste your household_id once; every DELETE is filtered by it.
--   • All deletes run inside a single transaction (BEGIN...COMMIT). A guard
--     check aborts (RAISE EXCEPTION → automatic ROLLBACK) before any delete
--     if the household_id doesn't exist, so a typo'd UUID can't silently
--     delete nothing and look like it worked, or delete the wrong household.
--   • Ends with verification SELECTs — run the whole script, then read the
--     two result sets: the first must show 0 for every financial table, the
--     second must show non-zero for everything preserved.
--
-- HOW TO RUN
--   1. Open Supabase → SQL Editor.
--   2. Find your household_id: SELECT id, name FROM households;
--   3. Paste it into the INSERT below, replacing the placeholder UUID.
--   4. Read the script once more end-to-end.
--   5. Run the whole script. Check both verification result sets.
--
-- FK DEPENDENCY ORDER (why deletes are in this sequence)
--   transactions.account_id, recurring_items.account_id → accounts, ON
--   DELETE RESTRICT (account_integrity migration) — both must be deleted
--   before accounts. monthly_goals.account_id and card_envelope_items.
--   account_id → accounts ON DELETE CASCADE (would clean up automatically
--   on account delete, but deleted explicitly here for an honest, auditable
--   row count). Everything else is household_id-scoped only, or references
--   categories/household_members with SET NULL / CASCADE — safe in any
--   order relative to those tables, which this script never touches.
-- =============================================================================

-- Defensive: in case a prior run of this script in the same session errored
-- out before reaching the final DROP TABLE.
DROP TABLE IF EXISTS _reset_target;
CREATE TEMP TABLE _reset_target (household_id uuid);

-- <<< REPLACE the UUID below with the target household_id, then run the whole script. >>>
INSERT INTO _reset_target (household_id) VALUES ('PASTE-HOUSEHOLD-UUID-HERE'::uuid);

BEGIN;

DO $$
DECLARE
  hid uuid := (SELECT household_id FROM _reset_target);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM households WHERE id = hid) THEN
    RAISE EXCEPTION 'No household found with id % — aborting, nothing was deleted.', hid;
  END IF;
END $$;

-- STEP 1 — transactions (must precede accounts: account_id is ON DELETE RESTRICT)
DELETE FROM transactions WHERE household_id = (SELECT household_id FROM _reset_target);

-- STEP 2 — recurring_items (must precede accounts: account_id is ON DELETE RESTRICT)
DELETE FROM recurring_items WHERE household_id = (SELECT household_id FROM _reset_target);

-- STEP 3 — monthly_goals (per-card monthly spending targets)
DELETE FROM monthly_goals WHERE household_id = (SELECT household_id FROM _reset_target);

-- STEP 4 — card_envelope_items (per-card category sub-budgets)
DELETE FROM card_envelope_items WHERE household_id = (SELECT household_id FROM _reset_target);

-- STEP 5 — budgets (planned variable-expense amounts per category/month)
DELETE FROM budgets WHERE household_id = (SELECT household_id FROM _reset_target);

-- STEP 6 — sinking_funds (annual-expense monthly provisions)
DELETE FROM sinking_funds WHERE household_id = (SELECT household_id FROM _reset_target);

-- STEP 7 — goals (legacy savings-goals table; active goal tracking is via accounts)
DELETE FROM goals WHERE household_id = (SELECT household_id FROM _reset_target);

-- STEP 8 — account_balance_anchors (opening-balance anchors for the Cash Timeline)
DELETE FROM account_balance_anchors WHERE household_id = (SELECT household_id FROM _reset_target);

-- STEP 9 — budget_alerts (80%/100% category threshold alerts)
DELETE FROM budget_alerts WHERE household_id = (SELECT household_id FROM _reset_target);

-- STEP 10 — file_imports (upload/onboarding provenance rows)
DELETE FROM file_imports WHERE household_id = (SELECT household_id FROM _reset_target);

-- STEP 11 — events (lifecycle diary — cleared so a fresh trial starts at day 1)
DELETE FROM events WHERE household_id = (SELECT household_id FROM _reset_target);

-- STEP 12 — conversations (AI onboarding summaries, monthly reviews, chat)
DELETE FROM conversations WHERE household_id = (SELECT household_id FROM _reset_target);

-- STEP 13 — accounts (all of them, including chequing — see header)
DELETE FROM accounts WHERE household_id = (SELECT household_id FROM _reset_target);

COMMIT;

-- =============================================================================
-- VERIFICATION 1 — every row here must be 0.
-- =============================================================================
SELECT 'transactions' AS table_name, count(*) AS remaining_rows FROM transactions WHERE household_id = (SELECT household_id FROM _reset_target)
UNION ALL SELECT 'recurring_items',        count(*) FROM recurring_items        WHERE household_id = (SELECT household_id FROM _reset_target)
UNION ALL SELECT 'monthly_goals',          count(*) FROM monthly_goals          WHERE household_id = (SELECT household_id FROM _reset_target)
UNION ALL SELECT 'card_envelope_items',    count(*) FROM card_envelope_items    WHERE household_id = (SELECT household_id FROM _reset_target)
UNION ALL SELECT 'budgets',                count(*) FROM budgets               WHERE household_id = (SELECT household_id FROM _reset_target)
UNION ALL SELECT 'sinking_funds',          count(*) FROM sinking_funds         WHERE household_id = (SELECT household_id FROM _reset_target)
UNION ALL SELECT 'goals',                  count(*) FROM goals                 WHERE household_id = (SELECT household_id FROM _reset_target)
UNION ALL SELECT 'account_balance_anchors',count(*) FROM account_balance_anchors WHERE household_id = (SELECT household_id FROM _reset_target)
UNION ALL SELECT 'budget_alerts',          count(*) FROM budget_alerts         WHERE household_id = (SELECT household_id FROM _reset_target)
UNION ALL SELECT 'file_imports',           count(*) FROM file_imports          WHERE household_id = (SELECT household_id FROM _reset_target)
UNION ALL SELECT 'events',                 count(*) FROM events                WHERE household_id = (SELECT household_id FROM _reset_target)
UNION ALL SELECT 'conversations',          count(*) FROM conversations         WHERE household_id = (SELECT household_id FROM _reset_target)
UNION ALL SELECT 'accounts',               count(*) FROM accounts              WHERE household_id = (SELECT household_id FROM _reset_target);

-- =============================================================================
-- VERIFICATION 2 — preserved rows; every row here must be non-zero.
-- =============================================================================
SELECT 'households (preserved)' AS check_name, count(*) AS row_count FROM households WHERE id = (SELECT household_id FROM _reset_target)
UNION ALL SELECT 'users (preserved)',             count(*) FROM users             WHERE household_id = (SELECT household_id FROM _reset_target)
UNION ALL SELECT 'household_members (preserved)', count(*) FROM household_members WHERE household_id = (SELECT household_id FROM _reset_target)
UNION ALL SELECT 'categories (preserved)',        count(*) FROM categories        WHERE household_id = (SELECT household_id FROM _reset_target);

DROP TABLE _reset_target;
