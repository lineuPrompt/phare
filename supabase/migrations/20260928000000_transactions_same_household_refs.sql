-- =============================================================================
-- Phare — a transaction may only point at its own household's accounts and
-- categories. 2026-09-28.
--
-- STATUS: APPLIED — 2026-09-28 (Lineu, SQL Editor).
--
--   Verified live 2026-09-28 through the read-only MCP server (VERIFY
--   sections 1-3, 10/10 PASS): trigger present and enabled; fires BEFORE
--   INSERT and UPDATE OF the four columns only; exactly one function of that
--   name; live prosrc identical to this file, all three checks present;
--   SECURITY DEFINER with search_path=public; zero existing cross-household
--   account, bridge or category rows.
--
--   Section 4 — BEHAVIOUR VERIFIED LIVE 2026-09-28, not in the SQL Editor
--   but over the exact path the trigger exists to close: PostgREST, signed
--   in as the Zezinho Test user (JWT + publishable key), bypassing
--   /api/expenses. All four refused with HTTP 403 / 42501:
--     * insert with another household's account_id
--     * insert with another household's category_id
--     * insert with another household's bridge_source_account
--     * update moving an existing row onto another household's account
--   and a valid write through the route (own account and category) was
--   accepted, then deleted. Household row count before and after: 162.
--   Caveat recorded honestly: the foreign ids used were REAL households'
--   rows. Nothing was written, but CLAUDE.md §5 now requires isolation tests
--   to target a throwaway household, so any re-run must do that.
--
-- Ticket: docs/tickets/transactions-cross-household-references.md
--
-- THE HOLE. The only policy on transactions is
--
--   "Users see household transactions"  FOR ALL
--     USING (household_id IN (SELECT household_id FROM users WHERE id = auth.uid()))
--
-- with no WITH CHECK of its own, so USING doubles as the insert/update check.
-- It proves the ROW belongs to the caller's household. It proves nothing about
-- the rows the row POINTS AT. A signed-in user can write
--
--   { household_id: <mine>, account_id: <someone else's card>, ... }
--
-- and the policy passes it. The foreign keys only prove the account exists.
--
-- WHY THE ROUTE FIX (37740fa) DOES NOT CLOSE IT. POST /api/expenses now looks
-- up accountId and categoryId scoped to the caller's household. But every
-- signed-in client holds a user JWT and the public anon key, which is exactly
-- what PostgREST needs: the mobile app, a browser console, curl. Anything the
-- route checks can be skipped by not calling the route. The rule has to live
-- where every write passes.
--
-- WHAT IT COSTS A HOUSEHOLD. What the row points at is its own business;
-- nothing legitimate writes a cross-household reference, and the production
-- read below found none. The damage it prevents: another household's card
-- Spent and Room figures moving, and their envelope maths including a row
-- they cannot see or delete.
--
-- SCOPE, deliberately narrow: account_id, bridge_source_account (also an
-- account), category_id — the ticket, plus what the route now checks.
-- member_id, recurring_item_id, file_import_id and transfer_peer_id reference
-- household-owned rows too and are listed on the ticket as follow-up; each
-- has writers (save-plan, create_transfer, materialisation) that deserve
-- their own reading before a trigger can refuse them.
--
-- WHY A TRIGGER. The rule spans two tables, which CHECK cannot express, and a
-- policy WITH CHECK subquery would run under the caller's RLS — correct today
-- by accident of the accounts policy, rather than by construction.
-- SECURITY DEFINER makes the answer independent of whose RLS is in force;
-- search_path is pinned so the definer context cannot be redirected.
--
-- COST. It fires on INSERT, and on UPDATE only when one of the checked
-- columns or household_id changes. Each check is a primary-key lookup. A
-- save-plan run inserting a few hundred rows adds a few hundred index probes.
--
-- DELETES ARE UNAFFECTED. Account deletion is ON DELETE RESTRICT here, and
-- category deletion sets category_id to NULL, which passes.
--
-- PRE-APPLICATION STATE, read from production 2026-09-28 via the read-only
-- MCP server before writing this:
--   transactions whose account belongs to another household ...... 0
--   transactions whose category belongs to another household ..... 0
--   transactions whose member belongs to another household ....... 0
--   transactions whose recurring rule is another household's ..... 0
--   existing triggers on transactions: trg_enforce_opening_balance_account_type
--   so the trigger below rejects nothing that exists.
-- =============================================================================


CREATE OR REPLACE FUNCTION enforce_transaction_same_household_refs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM accounts WHERE id = NEW.account_id AND household_id = NEW.household_id
  ) THEN
    RAISE EXCEPTION 'transaction account_id does not belong to its household'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.bridge_source_account IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM accounts WHERE id = NEW.bridge_source_account AND household_id = NEW.household_id
  ) THEN
    RAISE EXCEPTION 'transaction bridge_source_account does not belong to its household'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM categories WHERE id = NEW.category_id AND household_id = NEW.household_id
  ) THEN
    RAISE EXCEPTION 'transaction category_id does not belong to its household'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_transaction_same_household_refs ON transactions;

CREATE TRIGGER trg_enforce_transaction_same_household_refs
  BEFORE INSERT OR UPDATE OF household_id, account_id, bridge_source_account, category_id
  ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION enforce_transaction_same_household_refs();


-- =============================================================================
-- VERIFY — run in the SQL Editor after applying, as its own run.
--
-- It ENDS IN AN ERROR ON PURPOSE. The final RAISE EXCEPTION does two jobs:
-- it prints every result as the error message (which the editor always
-- shows, where NOTICEs and a SELECT before a ROLLBACK may not be), and it
-- rolls back the test rows it inserted. The expected output is an error
-- whose text starts "VERIFY finished" followed by one line per check. Every
-- line must say PASS (or SKIPPED, with its reason). Any other error means
-- the check itself failed to run — read it.
--
-- DO $$
-- DECLARE
--   r text[] := '{}';
--   src text;
--   def text;
--   n integer;
--   hh_a uuid; hh_b uuid;
--   acct_a uuid; acct_b uuid;
--   cat_a uuid; cat_b uuid;
-- BEGIN
--   -- 1. The trigger exists, is enabled, and is limited to the checked columns.
--   SELECT count(*) INTO n FROM pg_trigger
--    WHERE tgname = 'trg_enforce_transaction_same_household_refs'
--      AND tgrelid = 'public.transactions'::regclass AND tgenabled = 'O';
--   r := r || ('trigger present and enabled: ' || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END);
--   SELECT pg_get_triggerdef(oid) INTO def FROM pg_trigger
--    WHERE tgname = 'trg_enforce_transaction_same_household_refs'
--      AND tgrelid = 'public.transactions'::regclass;
--   r := r || ('fires BEFORE INSERT and UPDATE OF the four columns only: ' || CASE
--     WHEN def LIKE '%BEFORE INSERT OR UPDATE OF household_id, account_id, bridge_source_account, category_id ON public.transactions FOR EACH ROW%'
--     THEN 'PASS' ELSE 'FAIL (' || coalesce(def, 'no trigger') || ')' END);
--
--   -- 2. The body survived whole (CREATE OR REPLACE can drop clauses; CLAUDE.md §5).
--   SELECT count(*) INTO n FROM pg_proc WHERE proname = 'enforce_transaction_same_household_refs';
--   r := r || ('exactly one function of that name (no overload): ' || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL (' || n || ')' END);
--   SELECT prosrc INTO src FROM pg_proc WHERE proname = 'enforce_transaction_same_household_refs';
--   r := r || ('body checks account_id: ' || CASE WHEN src LIKE '%NEW.account_id IS NOT NULL%' THEN 'PASS' ELSE 'FAIL' END);
--   r := r || ('body checks bridge_source_account: ' || CASE WHEN src LIKE '%NEW.bridge_source_account IS NOT NULL%' THEN 'PASS' ELSE 'FAIL' END);
--   r := r || ('body checks category_id: ' || CASE WHEN src LIKE '%NEW.category_id IS NOT NULL%' THEN 'PASS' ELSE 'FAIL' END);
--   SELECT count(*) INTO n FROM pg_proc
--    WHERE proname = 'enforce_transaction_same_household_refs' AND prosecdef;
--   r := r || ('function is SECURITY DEFINER: ' || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END);
--
--   -- 3. Nothing already in the table violates the rule.
--   SELECT count(*) INTO n FROM transactions t JOIN accounts a ON a.id = t.account_id
--    WHERE a.household_id <> t.household_id;
--   r := r || ('no existing cross-household account rows: ' || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL (' || n || ')' END);
--   SELECT count(*) INTO n FROM transactions t JOIN accounts a ON a.id = t.bridge_source_account
--    WHERE a.household_id <> t.household_id;
--   r := r || ('no existing cross-household bridge rows: ' || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL (' || n || ')' END);
--   SELECT count(*) INTO n FROM transactions t JOIN categories c ON c.id = t.category_id
--    WHERE c.household_id <> t.household_id;
--   r := r || ('no existing cross-household category rows: ' || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL (' || n || ')' END);
--
--   -- 4. Behaviour: two households that each have an account and a category.
--   SELECT a.household_id, a.id INTO hh_a, acct_a FROM accounts a
--    WHERE EXISTS (SELECT 1 FROM categories c WHERE c.household_id = a.household_id)
--    ORDER BY a.created_at LIMIT 1;
--   SELECT a.household_id, a.id INTO hh_b, acct_b FROM accounts a
--    WHERE a.household_id <> hh_a
--      AND EXISTS (SELECT 1 FROM categories c WHERE c.household_id = a.household_id)
--    ORDER BY a.created_at LIMIT 1;
--   SELECT id INTO cat_a FROM categories WHERE household_id = hh_a LIMIT 1;
--   SELECT id INTO cat_b FROM categories WHERE household_id = hh_b LIMIT 1;
--
--   IF hh_a IS NULL OR hh_b IS NULL THEN
--     r := r || 'behaviour checks: SKIPPED (need two households with an account and a category each)'::text;
--   ELSE
--     -- Own account, own category: accepted.
--     BEGIN
--       INSERT INTO transactions (household_id, account_id, category_id, amount, description, date, type, source)
--       VALUES (hh_a, acct_a, cat_a, 1.00, 'VERIFY own refs', DATE '2026-09-28', 'expense', 'manual');
--       r := r || 'own account and category accepted: PASS'::text;
--     EXCEPTION WHEN OTHERS THEN
--       r := r || ('own account and category accepted: FAIL (' || SQLERRM || ')');
--     END;
--
--     -- Another household's account: rejected.
--     BEGIN
--       INSERT INTO transactions (household_id, account_id, category_id, amount, description, date, type, source)
--       VALUES (hh_a, acct_b, cat_a, 1.00, 'VERIFY foreign account', DATE '2026-09-28', 'expense', 'manual');
--       r := r || 'foreign account rejected: FAIL (it was accepted)'::text;
--     EXCEPTION WHEN insufficient_privilege THEN
--       r := r || 'foreign account rejected: PASS'::text;
--     END;
--
--     -- Another household's category: rejected.
--     BEGIN
--       INSERT INTO transactions (household_id, account_id, category_id, amount, description, date, type, source)
--       VALUES (hh_a, acct_a, cat_b, 1.00, 'VERIFY foreign category', DATE '2026-09-28', 'expense', 'manual');
--       r := r || 'foreign category rejected: FAIL (it was accepted)'::text;
--     EXCEPTION WHEN insufficient_privilege THEN
--       r := r || 'foreign category rejected: PASS'::text;
--     END;
--
--     -- Another household's account as a bridge source: rejected.
--     BEGIN
--       INSERT INTO transactions (household_id, account_id, bridge_source_account, amount, description, date, type, source)
--       VALUES (hh_a, acct_a, acct_b, 1.00, 'VERIFY foreign bridge', DATE '2026-09-28', 'expense', 'manual');
--       r := r || 'foreign bridge source rejected: FAIL (it was accepted)'::text;
--     EXCEPTION WHEN insufficient_privilege THEN
--       r := r || 'foreign bridge source rejected: PASS'::text;
--     END;
--
--     -- Moving an existing row onto another household's account: rejected.
--     BEGIN
--       UPDATE transactions SET account_id = acct_b
--        WHERE household_id = hh_a AND description = 'VERIFY own refs';
--       GET DIAGNOSTICS n = ROW_COUNT;
--       r := r || ('update to foreign account rejected: FAIL (' || n || ' row updated)');
--     EXCEPTION WHEN insufficient_privilege THEN
--       r := r || 'update to foreign account rejected: PASS'::text;
--     END;
--   END IF;
--
--   RAISE EXCEPTION E'VERIFY finished — every change above was rolled back on purpose.\n%',
--     array_to_string(r, E'\n');
-- END $$;
-- =============================================================================
