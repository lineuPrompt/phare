-- =============================================================================
-- Phare — household wipe script (pre-trial reset)
-- Delivered 2026-06-22. DO NOT RUN without reading the header.
-- =============================================================================
--
-- PURPOSE
--   Wipe all test/onboarding data for a single household so the 30-day family
--   trial starts on a clean ledger. Run this in the Supabase SQL editor ONCE
--   before the trial begins.
--
-- SAFETY CONTRACT
--   • Scoped to ONE household via the _hid variable below — paste your
--     household_id once; every DELETE is filtered by it.
--   • Does NOT touch: households, users, household_members, auth.users.
--     The founder keeps their login and the shared household record intact.
--   • Runs inside a single Postgres transaction (DO block). Any failure
--     rolls the entire wipe back — no partial state possible.
--   • Preserves the chequing account created by the signup trigger, because
--     the trigger does not re-run after a wipe. There is no app UX path to
--     re-create chequing. Deleting it would leave the household broken.
--     (All credit card and goal accounts ARE deleted — re-add them during
--     the real onboarding session.)
--
-- EVENTS NOTE (deliberate choice)
--   Events are deleted so the "returned within 7 days" trial baseline starts
--   clean at day 1. If you prefer to keep the events log for continuity,
--   comment out the events DELETE below before running.
--
-- HOW TO RUN
--   1. Open Supabase → SQL Editor.
--   2. Find your household_id: SELECT id FROM households;
--   3. Paste it as the value of _hid below.
--   4. Read the script once more end-to-end.
--   5. Click Run.
--   6. Run the VERIFICATION QUERY at the bottom to confirm counts are zero.
--
-- FK DEPENDENCY ORDER (why deletes are in this sequence)
--   transactions.account_id      → accounts        ON DELETE RESTRICT
--   transactions.recurring_item  → recurring_items  ON DELETE SET NULL
--   transactions.category_id     → categories       ON DELETE SET NULL
--   recurring_items.account_id   → accounts         ON DELETE RESTRICT
--   recurring_items.category_id  → categories       ON DELETE SET NULL
--   budgets.category_id          → categories       ON DELETE CASCADE
--   budget_alerts.category_id    → categories       ON DELETE CASCADE
--   Rule: delete transactions first (unblocks accounts + recurring_items),
--   then recurring_items + budgets + budget_alerts (unblocks categories),
--   then categories, then non-chequing accounts.
-- =============================================================================

DO $$
DECLARE
  _hid uuid := 'PASTE-YOUR-HOUSEHOLD-UUID-HERE';
BEGIN

  -- ─────────────────────────────────────────────────────────────────────────
  -- STEP 1 — transactions
  -- Must be first: account_id is ON DELETE RESTRICT (integrity migration).
  -- transfer_peer_id is a self-reference with ON DELETE SET NULL — Postgres
  -- handles it automatically when all peer rows in the pair are deleted
  -- in the same statement.
  -- ─────────────────────────────────────────────────────────────────────────
  DELETE FROM transactions WHERE household_id = _hid;

  -- ─────────────────────────────────────────────────────────────────────────
  -- STEP 2 — budgets
  -- Planned monthly amounts per category. Clears the comparison baseline.
  -- ─────────────────────────────────────────────────────────────────────────
  DELETE FROM budgets WHERE household_id = _hid;

  -- ─────────────────────────────────────────────────────────────────────────
  -- STEP 3 — budget_alerts
  -- 80 %/100 % alerts fired against category budgets.
  -- Deleted before categories (category_id is NOT NULL).
  -- ─────────────────────────────────────────────────────────────────────────
  DELETE FROM budget_alerts WHERE household_id = _hid;

  -- ─────────────────────────────────────────────────────────────────────────
  -- STEP 4 — monthly_goals
  -- Per-month credit-card spending targets. Household-scoped only.
  -- ─────────────────────────────────────────────────────────────────────────
  DELETE FROM monthly_goals WHERE household_id = _hid;

  -- ─────────────────────────────────────────────────────────────────────────
  -- STEP 5 — recurring_items
  -- Fixed-bill rules (mortgage, salary, etc.). Now safe to delete because
  -- transactions.recurring_item_id is ON DELETE SET NULL — its rows are
  -- already gone from step 1.
  -- ─────────────────────────────────────────────────────────────────────────
  DELETE FROM recurring_items WHERE household_id = _hid;

  -- ─────────────────────────────────────────────────────────────────────────
  -- STEP 6 — sinking_funds
  -- Annual-expense provisioning records. No downstream FK dependencies.
  -- ─────────────────────────────────────────────────────────────────────────
  DELETE FROM sinking_funds WHERE household_id = _hid;

  -- ─────────────────────────────────────────────────────────────────────────
  -- STEP 7 — conversations
  -- AI-generated onboarding summaries and monthly reviews.
  -- ─────────────────────────────────────────────────────────────────────────
  DELETE FROM conversations WHERE household_id = _hid;

  -- ─────────────────────────────────────────────────────────────────────────
  -- STEP 8 — file_imports
  -- Spreadsheet / bank-statement upload records.
  -- ─────────────────────────────────────────────────────────────────────────
  DELETE FROM file_imports WHERE household_id = _hid;

  -- ─────────────────────────────────────────────────────────────────────────
  -- STEP 9 — events  [DELIBERATE CHOICE — read before keeping/removing]
  -- Deleting events so the 30-day trial retention baseline starts clean at
  -- day 1 (the "signup" event stays as a reference point in the auth schema,
  -- not here). If you want to keep the event history for continuity,
  -- comment out this line.
  -- ─────────────────────────────────────────────────────────────────────────
  DELETE FROM events WHERE household_id = _hid;

  -- ─────────────────────────────────────────────────────────────────────────
  -- STEP 10 — categories
  -- Safe now: all referencing rows (transactions, budgets, budget_alerts,
  -- recurring_items) are gone. The 10 seeded categories are wiped here;
  -- they will be re-seeded on the next onboarding plan-save.
  -- ─────────────────────────────────────────────────────────────────────────
  DELETE FROM categories WHERE household_id = _hid;

  -- ─────────────────────────────────────────────────────────────────────────
  -- STEP 11 — accounts (non-chequing only)
  -- Credit cards, line-of-credit, and goal accounts (savings/tfsa/rrsp) are
  -- deleted. The chequing account IS PRESERVED: the signup trigger that
  -- created it will not re-run, and there is no app UX path to re-create it.
  -- The family re-adds their credit cards and goal accounts during the real
  -- onboarding session.
  -- ─────────────────────────────────────────────────────────────────────────
  DELETE FROM accounts
  WHERE household_id = _hid
    AND type != 'chequing';

  RAISE NOTICE 'Wipe complete for household %', _hid;

END;
$$;


-- =============================================================================
-- VERIFICATION QUERY — run after the DO block completes
-- All counts should be 0 except:
--   accounts          → 1  (the preserved chequing account)
--   households        → 1  (untouched)
--   users             → 1+ (untouched)
--   household_members → 1+ (untouched)
-- =============================================================================

-- Replace the UUID below with the same household_id you used above.
DO $$
DECLARE
  _hid uuid := 'PASTE-YOUR-HOUSEHOLD-UUID-HERE';
BEGIN
  RAISE NOTICE '=== Wipe verification for household % ===', _hid;
  RAISE NOTICE 'transactions:    %', (SELECT COUNT(*) FROM transactions    WHERE household_id = _hid);
  RAISE NOTICE 'budgets:         %', (SELECT COUNT(*) FROM budgets         WHERE household_id = _hid);
  RAISE NOTICE 'budget_alerts:   %', (SELECT COUNT(*) FROM budget_alerts   WHERE household_id = _hid);
  RAISE NOTICE 'monthly_goals:   %', (SELECT COUNT(*) FROM monthly_goals   WHERE household_id = _hid);
  RAISE NOTICE 'recurring_items: %', (SELECT COUNT(*) FROM recurring_items WHERE household_id = _hid);
  RAISE NOTICE 'sinking_funds:   %', (SELECT COUNT(*) FROM sinking_funds   WHERE household_id = _hid);
  RAISE NOTICE 'conversations:   %', (SELECT COUNT(*) FROM conversations   WHERE household_id = _hid);
  RAISE NOTICE 'file_imports:    %', (SELECT COUNT(*) FROM file_imports    WHERE household_id = _hid);
  RAISE NOTICE 'events:          %', (SELECT COUNT(*) FROM events          WHERE household_id = _hid);
  RAISE NOTICE 'categories:      %', (SELECT COUNT(*) FROM categories      WHERE household_id = _hid);
  RAISE NOTICE 'accounts total:  %', (SELECT COUNT(*) FROM accounts        WHERE household_id = _hid);
  RAISE NOTICE 'accounts chequing (expect 1): %', (SELECT COUNT(*) FROM accounts WHERE household_id = _hid AND type = ''chequing'');
  RAISE NOTICE '--- preserved (should be non-zero) ---';
  RAISE NOTICE 'households:      %', (SELECT COUNT(*) FROM households      WHERE id          = _hid);
  RAISE NOTICE 'users:           %', (SELECT COUNT(*) FROM users           WHERE household_id = _hid);
  RAISE NOTICE 'household_members: %', (SELECT COUNT(*) FROM household_members WHERE household_id = _hid);
END;
$$;
