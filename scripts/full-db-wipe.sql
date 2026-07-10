-- =============================================================================
-- Phare — FULL DATABASE WIPE
-- FOUNDER/DEV TOOL. Not exposed anywhere in the UI. Run manually in the
-- Supabase SQL Editor. EVERY household, every user, every row, everywhere.
--
-- THIS IS NOT scripts/reset-household.sql. That script is scoped to ONE
-- household and preserves the household/users/household_members/categories/
-- chequing account so that household can re-onboard. This script preserves
-- NOTHING. It is for wiping a dev/staging project back to zero, or for a
-- pre-launch reset where every account in the project — including your
-- own — needs to disappear and start clean via fresh signup.
--
-- IF YOU WANT TO KEEP EVEN ONE HOUSEHOLD (e.g. your own), DO NOT RUN THIS.
-- Use scripts/reset-household.sql for every household you want to keep and
-- run it once per household instead.
-- =============================================================================
--
-- WHAT THIS DELETES
--   Every row in every table in this project: transactions, recurring_items,
--   monthly_goals, card_envelope_items, budgets, sinking_funds, goals,
--   account_balance_anchors, budget_alerts, file_imports, events,
--   conversations, accounts, categories, household_members, users (public),
--   households, AND auth.users (Supabase Auth — this signs everyone out
--   permanently and deletes their login credentials; nothing short of a
--   fresh signup can undo it).
--
-- WHY ONE DELETE STATEMENT WOULD ALSO WORK, AND WHY THIS DOESN'T DO THAT
--   Every one of the 16 public tables below has household_id ON DELETE
--   CASCADE back to households — so `DELETE FROM households;` alone would
--   transitively wipe all 16 of them in one statement. This script deletes
--   each one explicitly anyway, in FK-safe leaf-to-root order, for an
--   honest, auditable per-table count and so nothing relies silently on a
--   cascade being exactly right. auth.users is deleted as its own final
--   step — nothing in the public schema cascades into it (the FK direction
--   is the other way: users.id REFERENCES auth.users(id) ON DELETE CASCADE),
--   so it's the one row set that genuinely needs its own explicit DELETE.
--
-- SAFETY CONTRACT
--   • Refuses to run at all until you edit the CONFIRMED flag below from
--     false to true. This is deliberate friction — there is no household_id
--     to scope this to, so the only guard available is making the
--     destructive intent an explicit, hard-to-fat-finger edit.
--   • Runs inside a single transaction (BEGIN...COMMIT except the guard,
--     which must fail before the transaction opens). Any failure mid-way
--     rolls the entire wipe back.
--   • Ends with a verification SELECT — every row must be 0.
--
-- HOW TO RUN
--   1. Be certain. Re-read the header above once more.
--   2. Open Supabase → SQL Editor.
--   3. Change `confirmed boolean := false;` to `true` below.
--   4. Run the whole script. Check the verification result set.
-- =============================================================================

DO $$
DECLARE
  -- <<< Change this to true only when you mean to wipe the ENTIRE database. >>>
  confirmed boolean := false;
BEGIN
  IF NOT confirmed THEN
    RAISE EXCEPTION 'Safety guard: this wipes the ENTIRE database — every household, every user, everyone''s login. Set confirmed := true in this script to proceed. Nothing was deleted.';
  END IF;
END $$;

BEGIN;

-- STEP 1 — transactions (must precede accounts/recurring_items: their account_id / this table's own FKs)
DELETE FROM transactions;

-- STEP 2 — recurring_items (must precede accounts: account_id is ON DELETE RESTRICT)
DELETE FROM recurring_items;

-- STEP 3 — monthly_goals (per-card monthly spending targets)
DELETE FROM monthly_goals;

-- STEP 4 — card_envelope_items (per-card category sub-budgets)
DELETE FROM card_envelope_items;

-- STEP 5 — budgets (planned variable-expense amounts per category/month)
DELETE FROM budgets;

-- STEP 6 — sinking_funds (annual-expense monthly provisions)
DELETE FROM sinking_funds;

-- STEP 7 — goals (legacy savings-goals table; active goal tracking is via accounts)
DELETE FROM goals;

-- STEP 8 — account_balance_anchors (opening-balance anchors for the Cash Timeline)
DELETE FROM account_balance_anchors;

-- STEP 9 — budget_alerts (80%/100% category threshold alerts)
DELETE FROM budget_alerts;

-- STEP 10 — file_imports (upload/onboarding provenance rows)
DELETE FROM file_imports;

-- STEP 11 — events (lifecycle diary)
DELETE FROM events;

-- STEP 12 — conversations (AI onboarding summaries, monthly reviews, chat)
DELETE FROM conversations;

-- STEP 13 — accounts (now safe: nothing with ON DELETE RESTRICT references it anymore)
DELETE FROM accounts;

-- STEP 14 — categories (now safe: nothing referencing it — transactions,
-- recurring_items, card_envelope_items, budgets, budget_alerts — remains)
DELETE FROM categories;

-- STEP 15 — household_members (now safe: nothing referencing it — transactions,
-- recurring_items, budgets, budget_alerts — remains)
DELETE FROM household_members;

-- STEP 16 — users (public.users — the app-level profile row, not the login)
DELETE FROM users;

-- STEP 17 — households (root of every household_id ON DELETE CASCADE chain above)
DELETE FROM households;

-- STEP 18 — auth.users (Supabase Auth logins). The one table not reachable
-- from households by cascade — the FK points the other way (public.users
-- references auth.users, not the reverse). Deleting here cascades through
-- Supabase's own auth.identities / auth.sessions / auth.refresh_tokens.
DELETE FROM auth.users;

COMMIT;

-- =============================================================================
-- VERIFICATION — every row here must be 0.
-- =============================================================================
SELECT 'transactions' AS table_name, count(*) AS remaining_rows FROM transactions
UNION ALL SELECT 'recurring_items',         count(*) FROM recurring_items
UNION ALL SELECT 'monthly_goals',           count(*) FROM monthly_goals
UNION ALL SELECT 'card_envelope_items',     count(*) FROM card_envelope_items
UNION ALL SELECT 'budgets',                 count(*) FROM budgets
UNION ALL SELECT 'sinking_funds',           count(*) FROM sinking_funds
UNION ALL SELECT 'goals',                   count(*) FROM goals
UNION ALL SELECT 'account_balance_anchors', count(*) FROM account_balance_anchors
UNION ALL SELECT 'budget_alerts',           count(*) FROM budget_alerts
UNION ALL SELECT 'file_imports',            count(*) FROM file_imports
UNION ALL SELECT 'events',                  count(*) FROM events
UNION ALL SELECT 'conversations',           count(*) FROM conversations
UNION ALL SELECT 'accounts',                count(*) FROM accounts
UNION ALL SELECT 'categories',              count(*) FROM categories
UNION ALL SELECT 'household_members',       count(*) FROM household_members
UNION ALL SELECT 'users (public)',          count(*) FROM users
UNION ALL SELECT 'households',              count(*) FROM households
UNION ALL SELECT 'auth.users',              count(*) FROM auth.users;
