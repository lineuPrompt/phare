-- =============================================================================
-- Phare — a transaction may only point at its own household's accounts and
-- categories. 2026-09-28.
--
-- STATUS: WRITTEN — NOT APPLIED. Lineu applies it in the Supabase SQL Editor,
-- then runs the VERIFY block at the foot of this file and reads its NOTICEs.
-- Until then, treat the database as unprotected here.
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
-- VERIFY — run in the SQL Editor after applying. Everything is inside
-- BEGIN/ROLLBACK: the test rows it inserts are discarded. Read every NOTICE;
-- each must say PASS (or SKIPPED, with the reason).
--
-- BEGIN;
-- DO $$
-- DECLARE
--   src text;
--   n integer;
--   hh_a uuid; hh_b uuid;
--   acct_a uuid; acct_b uuid;
--   cat_a uuid; cat_b uuid;
-- BEGIN
--   -- 1. The trigger exists, is enabled, and fires on the right events.
--   SELECT count(*) INTO n FROM pg_trigger
--    WHERE tgname = 'trg_enforce_transaction_same_household_refs'
--      AND tgrelid = 'public.transactions'::regclass AND tgenabled = 'O';
--   RAISE NOTICE 'trigger present and enabled: %', CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END;
--
--   -- 2. The body survived whole (CREATE OR REPLACE can drop clauses; §5).
--   SELECT prosrc INTO src FROM pg_proc WHERE proname = 'enforce_transaction_same_household_refs';
--   RAISE NOTICE 'body checks account_id: %', CASE WHEN src LIKE '%NEW.account_id%' THEN 'PASS' ELSE 'FAIL' END;
--   RAISE NOTICE 'body checks bridge_source_account: %', CASE WHEN src LIKE '%NEW.bridge_source_account%' THEN 'PASS' ELSE 'FAIL' END;
--   RAISE NOTICE 'body checks category_id: %', CASE WHEN src LIKE '%NEW.category_id%' THEN 'PASS' ELSE 'FAIL' END;
--   SELECT count(*) INTO n FROM pg_proc WHERE proname = 'enforce_transaction_same_household_refs';
--   RAISE NOTICE 'exactly one function of that name (no overload): %', CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END;
--
--   -- 3. Nothing already in the table violates the rule.
--   SELECT count(*) INTO n FROM transactions t JOIN accounts a ON a.id = t.account_id
--    WHERE a.household_id <> t.household_id;
--   RAISE NOTICE 'no existing cross-household account rows: %', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL (' || n || ')' END;
--   SELECT count(*) INTO n FROM transactions t JOIN categories c ON c.id = t.category_id
--    WHERE c.household_id <> t.household_id;
--   RAISE NOTICE 'no existing cross-household category rows: %', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL (' || n || ')' END;
--
--   -- 4. Behaviour: two households, each with an account and a category.
--   SELECT a.household_id, a.id INTO hh_a, acct_a FROM accounts a ORDER BY a.created_at LIMIT 1;
--   SELECT a.household_id, a.id INTO hh_b, acct_b FROM accounts a
--    WHERE a.household_id <> hh_a ORDER BY a.created_at LIMIT 1;
--   SELECT id INTO cat_a FROM categories WHERE household_id = hh_a LIMIT 1;
--   SELECT id INTO cat_b FROM categories WHERE household_id = hh_b LIMIT 1;
--   IF hh_b IS NULL OR cat_a IS NULL OR cat_b IS NULL THEN
--     RAISE NOTICE 'behaviour checks: SKIPPED (need two households with an account and a category each)';
--   ELSE
--     -- Own account, own category: accepted.
--     INSERT INTO transactions (household_id, account_id, category_id, amount, description, date, type, source)
--     VALUES (hh_a, acct_a, cat_a, 1.00, 'VERIFY own refs', DATE '2026-09-28', 'expense', 'manual');
--     RAISE NOTICE 'own account and category accepted: PASS';
--
--     -- Another household's account: rejected.
--     BEGIN
--       INSERT INTO transactions (household_id, account_id, category_id, amount, description, date, type, source)
--       VALUES (hh_a, acct_b, cat_a, 1.00, 'VERIFY foreign account', DATE '2026-09-28', 'expense', 'manual');
--       RAISE NOTICE 'foreign account rejected: FAIL';
--     EXCEPTION WHEN insufficient_privilege THEN
--       RAISE NOTICE 'foreign account rejected: PASS';
--     END;
--
--     -- Another household's category: rejected.
--     BEGIN
--       INSERT INTO transactions (household_id, account_id, category_id, amount, description, date, type, source)
--       VALUES (hh_a, acct_a, cat_b, 1.00, 'VERIFY foreign category', DATE '2026-09-28', 'expense', 'manual');
--       RAISE NOTICE 'foreign category rejected: FAIL';
--     EXCEPTION WHEN insufficient_privilege THEN
--       RAISE NOTICE 'foreign category rejected: PASS';
--     END;
--
--     -- Moving an existing row's account to another household's: rejected.
--     BEGIN
--       UPDATE transactions SET account_id = acct_b
--        WHERE household_id = hh_a AND description = 'VERIFY own refs';
--       RAISE NOTICE 'update to foreign account rejected: FAIL';
--     EXCEPTION WHEN insufficient_privilege THEN
--       RAISE NOTICE 'update to foreign account rejected: PASS';
--     END;
--
--     -- An update that touches none of the checked columns does not fire it.
--     UPDATE transactions SET description = 'VERIFY own refs (edited)'
--      WHERE household_id = hh_a AND description = 'VERIFY own refs';
--     RAISE NOTICE 'unrelated update accepted: PASS';
--   END IF;
-- END $$;
-- ROLLBACK;
-- =============================================================================
