-- =============================================================================
-- Phare — household reset script (CANONICAL — the pre-trial reset)
-- FOUNDER/DEV TOOL. Not exposed anywhere in the UI. Run manually in the
-- Supabase SQL Editor.
--
-- This is the ONE household-scoped reset script. It replaces two previous
-- near-duplicates that had drifted apart and both claimed to be "the
-- pre-trial reset script" — scripts/wipe_household.sql now just points here.
-- It is NOT scripts/full-db-wipe.sql — that tool wipes EVERY household in
-- the project, including auth.users; this one is scoped to a single
-- household_id and preserves that household's login/identity.
-- =============================================================================
--
-- PURPOSE
--   Delete every financial row for ONE household so it can go through
--   onboarding again from scratch, without recreating the household, its
--   users, its household_members, or its seed categories.
--
-- WHAT THIS DELETES (all scoped to the one household_id below)
--   transactions, recurring_skipped_dates, recurring_items, monthly_goals,
--   card_envelope_items, budgets, sinking_funds, account_balance_anchors,
--   budget_alerts, file_imports, events, conversations, and every
--   NON-chequing account (credit cards, lines of credit, goal accounts,
--   sinking-fund buffer accounts).
--   (The legacy `goals` table — superseded by goal-typed accounts — was
--   dropped entirely in 20260728000000_drop_legacy_goals_table.sql, so it
--   is never referenced here.)
--
-- WHAT THIS PRESERVES
--   households, users, household_members, categories (the 10 seed
--   categories, plus any custom ones — re-onboarding is idempotent on
--   categories and will not duplicate them), and the chequing account
--   itself (its transactions are deleted in step 1 like everything else —
--   only the account row survives, since the signup trigger that creates it
--   does not re-run and there is no app UX path to recreate it).
--
-- THE TWO BUGS THIS VERSION FIXES (both hit live in earlier drafts)
--   1. INLINE UUID, NOT A TEMP TABLE. A prior draft stashed the target
--      household_id in a session-scoped `CREATE TEMP TABLE`, referenced via
--      subselects in every WHERE clause. That's extra moving parts for zero
--      benefit and leaves session state behind if the SQL Editor tab is
--      reused afterward. Below, the reset itself takes the id as a plain
--      `DO $$ DECLARE hid uuid := '...';` variable, and each verification
--      query takes it via a `WITH target AS (SELECT '...'::uuid ...)` CTE —
--      both are scoped to a single statement, nothing persists in the
--      session, and the id is only pasted once per block (3 places total),
--      not once per line.
--   2. EXPLICIT COLUMN ALIASES ON EVERY UNION BRANCH. A prior draft aliased
--      only the FIRST `SELECT` in each verification UNION ALL block (valid
--      SQL — Postgres names the result columns from the first branch — but
--      fragile: commenting out or reordering that first line silently
--      changes the result grid's column headers with no error, which is
--      exactly the kind of thing that happens when you're mid-edit at 2am
--      before a trial). Every branch below names its own columns.
--
-- SAFETY CONTRACT
--   • Scoped to ONE household — paste its id into `hid` below; every DELETE
--     is filtered by it.
--   • The whole delete sequence runs inside a single DO block, which
--     Postgres wraps in an implicit transaction as one statement — a guard
--     check aborts the entire block (RAISE EXCEPTION, nothing committed) if
--     the household_id doesn't exist, so a typo'd UUID can't silently
--     delete nothing and look like it worked, or delete the wrong household.
--   • Single-execution safe: no session state (temp tables, session
--     variables) is created or required to survive between statements, so
--     pasting and running the whole script twice in a row behaves the same
--     way both times.
--   • Ends with two verification SELECTs — the first must show 0 for every
--     financial table, the second must show non-zero for everything
--     preserved (chequing accounts must read exactly 1).
--
-- HOW TO RUN
--   1. Open Supabase → SQL Editor.
--   2. Find your household_id: SELECT id, name FROM households;
--   3. Paste it into all THREE `'PASTE-HOUSEHOLD-UUID-HERE'` placeholders
--      below (the reset block, then each of the two verification blocks).
--   4. Read the script once more end-to-end.
--   5. Run the whole script. Check both verification result sets.
--
-- FK DEPENDENCY ORDER (why deletes are in this sequence)
--   transactions.account_id, recurring_items.account_id → accounts, ON
--   DELETE RESTRICT (account_integrity migration) — both must be deleted
--   before accounts. recurring_skipped_dates.recurring_item_id →
--   recurring_items ON DELETE CASCADE (would clean up automatically once
--   recurring_items rows are gone, but deleted explicitly here for an
--   honest, auditable row count, same convention as every other table).
--   monthly_goals.account_id and card_envelope_items.account_id → accounts
--   ON DELETE CASCADE (same reasoning). Everything else is
--   household_id-scoped only, or references categories/household_members
--   with SET NULL / CASCADE — safe in any order relative to those tables,
--   which this script never touches.
-- =============================================================================

DO $$
DECLARE
  -- <<< REPLACE the UUID below with the target household_id. >>>
  hid uuid := 'PASTE-HOUSEHOLD-UUID-HERE'::uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM households WHERE id = hid) THEN
    RAISE EXCEPTION 'No household found with id % — aborting, nothing was deleted.', hid;
  END IF;

  -- STEP 1 — transactions (must precede accounts/recurring_items: their account_id / this table's own FKs)
  DELETE FROM transactions WHERE household_id = hid;

  -- STEP 2 — recurring_skipped_dates (detached-occurrence tombstones; explicit for an auditable count, though it would cascade from step 3 regardless)
  DELETE FROM recurring_skipped_dates WHERE household_id = hid;

  -- STEP 3 — recurring_items (must precede accounts: account_id is ON DELETE RESTRICT)
  DELETE FROM recurring_items WHERE household_id = hid;

  -- STEP 4 — monthly_goals (per-card monthly spending targets)
  DELETE FROM monthly_goals WHERE household_id = hid;

  -- STEP 5 — card_envelope_items (per-card category sub-budget allocations)
  DELETE FROM card_envelope_items WHERE household_id = hid;

  -- STEP 6 — budgets (planned variable-expense amounts per category/month)
  DELETE FROM budgets WHERE household_id = hid;

  -- STEP 7 — sinking_funds (annual-expense monthly provisions; the linked buffer account itself is deleted in step 12)
  DELETE FROM sinking_funds WHERE household_id = hid;

  -- STEP 8 — account_balance_anchors (opening-balance anchors for the Cash Timeline)
  DELETE FROM account_balance_anchors WHERE household_id = hid;

  -- STEP 9 — budget_alerts (80%/100% category threshold alerts)
  DELETE FROM budget_alerts WHERE household_id = hid;

  -- STEP 10 — file_imports (upload/onboarding provenance rows)
  DELETE FROM file_imports WHERE household_id = hid;

  -- STEP 11 — events (lifecycle diary — cleared so a fresh trial starts at day 1)
  DELETE FROM events WHERE household_id = hid;

  -- STEP 12 — conversations (AI onboarding summaries, monthly reviews, chat)
  DELETE FROM conversations WHERE household_id = hid;

  -- STEP 13 — accounts, EXCEPT chequing (preserved — see header). This
  -- covers credit cards, lines of credit, goal accounts, and sinking-fund
  -- buffer accounts (is_sinking_fund=true rows are still type != 'chequing').
  DELETE FROM accounts WHERE household_id = hid AND type != 'chequing';

  RAISE NOTICE 'Reset complete for household %', hid;
END $$;

-- =============================================================================
-- VERIFICATION 1 — every row here must be 0.
-- =============================================================================
WITH target AS (SELECT 'PASTE-HOUSEHOLD-UUID-HERE'::uuid AS household_id)
SELECT 'transactions'             AS table_name, count(*) AS remaining_rows FROM transactions            , target WHERE transactions.household_id            = target.household_id
UNION ALL SELECT 'recurring_skipped_dates' AS table_name, count(*) AS remaining_rows FROM recurring_skipped_dates, target WHERE recurring_skipped_dates.household_id = target.household_id
UNION ALL SELECT 'recurring_items'         AS table_name, count(*) AS remaining_rows FROM recurring_items,        target WHERE recurring_items.household_id         = target.household_id
UNION ALL SELECT 'monthly_goals'           AS table_name, count(*) AS remaining_rows FROM monthly_goals,          target WHERE monthly_goals.household_id           = target.household_id
UNION ALL SELECT 'card_envelope_items'     AS table_name, count(*) AS remaining_rows FROM card_envelope_items,    target WHERE card_envelope_items.household_id     = target.household_id
UNION ALL SELECT 'budgets'                 AS table_name, count(*) AS remaining_rows FROM budgets,                target WHERE budgets.household_id                 = target.household_id
UNION ALL SELECT 'sinking_funds'           AS table_name, count(*) AS remaining_rows FROM sinking_funds,          target WHERE sinking_funds.household_id           = target.household_id
UNION ALL SELECT 'account_balance_anchors' AS table_name, count(*) AS remaining_rows FROM account_balance_anchors,target WHERE account_balance_anchors.household_id = target.household_id
UNION ALL SELECT 'budget_alerts'           AS table_name, count(*) AS remaining_rows FROM budget_alerts,          target WHERE budget_alerts.household_id           = target.household_id
UNION ALL SELECT 'file_imports'            AS table_name, count(*) AS remaining_rows FROM file_imports,           target WHERE file_imports.household_id            = target.household_id
UNION ALL SELECT 'events'                  AS table_name, count(*) AS remaining_rows FROM events,                 target WHERE events.household_id                  = target.household_id
UNION ALL SELECT 'conversations'           AS table_name, count(*) AS remaining_rows FROM conversations,          target WHERE conversations.household_id           = target.household_id
UNION ALL SELECT 'accounts (non-chequing)' AS table_name, count(*) AS remaining_rows FROM accounts,               target WHERE accounts.household_id                = target.household_id AND accounts.type != 'chequing';

-- =============================================================================
-- VERIFICATION 2 — preserved rows; every row here must be non-zero, and
-- accounts (chequing) must be exactly 1.
-- =============================================================================
WITH target AS (SELECT 'PASTE-HOUSEHOLD-UUID-HERE'::uuid AS household_id)
SELECT 'households (preserved)'        AS check_name, count(*) AS row_count FROM households,        target WHERE households.id           = target.household_id
UNION ALL SELECT 'users (preserved)'             AS check_name, count(*) AS row_count FROM users,             target WHERE users.household_id             = target.household_id
UNION ALL SELECT 'household_members (preserved)' AS check_name, count(*) AS row_count FROM household_members, target WHERE household_members.household_id = target.household_id
UNION ALL SELECT 'categories (preserved)'        AS check_name, count(*) AS row_count FROM categories,        target WHERE categories.household_id        = target.household_id
UNION ALL SELECT 'accounts (chequing, expect exactly 1)' AS check_name, count(*) AS row_count FROM accounts,  target WHERE accounts.household_id = target.household_id AND accounts.type = 'chequing';
